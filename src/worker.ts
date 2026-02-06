// src/worker.ts

// ✅ OBRIGATÓRIO: carrega .env (RABBITMQ_URL, DATABASE_URL, etc)
import "dotenv/config";

import { assertTopology, consume } from "./infrastructure/messaging/rabbit";
import { prisma } from "./infrastructure/db/prismaClient";
import {
  ensurePostsAndMetricsInRange,
  type EnsureRangeProgress,
} from "./application/services/analytics/ensurePostsAndMetricsInRange";

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

function asYmdOrThrow(v: any, field: string): string {
  if (!isNonEmptyString(v)) throw new Error(`Payload inválido: ${field} ausente`);
  // validação simples YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) {
    throw new Error(`Payload inválido: ${field} deve ser YYYY-MM-DD`);
  }
  return v.trim();
}

function assertPayload(raw: any): EnsureRangeJobPayload {
  if (!raw || typeof raw !== "object") throw new Error("Payload inválido");

  const jobId = String(raw.jobId ?? "").trim();
  const userId = String(raw.userId ?? "").trim();
  const instagramAccountId = String(raw.instagramAccountId ?? "").trim();
  const igUserId = String(raw.igUserId ?? "").trim();
  const accessToken = String(raw.accessToken ?? "").trim();
  const from = asYmdOrThrow(raw.from, "from");
  const to = asYmdOrThrow(raw.to, "to");

  if (!jobId) throw new Error("Payload inválido: jobId ausente");
  if (!userId) throw new Error("Payload inválido: userId ausente");
  if (!instagramAccountId) throw new Error("Payload inválido: instagramAccountId ausente");
  if (!igUserId) throw new Error("Payload inválido: igUserId ausente");
  if (!accessToken) throw new Error("Payload inválido: accessToken ausente");

  return { jobId, userId, instagramAccountId, igUserId, accessToken, from, to };
}

async function updateProgress(jobId: string, p: EnsureRangeProgress) {
  await prisma.instagramBackfillJob.update({
    where: { id: jobId },
    data: {
      importedCount: p.importedPosts,
      processedCount: p.processedMetrics,
    },
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
        onProgress: async (p) => updateProgress(payload.jobId, p),
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

      // ✅ IMPORTANTE: no seu schema os status parecem ser:
      // queued | running | done | failed | cancelled
      // então aqui usamos "failed" (não "error")
      await prisma.instagramBackfillJob.update({
        where: { id: payload.jobId },
        data: {
          status: "failed",
          finishedAt: new Date(),
          lastError: message,
        },
      });

      // relança para o consumer aplicar retry/DLQ
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
process.on("SIGINT", async () => {
  console.log("[WORKER] Shutting down…");
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("[WORKER] Shutting down…");
  await prisma.$disconnect();
  process.exit(0);
});
