// src/presentation/http/routes/instagramBackfillRouter.ts
import { Router } from "express";
import { prisma } from "../../../infrastructure/db/prismaClient";
import { authMiddleware } from "../middlewares/authMiddleware";

const router = Router();

function getUserId(req: any): string | null {
  const v =
    req?.user?.sub ||
    req?.user?.id ||
    req?.user?.userId ||
    req?.userId ||
    null;

  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number") return String(v);
  return null;
}

/**
 * Resolve a conta que o backfill vai usar:
 * 1) body.instagramAccountId (se veio)
 * 2) user.activeInstagramAccountId
 * 3) conta conectada mais recente
 */
async function resolveInstagramAccountId(opts: {
  userId: string;
  requestedId?: string | undefined;
}): Promise<string | null> {
  const { userId, requestedId } = opts;

  if (requestedId) {
    const acc = await prisma.instagramAccount.findFirst({
      where: {
        id: requestedId,
        userId,
        isConnected: true,
        OR: [{ pageAccessToken: { not: null } }, { accessToken: { not: null } }],
      },
      select: { id: true },
    });
    return acc?.id ?? null;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { activeInstagramAccountId: true },
  });

  if (user?.activeInstagramAccountId) {
    const acc = await prisma.instagramAccount.findFirst({
      where: {
        id: user.activeInstagramAccountId,
        userId,
        isConnected: true,
        OR: [{ pageAccessToken: { not: null } }, { accessToken: { not: null } }],
      },
      select: { id: true },
    });

    if (acc?.id) return acc.id;
  }

  const latest = await prisma.instagramAccount.findFirst({
    where: {
      userId,
      isConnected: true,
      OR: [{ pageAccessToken: { not: null } }, { accessToken: { not: null } }],
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });

  return latest?.id ?? null;
}

/**
 * @openapi
 * /api/instagram/backfill/start:
 *   post:
 *     tags:
 *       - Instagram Backfill
 *     summary: Iniciar backfill de posts antigos do Instagram
 *     description: >
 *       Cria um job em background para importar posts antigos do Instagram,
 *       buscar métricas por post (reach, saves, shares etc.)
 *       e salvar no banco para geração de insights.
 *
 *       ⚠️ O processamento ocorre de forma assíncrona (worker).
 *     security:
 *       - bearerAuth: []
 */
router.post("/backfill/start", authMiddleware, async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ ok: false, error: "Não autorizado" });

  const requestedAccountId = String(req.body?.instagramAccountId ?? "").trim() || undefined;

  // ✅ resolve conta (obrigatória no schema)
  const instagramAccountId = await resolveInstagramAccountId({
    userId,
    requestedId: requestedAccountId,
  });

  if (!instagramAccountId) {
    return res.status(400).json({
      ok: false,
      error:
        "Nenhuma conta Instagram conectada encontrada (ou instagramAccountId inválido).",
    });
  }

  // ✅ evita duplicar job ativo (agora sempre por conta)
  const existing = await prisma.instagramBackfillJob.findFirst({
    where: {
      userId,
      instagramAccountId,
      status: { in: ["queued", "running"] },
    },
    orderBy: { createdAt: "desc" },
  });

  if (existing) {
    return res.json({
      ok: true,
      jobId: existing.id,
      status: existing.status,
      importedCount: existing.importedCount,
      processedCount: existing.processedCount,
      instagramAccountId: existing.instagramAccountId,
    });
  }

  const job = await prisma.instagramBackfillJob.create({
    data: {
      userId,
      instagramAccountId, // ✅ obrigatório
      status: "queued",
      // opcional: maxPosts pra teste (se você usa no worker, pode salvar num campo próprio)
      // maxPosts: Number(req.body?.maxPosts) || null,
    },
  });

  return res.json({
    ok: true,
    jobId: job.id,
    status: job.status,
    instagramAccountId: job.instagramAccountId,
  });
});

/**
 * @openapi
 * /api/instagram/backfill/status:
 *   get:
 *     tags:
 *       - Instagram Backfill
 *     summary: Consultar status do backfill do Instagram
 *     description: >
 *       Retorna o status do job de backfill mais recente,
 *       incluindo progresso, erros e timestamps.
 *     security:
 *       - bearerAuth: []
 */
router.get("/backfill/status", authMiddleware, async (req, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ ok: false, error: "Não autorizado" });

  const requestedAccountId = String(req.query?.instagramAccountId ?? "").trim() || undefined;

  // ✅ se vier query, valida; se não vier, tenta resolver igual ao start
  const instagramAccountId = await resolveInstagramAccountId({
    userId,
    requestedId: requestedAccountId,
  });

  if (!instagramAccountId) {
    return res.json({ ok: true, status: "none" });
  }

  const job = await prisma.instagramBackfillJob.findFirst({
    where: {
      userId,
      instagramAccountId,
    },
    orderBy: { createdAt: "desc" },
  });

  if (!job) {
    return res.json({ ok: true, status: "none", instagramAccountId });
  }

  return res.json({
    ok: true,
    jobId: job.id,
    status: job.status,
    importedCount: job.importedCount,
    processedCount: job.processedCount,
    cursor: job.cursor,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    lastError: job.lastError,
    instagramAccountId: job.instagramAccountId,
  });
});

export default router;
