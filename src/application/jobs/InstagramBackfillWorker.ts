// src/application/jobs/InstagramBackfillWorker.ts
import { prisma } from "../../infrastructure/db/prismaClient";
import { InstagramBackfillService } from "../instagram/InstagramBackfillService";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function clampInt(n: number, min: number, max: number, fallback: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(v)));
}

type WorkerOptions = {
  // quantos jobs simultâneos (deixe 1 por enquanto pra não estourar rate limit)
  concurrency?: number;

  // intervalo pra procurar job novo
  pollMs?: number;

  // limites por execução (você pode ajustar depois)
  maxPosts?: number;
  maxPages?: number;

  // rate-limit simples
  perPostDelayMs?: number;
  perPageDelayMs?: number;

  // ✅ logs
  log?: (msg: string, extra?: any) => void;

  /**
   * ✅ Hook opcional (pra quando você quiser preencher instagramPostInsightResults)
   * - Não é obrigatório agora.
   * - O service.run pode chamar isso por post (se você implementar no service).
   */
  onPostImported?: (payload: {
    userId: string;
    instagramAccountId: string | null;
    igUserId: string;
    postDbId: string; // id do instagramPost no seu banco
    igMediaId: string;
  }) => Promise<void>;
};

export function startInstagramBackfillWorker(opts: WorkerOptions = {}) {
  const service = new InstagramBackfillService();

  const concurrency = clampInt(opts.concurrency ?? 1, 1, 5, 1);
  const pollMs = clampInt(opts.pollMs ?? 1500, 500, 10000, 1500);

  const maxPosts = clampInt(opts.maxPosts ?? 300, 10, 5000, 300);
  const maxPages = clampInt(opts.maxPages ?? 20, 1, 200, 20);

  const perPostDelayMs = clampInt(opts.perPostDelayMs ?? 120, 0, 5000, 120);
  const perPageDelayMs = clampInt(opts.perPageDelayMs ?? 150, 0, 5000, 150);

  const log =
    opts.log ??
    ((msg: string, extra?: any) => {
      try {
        console.log(msg, extra ?? "");
      } catch {
        console.log(msg);
      }
    });

  let active = 0;
  let stopped = false;

  // ✅ backoff simples quando der erro geral (db/network)
  let errorStreak = 0;
  const maxBackoff = 8000;

  /**
   * ✅ Claim ATÔMICO:
   * - funciona mesmo com múltiplas instâncias do worker
   * - pega o primeiro queued e já marca running numa única transação
   */
  async function claimOneJobAtomic() {
    return prisma.$transaction(async (tx) => {
      const job = await tx.instagramBackfillJob.findFirst({
        where: { status: "queued" },
        orderBy: { createdAt: "asc" },
      });

      if (!job) return null;

      // ⚠️ evita race condition: só atualiza se ainda estiver queued
      const updated = await tx.instagramBackfillJob.updateMany({
        where: { id: job.id, status: "queued" },
        data: {
          status: "running",
          startedAt: new Date(),
          lastError: null,
        },
      });

      if (updated.count !== 1) return null;

      return job;
    });
  }

  async function failJob(jobId: string, msg: string) {
    await prisma.instagramBackfillJob.update({
      where: { id: jobId },
      data: { status: "error", lastError: msg, finishedAt: new Date() },
    });
  }

  async function processJob(job: {
    id: string;
    userId: string;
    instagramAccountId: string | null;
    cursor: string | null;
  }) {
    log("[IG BACKFILL] start job", {
      jobId: job.id,
      userId: job.userId,
      instagramAccountId: job.instagramAccountId,
      cursor: job.cursor,
    });

    try {
      // pega conta IG (multi-conta suportada)
      const account = await prisma.instagramAccount.findFirst({
        where: {
          userId: job.userId,
          isConnected: true,
          ...(job.instagramAccountId ? { id: job.instagramAccountId } : {}),
        },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          instagramId: true,
          accessToken: true,
          pageAccessToken: true,
        },
      });

      const igUserId = account?.instagramId ? String(account.instagramId) : null;
      const accessToken = (account?.pageAccessToken ?? account?.accessToken) ?? null;

      if (!igUserId || !accessToken) {
        await failJob(job.id, "Instagram não conectado ou token/instagramId ausente");
        log("[IG BACKFILL] job error: missing creds", { jobId: job.id });
        return;
      }

      // garante que o job está amarrado à conta (se não veio)
      if (!job.instagramAccountId && account?.id) {
        await prisma.instagramBackfillJob.update({
          where: { id: job.id },
          data: { instagramAccountId: account.id },
        });
      }

      // ✅ Executa o service
      // (Se você quiser popular instagramPostInsightResults durante o backfill,
      //  você pode evoluir o InstagramBackfillService pra chamar opts.onPostImported)
      await service.run({
        userId: job.userId,
        instagramAccountId: account?.id ?? null,
        igUserId,
        accessToken,
        jobId: job.id,
        maxPosts,
        maxPages,
        perPostDelayMs,
        perPageDelayMs,
        startAfterCursor: job.cursor,
        // ✅ hook opcional (só funciona se o service repassar/usar)
        onPostImported: opts.onPostImported,
      } as any);

      // ✅ Se o service não marcar como done, a gente garante aqui (opcional)
      // Não vou forçar "done" porque talvez seu service já finalize com cursor/status.
      log("[IG BACKFILL] job finished (service returned)", { jobId: job.id });

      // reset backoff em sucesso
      errorStreak = 0;
    } catch (e: any) {
      const msg = String(e?.message ?? e ?? "WORKER_ERROR");
      await failJob(job.id, msg);
      log("[IG BACKFILL] job exception", { jobId: job.id, error: msg });
    }
  }

  async function loop() {
    log("[IG BACKFILL] worker started", {
      concurrency,
      pollMs,
      maxPosts,
      maxPages,
      perPostDelayMs,
      perPageDelayMs,
    });

    while (!stopped) {
      try {
        // se tiver slot
        if (active < concurrency) {
          const job = await claimOneJobAtomic();
          if (job) {
            active++;

            processJob({
              id: job.id,
              userId: job.userId,
              instagramAccountId: job.instagramAccountId ?? null,
              cursor: job.cursor ?? null,
            })
              .catch(() => {})
              .finally(() => {
                active--;
              });
          }
        }

        // sucesso -> backoff não cresce
        await sleep(pollMs);
      } catch (e: any) {
        errorStreak++;
        const backoff = Math.min(maxBackoff, 500 * errorStreak);
        log("[IG BACKFILL] loop error/backoff", {
          error: String(e?.message ?? e ?? "LOOP_ERROR"),
          errorStreak,
          backoffMs: backoff,
        });
        await sleep(backoff);
      }
    }

    log("[IG BACKFILL] worker stopped");
  }

  loop().catch((e) => {
    log("[IG BACKFILL] fatal loop error", { error: String(e?.message ?? e ?? "FATAL") });
  });

  return {
    stop() {
      stopped = true;
    },
  };
}
