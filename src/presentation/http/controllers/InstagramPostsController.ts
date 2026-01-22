import { Request, Response } from "express";
import { prisma } from "../../../infrastructure/db/prismaClient";

function parseYmdToUtcStart(v: string): Date {
  return new Date(`${v}T00:00:00.000Z`);
}

function parseYmdToUtcEnd(v: string): Date {
  return new Date(`${v}T23:59:59.999Z`);
}

function isValidYmd(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime());
}

function getAuthenticatedUserId(req: Request): string | null {
  const anyReq = req as any;

  const fromUser =
    anyReq?.user?.sub ||
    anyReq?.user?.id ||
    anyReq?.user?.userId ||
    anyReq?.userId ||
    null;

  if (typeof fromUser === "string" && fromUser.trim()) return fromUser.trim();
  if (typeof fromUser === "number") return String(fromUser);

  const fromHeader = req.header("x-user-id");
  if (typeof fromHeader === "string" && fromHeader.trim()) return fromHeader.trim();

  return null;
}

export async function listInstagramPosts(req: Request, res: Response) {
  try {
    res.setHeader("Cache-Control", "no-store");

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
      : 20;

    if (from && !isValidYmd(from))
      return res.status(400).json({ ok: false, message: "from inválido (YYYY-MM-DD)" });

    if (to && !isValidYmd(to))
      return res.status(400).json({ ok: false, message: "to inválido (YYYY-MM-DD)" });

    if (from && to && from > to)
      return res.status(400).json({ ok: false, message: "Range inválido" });

    const where: any = { userId };

    if (instagramAccountId) {
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
    } else {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { activeInstagramAccountId: true },
      });

      if (user?.activeInstagramAccountId) {
        where.instagramAccountId = user.activeInstagramAccountId;
      }
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
      select: {
        id: true,
        igMediaId: true,
        instagramAccountId: true,
        mediaType: true,
        publishedAt: true,
        caption: true,
        permalink: true,
        likeCount: true,
        commentsCount: true,
        thumb: true,
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
      instagramAccountId: where.instagramAccountId ?? null,
      filters: { from: from || null, to: to || null, type: type || null, limit },
      posts: posts.map((p) => ({
        id: p.id,
        igMediaId: p.igMediaId,
        instagramAccountId: p.instagramAccountId,
        mediaType: p.mediaType ?? null,
        publishedAt: p.publishedAt,
        caption: p.caption ?? null,
        permalink: p.permalink ?? null,
        likeCount: p.likeCount ?? 0,
        commentsCount: p.commentsCount ?? 0,
        thumb: p.thumb ?? null,
        latestMetrics: p.metrics?.[0] ?? null,
      })),
    });
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      message: "Falha ao listar posts",
      detail: String(error?.message ?? error),
    });
  }
}
