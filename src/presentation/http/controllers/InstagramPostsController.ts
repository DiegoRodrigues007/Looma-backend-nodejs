import { Request, Response } from "express";
import { prisma } from "../../../infrastructure/db/prismaClient";

function parseYmdToUtcStart(v: string): Date {
  // YYYY-MM-DD -> UTC 00:00
  return new Date(`${v}T00:00:00.000Z`);
}

function parseYmdToUtcEnd(v: string): Date {
  // YYYY-MM-DD -> UTC 23:59:59.999
  return new Date(`${v}T23:59:59.999Z`);
}

function getAuthenticatedUserId(req: Request): string | null {
  const anyReq = req as any;

  const fromUser =
    anyReq?.user?.sub ||
    anyReq?.user?.id ||
    anyReq?.user?.userId ||
    anyReq?.userId ||
    null;

  if (typeof fromUser === "string" && fromUser.trim().length > 0)
    return fromUser.trim();
  if (typeof fromUser === "number") return String(fromUser);

  const fromHeader = req.header("x-user-id");
  if (typeof fromHeader === "string" && fromHeader.trim().length > 0)
    return fromHeader.trim();

  return null;
}

/**
 * @openapi
 * /api/instagram/posts:
 *   get:
 *     tags:
 *       - Instagram Posts
 *     summary: Listar posts importados do Instagram (DB-first)
 *     description: >
 *       Retorna posts já salvos no banco (via backfill), com a última métrica coletada por post.
 *       Ideal para exibir conteúdo histórico mesmo quando o usuário conectou hoje.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: instagramAccountId
 *         required: false
 *         schema:
 *           type: string
 *         description: Filtra posts pela conta ativa do Instagram (recomendado em multi-conta)
 *       - in: query
 *         name: from
 *         required: false
 *         schema:
 *           type: string
 *           example: "2025-12-01"
 *         description: Data inicial (YYYY-MM-DD)
 *       - in: query
 *         name: to
 *         required: false
 *         schema:
 *           type: string
 *           example: "2026-01-14"
 *         description: Data final (YYYY-MM-DD)
 *       - in: query
 *         name: type
 *         required: false
 *         schema:
 *           type: string
 *           example: "REELS"
 *         description: Filtra por tipo de mídia (ex.: REELS, IMAGE, CAROUSEL_ALBUM, VIDEO)
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           example: 50
 *         description: Quantidade máxima de itens (máx 200)
 *     responses:
 *       200:
 *         description: Lista de posts do banco
 *       401:
 *         description: Não autorizado
 */
export async function listInstagramPosts(req: Request, res: Response) {
  const userId = getAuthenticatedUserId(req);
  if (!userId) {
    return res.status(401).json({ ok: false, message: "Não autenticado" });
  }

  const instagramAccountId =
    typeof req.query.instagramAccountId === "string"
      ? req.query.instagramAccountId.trim()
      : "";

  const from = typeof req.query.from === "string" ? req.query.from.trim() : "";
  const to = typeof req.query.to === "string" ? req.query.to.trim() : "";
  const type = typeof req.query.type === "string" ? req.query.type.trim() : "";

  const limitRaw =
    typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;

  const limit = Number.isFinite(limitRaw)
    ? Math.min(200, Math.max(1, limitRaw!))
    : 50;

  // ✅ filtro base: sempre por userId
  const where: any = { userId };

  // ✅ multi-conta: filtra por instagramAccountId quando vier
  if (instagramAccountId) {
    // opcional: valida se a conta é do user (evita "ver posts de outro user")
    const owned = await prisma.instagramAccount.findFirst({
      where: { id: instagramAccountId, userId },
      select: { id: true },
    });

    if (!owned) {
      return res.status(404).json({
        ok: false,
        message: "instagramAccountId inválido ou não pertence ao usuário",
      });
    }

    where.instagramAccountId = instagramAccountId;
  }

  if (type) where.mediaType = type;

  if (from || to) {
    where.publishedAt = {};
    if (from) where.publishedAt.gte = parseYmdToUtcStart(from);
    if (to) where.publishedAt.lte = parseYmdToUtcEnd(to);
  }

  const posts = await prisma.instagramPost.findMany({
    where,
    orderBy: { publishedAt: "desc" },
    take: limit,
    include: {
      metrics: {
        orderBy: { pulledAt: "desc" },
        take: 1,
        select: {
          pulledAt: true,
          reach: true,
          likes: true,
          comments: true,
          shares: true,
          saves: true,
          plays: true,
          videoViews: true,
          totalInteractions: true,
        },
      },
    },
  });

  return res.json({
    ok: true,
    source: "database",
    total: posts.length,
    instagramAccountId: instagramAccountId || null,
    posts: posts.map((p) => ({
      id: p.id,
      igMediaId: p.igMediaId,
      mediaType: p.mediaType ?? null,
      publishedAt: p.publishedAt,
      caption: p.caption ?? null,
      permalink: p.permalink ?? null,
      likeCount: p.likeCount ?? 0,
      commentsCount: p.commentsCount ?? 0,
      latestMetrics: p.metrics?.[0] ?? null,
    })),
  });
}
