// src/worker.ts

// ✅ OBRIGATÓRIO: carrega .env (RABBITMQ_URL, DATABASE_URL, etc)
import "dotenv/config";

import { assertTopology, consume } from "./infrastructure/messaging/rabbit";
import { prisma } from "./infrastructure/db/prismaClient";
import {
  ensurePostsAndMetricsInRange,
  type EnsureRangeProgress,
} from "./application/services/analytics/ensurePostsAndMetricsInRange";

/**
 * Payload recebido da fila.
 */
type EnsureRangeJobPayload = {
  jobId: string;
  userId: string;
  instagramAccountId: string;
  igUserId: string;
  accessToken: string;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
};

function isNonEmptyString(v: any): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function asNonEmptyStringOrThrow(v: any, field: string): string {
  if (!isNonEmptyString(v)) throw new Error(`Payload inválido: ${field} ausente`);
  return v.trim();
}

function asYmdOrThrow(v: any, field: string): string {
  const s = asNonEmptyStringOrThrow(v, field);
  // validação simples YYYY-MM-DD (range/ordem é validado no service)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new Error(`Payload inválido: ${field} deve ser YYYY-MM-DD`);
  }
  return s;
}

function assertPayload(raw: any): EnsureRangeJobPayload {
  if (!raw || typeof raw !== "object") throw new Error("Payload inválido");

  const jobId = asNonEmptyStringOrThrow(raw.jobId, "jobId");
  const userId = asNonEmptyStringOrThrow(raw.userId, "userId");
  const instagramAccountId = asNonEmptyStringOrThrow(
    raw.instagramAccountId,
    "instagramAccountId"
  );
  const igUserId = asNonEmptyStringOrThrow(raw.igUserId, "igUserId");
  const accessToken = asNonEmptyStringOrThrow(raw.accessToken, "accessToken");
  const from = asYmdOrThrow(raw.from, "from");
  const to = asYmdOrThrow(raw.to, "to");

  return { jobId, userId, instagramAccountId, igUserId, accessToken, from, to };
}

/**
 * Atualiza progresso do job no banco.
 * ✅ Só escreve quando vier número (evita gravar null/undefined).
 */
async function updateProgress(jobId: string, p: EnsureRangeProgress) {
  const data: any = {};

  if (typeof p.importedPosts === "number") data.importedCount = p.importedPosts;
  if (typeof p.processedMetrics === "number") data.processedCount = p.processedMetrics;

  // opcional: salvar mensagem de progresso (se existir no schema)
  // se não existir, deixa comentado.
  // if (typeof p.message === "string" && p.message.trim()) data.lastMessage = p.message.trim();

  // se não tem nada pra atualizar, não bate no banco
  if (Object.keys(data).length === 0) return;

  await prisma.instagramBackfillJob.update({
    where: { id: jobId },
    data,
  });
}

async function main() {
  console.log("[WORKER] Starting Instagram Analytics Worker…");

  // garante filas / exchanges
  await assertTopology();
  console.log("[WORKER] RabbitMQ topology asserted");

  // consumer fica rodando
  await consume("ig.analytics.ensure_range", async (msg) => {
    const raw = JSON.parse(msg.content.toString());
    const payload = assertPayload(raw);

    console.log("[WORKER] Job received:", payload.jobId);

    // marca job como running
    await prisma.instagramBackfillJob.update({
      where: { id: payload.jobId },
      data: {
        status: "running",
        startedAt: new Date(),
        finishedAt: null,
        lastError: null,
      },
    });

    try {
      const out = await ensurePostsAndMetricsInRange({
        userId: payload.userId,
        instagramAccountId: payload.instagramAccountId,
        igUserId: payload.igUserId,
        accessToken: payload.accessToken,
        from: payload.from,
        to: payload.to,

        // ✅ progresso: não deixa falha de update derrubar o job
        onProgress: async (p) => {
          try {
            await updateProgress(payload.jobId, p);
          } catch (e) {
            console.warn(
              "[WORKER] Failed to persist progress (ignored):",
              payload.jobId,
              String((e as any)?.message ?? e)
            );
          }
        },
      });

      // job finalizado com sucesso
      await prisma.instagramBackfillJob.update({
        where: { id: payload.jobId },
        data: {
          status: "done",
          finishedAt: new Date(),
          importedCount: out.ensuredPosts,
          processedCount: out.ensuredMetrics,
        },
      });

      console.log(
        `[WORKER] Job ${payload.jobId} done → posts=${out.ensuredPosts}, metrics=${out.ensuredMetrics}`
      );
    } catch (err: any) {
      const message = String(err?.message ?? err ?? "unknown error");
      console.error("[WORKER] Job failed:", payload.jobId, message);

      // ✅ IMPORTANTE: usa status compatível com seu schema
      await prisma.instagramBackfillJob.update({
        where: { id: payload.jobId },
        data: {
          status: "failed",
          finishedAt: new Date(),
          lastError: message,
        },
      });

      // relança para o consumer aplicar retry/DLQ (se estiver configurado)
      throw err;
    }
  });
}

// bootstrap
main().catch(async (e) => {
  console.error("[WORKER] Fatal error on startup", e);
  try {
    await prisma.$disconnect();
  } finally {
    process.exit(1);
  }
});

// shutdown gracioso
async function shutdown(signal: string) {
  console.log(`[WORKER] Shutting down… (${signal})`);
  try {
    await prisma.$disconnect();
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
