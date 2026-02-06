// src/infrastructure/jobs/InstagramBackfillWorker.ts
import { prisma } from "../db/prismaClient";
import { RunInstagramBackfillUseCase } from "../../application/use-cases/instagram/RunInstagramBackfillUseCase";

// ✅ DI: repos + client + service
import { PrismaUserRepository } from "../db/repositories/user/PrismaUserRepository";
import { PrismaInstagramAccountRepository } from "../db/repositories/instagram/PrismaInstagramAccountRepository";
import { PrismaInstagramDailyMetricsRepository } from "../db/repositories/instagram/PrismaInstagramDailyMetricsRepository";
import { PrismaMetricsSnapshotRepository } from "../db/repositories/metrics/PrismaMetricsSnapshotRepository";

import { AxiosInstagramBackfillClient } from "../instagram/clients/AxiosInstagramBackfillClient";
import { InstagramBackfillService } from "../../application/services/instagram/InstagramBackfillService";

type BackfillJob = {
  jobId: string;
  userId: string;
  instagramAccountId?: string | null;
  from: string;
  to: string;
  force?: boolean;
  refillZeros?: boolean;
};

function s(v: any): string {
  return String(v ?? "").trim();
}

function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

function toYmd(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function nowTag() {
  const d = new Date();
  return `${toYmd(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(
    d.getSeconds()
  )}`;
}

/**
 * Se seu model InstagramBackfillJob NÃO tiver "from/to",
 * a gente aplica defaults:
 * - from: hoje - 90 dias
 * - to: hoje
 */
function resolveFromTo(job: any): { from: string; to: string } {
  const today = new Date();
  const defFrom = toYmd(addDays(today, -90));
  const defTo = toYmd(today);

  const from = s(job?.from ?? "").slice(0, 10) || defFrom;
  const to = s(job?.to ?? "").slice(0, 10) || defTo;

  // garante consistência
  if (from && to && from > to) return { from: to, to: from };
  return { from, to };
}

type WorkerOptions = {
  maxParallelJobs?: number;
  jobPollIntervalMs?: number;
  backfillConcurrency?: number;
  alwaysRefetchLastDays?: number;

  // logging
  logEveryTicks?: number;
};

export class InstagramBackfillWorker {
  private readonly queue: BackfillJob[] = []; // opcional (debug/manual)
  private running = 0;
  private started = false;
  private tickCount = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly useCase: RunInstagramBackfillUseCase,
    private readonly options?: WorkerOptions
  ) {}

  start() {
    if (this.started) return;
    this.started = true;

    const poll = Math.max(
      250,
      Number(this.options?.jobPollIntervalMs ?? 1500) || 1500
    );

    console.log(`🧵 [IG BACKFILL][${nowTag()}] Worker STARTED`, {
      pollMs: poll,
      maxParallelJobs: this.options?.maxParallelJobs ?? 1,
      backfillConcurrency: this.options?.backfillConcurrency ?? 2,
      alwaysRefetchLastDays: this.options?.alwaysRefetchLastDays ?? 7,
    });

    // sanity: testa conexão prisma no boot
    prisma
      .$queryRaw`SELECT 1`
      .then(() =>
        console.log(`✅ [IG BACKFILL][${nowTag()}] Prisma connection OK`)
      )
      .catch((e: any) =>
        console.error(
          `❌ [IG BACKFILL][${nowTag()}] Prisma connection FAIL:`,
          e?.message ?? e
        )
      );

    // loop
    this.timer = setInterval(() => {
      this.tick().catch((e) => {
        console.error(
          `❌ [IG BACKFILL][${nowTag()}] tick() crashed:`,
          e?.message ?? e
        );
      });
    }, poll);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.started = false;
    console.log(`🛑 [IG BACKFILL][${nowTag()}] Worker STOPPED`);
  }

  enqueue(job: Omit<BackfillJob, "jobId">) {
    const jobId = `bf_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    this.queue.push({ jobId, ...job });

    console.log(`📥 [IG BACKFILL][${nowTag()}] enqueue(memory)`, {
      jobId,
      userId: job.userId,
      instagramAccountId: job.instagramAccountId ?? null,
      from: job.from,
      to: job.to,
    });

    return { jobId };
  }

  getStats() {
    return {
      queuedInMemory: this.queue.length,
      running: this.running,
      maxParallelJobs: Math.max(
        1,
        Number(this.options?.maxParallelJobs ?? 1) || 1
      ),
    };
  }

  private shouldLogTick() {
    const every = Math.max(1, Number(this.options?.logEveryTicks ?? 10) || 10);
    return this.tickCount % every === 0;
  }

  private async tick() {
    this.tickCount++;

    const maxParallel = Math.max(
      1,
      Number(this.options?.maxParallelJobs ?? 1) || 1
    );

    if (this.shouldLogTick()) {
      console.log(`🔁 [IG BACKFILL][${nowTag()}] tick #${this.tickCount}`, {
        running: this.running,
        maxParallel,
        memQueue: this.queue.length,
      });
    }

    if (this.running >= maxParallel) {
      if (this.shouldLogTick()) {
        console.log(
          `⏭️ [IG BACKFILL][${nowTag()}] skip tick (running>=maxParallel)`
        );
      }
      return;
    }

    // 1) prioridade: consumir DB
    const dbJob = await this.takeNextDbJob();
    if (dbJob) {
      console.log(`🎯 [IG BACKFILL][${nowTag()}] got DB job`, {
        id: dbJob.id,
        status: dbJob.status,
        userId: dbJob.userId,
        instagramAccountId: dbJob.instagramAccountId,
      });

      this.running++;
      this.runDbJob(dbJob)
        .catch((e) => {
          console.error(
            `❌ [IG BACKFILL][${nowTag()}] runDbJob crashed:`,
            e?.message ?? e
          );
        })
        .finally(() => {
          this.running--;
          console.log(`⬇️ [IG BACKFILL][${nowTag()}] job finished (slot freed)`, {
            running: this.running,
          });
        });
      return;
    }

    // 2) fallback: fila em memória
    if (this.queue.length === 0) return;

    const memJob = this.queue.shift();
    if (!memJob) return;

    console.log(`🎯 [IG BACKFILL][${nowTag()}] got MEMORY job`, {
      jobId: memJob.jobId,
      userId: memJob.userId,
      instagramAccountId: memJob.instagramAccountId ?? null,
      from: memJob.from,
      to: memJob.to,
    });

    this.running++;
    this.runMemoryJob(memJob)
      .catch((e) => {
        console.error(
          `❌ [IG BACKFILL][${nowTag()}] runMemoryJob crashed:`,
          e?.message ?? e
        );
      })
      .finally(() => {
        this.running--;
      });
  }

  /**
   * ✅ Claim atômico com transação:
   * - pega o mais antigo queued
   * - tenta mudar para running
   * - se alguém pegou antes, retorna null
   */
  private async takeNextDbJob() {
    try {
      const queuedCount = await prisma.instagramBackfillJob.count({
        where: { status: "queued" },
      });

      if (this.shouldLogTick()) {
        console.log(
          `📊 [IG BACKFILL][${nowTag()}] DB queuedCount=${queuedCount}`
        );
      }

      if (queuedCount === 0) return null;
    } catch (e: any) {
      console.error(
        `❌ [IG BACKFILL][${nowTag()}] count queued failed:`,
        e?.message ?? e
      );
      return null;
    }

    try {
      const runningJob = await prisma.$transaction(async (tx) => {
        const job = await tx.instagramBackfillJob.findFirst({
          where: { status: "queued" },
          orderBy: { createdAt: "asc" },
        });

        if (!job) return null;

        const claimed = await tx.instagramBackfillJob.updateMany({
          where: { id: job.id, status: "queued" },
          data: { status: "running", startedAt: new Date(), lastError: null },
        });

        if (claimed.count !== 1) return null;

        return tx.instagramBackfillJob.findUnique({ where: { id: job.id } });
      });

      return runningJob;
    } catch (e: any) {
      console.error(
        `❌ [IG BACKFILL][${nowTag()}] claim transaction failed:`,
        e?.message ?? e
      );
      return null;
    }
  }

  private async runDbJob(job: any) {
    const userId = s(job?.userId);
    const instagramAccountId = job?.instagramAccountId ?? null;
    const { from, to } = resolveFromTo(job);

    console.log(`🚧 [IG BACKFILL][${nowTag()}] RUN DB JOB`, {
      id: job.id,
      userId,
      instagramAccountId,
      from,
      to,
      concurrency: this.options?.backfillConcurrency ?? 2,
      alwaysRefetchLastDays: this.options?.alwaysRefetchLastDays ?? 7,
    });

    try {
      await this.useCase.execute({
        userId,
        instagramAccountId,
        from,
        to,
        force: !!job?.force,
        refillZeros: job?.refillZeros ?? true,
        alwaysRefetchLastDays: this.options?.alwaysRefetchLastDays ?? 7,
        concurrency: this.options?.backfillConcurrency ?? 2,
      });

      await prisma.instagramBackfillJob.update({
        where: { id: job.id },
        data: { status: "done", finishedAt: new Date(), lastError: null },
      });

      console.log(`✅ [IG BACKFILL][${nowTag()}] DONE`, { id: job.id });
    } catch (err: any) {
      const message = s(err?.message) || s(err) || "Erro desconhecido no backfill";

      console.error(`❌ [IG BACKFILL][${nowTag()}] FAILED`, {
        id: job.id,
        error: message,
      });

      await prisma.instagramBackfillJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          finishedAt: new Date(),
          lastError: message.slice(0, 4000),
        },
      });
    }
  }

  private async runMemoryJob(job: BackfillJob) {
    const userId = s(job.userId);
    const from = s(job.from).slice(0, 10);
    const to = s(job.to).slice(0, 10);

    console.log(`🚧 [IG BACKFILL][${nowTag()}] RUN MEMORY JOB`, {
      jobId: job.jobId,
      userId,
      instagramAccountId: job.instagramAccountId ?? null,
      from,
      to,
      concurrency: this.options?.backfillConcurrency ?? 2,
      alwaysRefetchLastDays: this.options?.alwaysRefetchLastDays ?? 7,
    });

    await this.useCase.execute({
      userId,
      instagramAccountId: job.instagramAccountId ?? null,
      from,
      to,
      force: !!job.force,
      refillZeros: job.refillZeros ?? true,
      alwaysRefetchLastDays: this.options?.alwaysRefetchLastDays ?? 7,
      concurrency: this.options?.backfillConcurrency ?? 2,
    });
  }
}

