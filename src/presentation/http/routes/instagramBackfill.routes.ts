// src/presentation/http/routes/instagramBackfillRouter.ts
import { Router } from "express";
import { prisma } from "../../../infrastructure/db/prismaClient";
import { authMiddleware } from "../middlewares/authMiddleware";
import { Prisma } from "@prisma/client";
import {
  assertTopology,
  publish,
} from "../../../infrastructure/messaging/rabbit"; // ✅ garante topology + publica

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

function clampRangeMaxDays(from: Date, to: Date, maxDays: number) {
  // normaliza ordem
  let start = from.getTime() <= to.getTime() ? from : to;
  let end = from.getTime() <= to.getTime() ? to : from;

  const maxMs = (maxDays - 1) * 24 * 60 * 60 * 1000;
  const diff = end.getTime() - start.getTime();

  if (diff <= maxMs) return { from: start, to: end };

  // corta pelo final, mantém "to" e puxa "from"
  const newFrom = new Date(end.getTime() - maxMs);
  return { from: newFrom, to: end };
}

// helpers para enviar datas como YYYY-MM-DD (estável p/ analytics)
function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function ymdUtc(d: Date) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(
    d.getUTCDate()
  )}`;
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
 *         from: "2026-01-01T00:00:00.000Z"
 *         to: "2026-01-30T00:00:00.000Z"
 *         maxPosts: 200
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
 *     summary: Iniciar backfill de posts do Instagram (assíncrono via worker)
 *     description: >
 *       Cria um job em background para importar posts do Instagram e buscar métricas por post,
 *       salvando no banco.
 *
 *       ⚠️ O processamento ocorre de forma assíncrona (worker via RabbitMQ).
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

  // ✅ range default: últimos 30 dias
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const fromBody = parseDateOrNull(req.body?.from);
  const toBody = parseDateOrNull(req.body?.to);

  const { from, to } = clampRangeMaxDays(
    fromBody ?? defaultFrom,
    toBody ?? now,
    30
  );

  const dedupeKey = `${instagramAccountId}:${from.toISOString()}:${to.toISOString()}`;

  let job:
    | Awaited<ReturnType<typeof prisma.instagramBackfillJob.create>>
    | null = null;

  try {
    job = await prisma.instagramBackfillJob.create({
      data: {
        userId,
        instagramAccountId,
        status: "queued",
        from,
        to,
        dedupeKey,
        // maxPosts: typeof req.body?.maxPosts === "number" ? req.body.maxPosts : null,
      },
    });
  } catch (e: any) {
    const isP2002 =
      e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

    if (isP2002) {
      const existingByKey = await prisma.instagramBackfillJob.findFirst({
        where: { userId, dedupeKey },
        orderBy: { createdAt: "desc" },
      });

      if (existingByKey) job = existingByKey as any;
    }

    if (!job) throw e;
  }

  // ✅ PUBLICAR NO RABBITMQ COM PAYLOAD COMPLETO (o worker precisa disso)
  try {
    // garante fila/exchange/binds existirem antes de publicar
    await assertTopology();

    // pega dados necessários para o worker (igUserId + token válido)
    const acc = await prisma.instagramAccount.findFirst({
      where: {
        id: instagramAccountId,
        userId,
        isConnected: true,
      },
      select: {
        id: true,
        igUserId: true,
        accessToken: true,
        pageAccessToken: true,
      },
    });

    if (!acc?.igUserId) {
      await prisma.instagramBackfillJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          finishedAt: new Date(),
          lastError: "Conta IG inválida: igUserId ausente",
        },
      });

      return res.status(400).json({
        ok: false,
        error: "Conta Instagram inválida (igUserId ausente).",
      });
    }

    const accessToken = acc.pageAccessToken ?? acc.accessToken;
    if (!accessToken) {
      await prisma.instagramBackfillJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          finishedAt: new Date(),
          lastError: "Conta IG inválida: token ausente (pageAccessToken/accessToken)",
        },
      });

      return res.status(400).json({
        ok: false,
        error: "Conta Instagram sem token válido (pageAccessToken/accessToken).",
      });
    }

    await publish("ig.analytics.ensure_range", {
      jobId: job.id,
      userId,
      instagramAccountId: acc.id,
      igUserId: acc.igUserId,
      accessToken,
      from: ymdUtc(from),
      to: ymdUtc(to),
      // se você for usar no worker:
      // maxPosts: typeof req.body?.maxPosts === "number" ? req.body.maxPosts : undefined,
    });
  } catch (e: any) {
    // marca como failed para você enxergar no status
    await prisma.instagramBackfillJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        lastError: `Falha ao publicar no RabbitMQ: ${String(e?.message ?? e)}`,
      },
    });

    return res.status(500).json({
      ok: false,
      error: "Falha ao enfileirar job no RabbitMQ",
      detail: String(e?.message ?? e),
    });
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
