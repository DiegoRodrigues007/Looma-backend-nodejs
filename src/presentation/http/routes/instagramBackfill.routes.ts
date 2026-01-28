// src/presentation/http/routes/instagramBackfillRouter.ts
import { Router } from "express";
import { prisma } from "../../../infrastructure/db/prismaClient";
import { authMiddleware } from "../middlewares/authMiddleware";
import { Prisma } from "@prisma/client";

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
 * 1) requestedId (body/query) -> valida se pertence ao user e está conectada
 * 2) user.activeInstagramAccountId -> valida se está conectada
 * 3) conta conectada mais recente (updatedAt desc)
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

function parseDateOrNull(v: any): Date | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * ===========================
 * Swagger/OpenAPI Schemas
 * ===========================
 */

/**
 * @openapi
 * components:
 *   schemas:
 *     InstagramBackfillStartRequest:
 *       type: object
 *       additionalProperties: false
 *       properties:
 *         instagramAccountId:
 *           type: string
 *           description: >
 *             (Opcional) ID da conta Instagram conectada (instagramAccount.id).
 *             Se não enviar, o backend tenta usar a conta ativa do usuário
 *             (user.activeInstagramAccountId) ou a conta conectada mais recente.
 *         from:
 *           type: string
 *           format: date-time
 *           description: >
 *             (Opcional) Data/hora inicial do backfill. Se não enviar, o backend usa um default seguro.
 *         to:
 *           type: string
 *           format: date-time
 *           description: >
 *             (Opcional) Data/hora final do backfill. Se não enviar, o backend usa um default seguro.
 *         maxPosts:
 *           type: integer
 *           minimum: 1
 *           maximum: 5000
 *           description: >
 *             (Opcional) Limite de posts para backfill (útil para teste).
 *             Só terá efeito se o worker/implementação usar esse campo.
 *       example:
 *         instagramAccountId: "b3b3b3b3-1111-2222-3333-aaaaaaaaaaaa"
 *         from: "2025-01-01T00:00:00.000Z"
 *         to: "2026-01-24T00:00:00.000Z"
 *         maxPosts: 100
 *
 *     InstagramBackfillStartResponse:
 *       type: object
 *       additionalProperties: false
 *       properties:
 *         ok:
 *           type: boolean
 *         jobId:
 *           type: string
 *         status:
 *           type: string
 *           enum: [queued, running, done, failed, cancelled]
 *         importedCount:
 *           type: integer
 *           nullable: true
 *         processedCount:
 *           type: integer
 *           nullable: true
 *         instagramAccountId:
 *           type: string
 *       required: [ok, jobId, status, instagramAccountId]
 *
 *     InstagramBackfillStatusResponse:
 *       type: object
 *       additionalProperties: false
 *       properties:
 *         ok:
 *           type: boolean
 *         status:
 *           type: string
 *           description: >
 *             Estado do job. "none" quando não existe job para a conta resolvida.
 *           enum: [none, queued, running, done, failed, cancelled]
 *         jobId:
 *           type: string
 *           nullable: true
 *         importedCount:
 *           type: integer
 *           nullable: true
 *         processedCount:
 *           type: integer
 *           nullable: true
 *         cursor:
 *           type: string
 *           nullable: true
 *         startedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         finishedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         lastError:
 *           type: string
 *           nullable: true
 *         instagramAccountId:
 *           type: string
 *           nullable: true
 *       required: [ok, status]
 */

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
 *             $ref: '#/components/schemas/InstagramBackfillStartRequest'
 *     responses:
 *       200:
 *         description: Job criado (ou job ativo reaproveitado)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/InstagramBackfillStartResponse'
 *       400:
 *         description: Nenhuma conta Instagram conectada encontrada (ou instagramAccountId inválido)
 *       401:
 *         description: Não autorizado (token ausente/inválido)
 */
router.post("/backfill/start", authMiddleware, async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    return res.status(401).json({ ok: false, error: "Não autorizado" });
  }

  const requestedAccountId =
    String(req.body?.instagramAccountId ?? "").trim() || undefined;

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

  // ✅ Se já existir job ativo, reaproveita
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

  // ✅ Agora: Prisma exige from/to/dedupeKey
  // Se o client mandar, usamos. Se não, usamos defaults seguros:
  // - from: 90 dias atrás
  // - to: agora
  const fromBody = parseDateOrNull(req.body?.from);
  const toBody = parseDateOrNull(req.body?.to);

  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  const from = fromBody ?? defaultFrom;
  const to = toBody ?? now;

  // Se vier invertido, corrige (evita job inválido)
  const finalFrom = from.getTime() <= to.getTime() ? from : to;
  const finalTo = from.getTime() <= to.getTime() ? to : from;

  const dedupeKey = `${instagramAccountId}:${finalFrom.toISOString()}:${finalTo.toISOString()}`;

  // ✅ AJUSTE NECESSÁRIO: idempotência + concorrência
  // Dois requests simultâneos podem tentar criar o mesmo dedupeKey.
  // Nesse caso, Prisma lança P2002 (unique constraint) -> buscamos e reaproveitamos.
  let job:
    | Awaited<ReturnType<typeof prisma.instagramBackfillJob.create>>
    | null = null;

  try {
    job = await prisma.instagramBackfillJob.create({
      data: {
        userId,
        instagramAccountId,
        status: "queued",
        from: finalFrom,
        to: finalTo,
        dedupeKey,
        // se existir no schema:
        // maxPosts,
      },
    });
  } catch (e: any) {
    const isP2002 =
      e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

    if (isP2002) {
      // ✅ corrida detectada: alguém já criou o job
      const existingByKey = await prisma.instagramBackfillJob.findFirst({
        where: { userId, dedupeKey },
        orderBy: { createdAt: "desc" },
      });

      if (existingByKey) {
        job = existingByKey as any;
      }
    }

    if (!job) {
      throw e;
    }
  }

  return res.json({
    ok: true,
    jobId: job.id,
    status: job.status,
    importedCount: job.importedCount,
    processedCount: job.processedCount,
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
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: instagramAccountId
 *         required: false
 *         schema:
 *           type: string
 */
router.get("/backfill/status", authMiddleware, async (req, res) => {
  const userId = getUserId(req);
  if (!userId) {
    return res.status(401).json({ ok: false, error: "Não autorizado" });
  }

  const requestedAccountId =
    String(req.query?.instagramAccountId ?? "").trim() || undefined;

  const instagramAccountId = await resolveInstagramAccountId({
    userId,
    requestedId: requestedAccountId,
  });

  if (!instagramAccountId) {
    return res.json({ ok: true, status: "none", instagramAccountId: null });
  }

  const job = await prisma.instagramBackfillJob.findFirst({
    where: { userId, instagramAccountId },
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