/* =========================
   UseCase Factory (DI)
========================= */

function makeRunInstagramBackfillUseCase() {
  const userRepo = new PrismaUserRepository();
  const instagramAccountRepo = new PrismaInstagramAccountRepository();
  const dailyMetricsRepo = new PrismaInstagramDailyMetricsRepository();
  const metricsSnapshotRepo = new PrismaMetricsSnapshotRepository();

  const backfillClient = new AxiosInstagramBackfillClient();
  const backfillService = new InstagramBackfillService(
    backfillClient,
    dailyMetricsRepo
  );

  return new RunInstagramBackfillUseCase(
    userRepo,
    instagramAccountRepo,
    dailyMetricsRepo,
    metricsSnapshotRepo,
    backfillService
  );
}

/* =========================
   Singleton + Start helper
========================= */

let singleton: InstagramBackfillWorker | null = null;

export function getInstagramBackfillWorkerSingleton() {
  if (singleton) return singleton;

  singleton = new InstagramBackfillWorker(makeRunInstagramBackfillUseCase(), {
    maxParallelJobs: 1,
    jobPollIntervalMs: 1500,
    backfillConcurrency: 2,
    alwaysRefetchLastDays: 7,
    logEveryTicks: 10,
  });

  singleton.start();
  return singleton;
}

export function startInstagramBackfillWorker(opts?: {
  concurrency?: number;
  pollMs?: number;
  maxParallelJobs?: number;
  alwaysRefetchLastDays?: number;
  logEveryTicks?: number;

  // compat antigos
  maxPosts?: number;
  maxPages?: number;
  perPostDelayMs?: number;
  perPageDelayMs?: number;
}) {
  if (!singleton) {
    singleton = new InstagramBackfillWorker(makeRunInstagramBackfillUseCase(), {
      maxParallelJobs: Math.max(1, Number(opts?.maxParallelJobs ?? 1) || 1),
      jobPollIntervalMs: Math.max(250, Number(opts?.pollMs ?? 1500) || 1500),
      backfillConcurrency: Math.max(1, Number(opts?.concurrency ?? 2) || 2),
      alwaysRefetchLastDays: Math.max(
        0,
        Number(opts?.alwaysRefetchLastDays ?? 7) || 7
      ),
      logEveryTicks: Math.max(1, Number(opts?.logEveryTicks ?? 10) || 10),
    });
  }

  singleton.start();
  return singleton;
}
