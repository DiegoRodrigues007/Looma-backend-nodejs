import { Router } from "express";
import { prisma } from "../../../infrastructure/db/prismaClient";
import { authMiddleware } from "../middlewares/authMiddleware";

const router = Router();

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
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               instagramAccountId:
 *                 type: string
 *                 description: ID da conta do Instagram (caso o usuário tenha múltiplas)
 *               maxPosts:
 *                 type: integer
 *                 example: 300
 *                 description: Limite máximo de posts a importar (opcional, para testes)
 *     responses:
 *       200:
 *         description: Job criado ou já existente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 jobId:
 *                   type: string
 *                 status:
 *                   type: string
 *                   enum: [queued, running, done, error]
 *                 importedCount:
 *                   type: integer
 *                 processedCount:
 *                   type: integer
 *       400:
 *         description: Conta do Instagram inválida ou não conectada
 *       401:
 *         description: Não autorizado
 */
router.post("/backfill/start", authMiddleware, async (req, res) => {
  const userId = (req as any).user?.sub as string;

  const instagramAccountId =
    (req.body?.instagramAccountId as string | undefined) ?? undefined;

  // evita duplicar job ativo
  const existing = await prisma.instagramBackfillJob.findFirst({
    where: {
      userId,
      status: { in: ["queued", "running"] },
      ...(instagramAccountId ? { instagramAccountId } : {}),
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
    });
  }

  // valida conta específica (se enviada)
  if (instagramAccountId) {
    const acc = await prisma.instagramAccount.findFirst({
      where: { id: instagramAccountId, userId, isConnected: true },
      select: { id: true },
    });

    if (!acc) {
      return res.status(400).json({
        ok: false,
        error: "InstagramAccount inválida ou não conectada",
      });
    }
  }

  const job = await prisma.instagramBackfillJob.create({
    data: {
      userId,
      instagramAccountId: instagramAccountId ?? null,
      status: "queued",
    },
  });

  return res.json({ ok: true, jobId: job.id, status: job.status });
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
 *     parameters:
 *       - in: query
 *         name: instagramAccountId
 *         required: false
 *         schema:
 *           type: string
 *         description: ID da conta do Instagram (para usuários com múltiplas contas)
 *     responses:
 *       200:
 *         description: Status do backfill
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 jobId:
 *                   type: string
 *                 status:
 *                   type: string
 *                   enum: [queued, running, done, error, none]
 *                 importedCount:
 *                   type: integer
 *                 processedCount:
 *                   type: integer
 *                 cursor:
 *                   type: string
 *                   nullable: true
 *                 startedAt:
 *                   type: string
 *                   format: date-time
 *                   nullable: true
 *                 finishedAt:
 *                   type: string
 *                   format: date-time
 *                   nullable: true
 *                 lastError:
 *                   type: string
 *                   nullable: true
 *                 instagramAccountId:
 *                   type: string
 *                   nullable: true
 *       401:
 *         description: Não autorizado
 */
router.get("/backfill/status", authMiddleware, async (req, res) => {
  const userId = (req as any).user?.sub as string;

  const instagramAccountId =
    (req.query?.instagramAccountId as string | undefined) ?? undefined;

  const job = await prisma.instagramBackfillJob.findFirst({
    where: {
      userId,
      ...(instagramAccountId ? { instagramAccountId } : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  if (!job) {
    return res.json({ ok: true, status: "none" });
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
