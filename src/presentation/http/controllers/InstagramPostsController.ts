// src/presentation/http/controllers/InstagramPostsController.ts
import { Request, Response } from "express";
import { prisma } from "../../../infrastructure/db/prismaClient";
import { Prisma } from "@prisma/client";
import axios from "axios";

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

  // ✅ mantém compatível com seu authMiddleware (req.user.sub e req.user.userId)
  const fromUser =
    anyReq?.user?.sub ||
    anyReq?.user?.userId ||
    anyReq?.user?.id ||
    anyReq?.userId ||
    null;

  if (typeof fromUser === "string" && fromUser.trim()) return fromUser.trim();
  if (typeof fromUser === "number") return String(fromUser);

  // ✅ permite fallback em testes/ambientes que forçam header
  const fromHeader = req.header("x-user-id");
  if (typeof fromHeader === "string" && fromHeader.trim())
    return fromHeader.trim();

  return null;
}

function s(v: any): string {
  return String(v ?? "").trim();
}

function parseLimit(q: any, fallback = 20, max = 200): number {
  const n = typeof q === "string" ? Number(q) : typeof q === "number" ? q : NaN;
  if (Number.isFinite(n)) return Math.min(max, Math.max(1, Math.trunc(n)));
  return fallback;
}

/**
 * ✅ Meta provider error mapper (502)
 * - usado quando qualquer camada (client/use-case) lança AxiosError sem response (provider fora do ar)
 */
function mapMetaProviderError(err: unknown): { status: number; body: any } | null {
  if (!axios.isAxiosError(err)) return null;

  const code = String((err as any).code ?? "").toUpperCase();
  const hasResponse = !!err.response;

  const providerDownCodes = new Set([
    "ECONNREFUSED",
    "ENOTFOUND",
    "ETIMEDOUT",
    "ECONNRESET",
    "EAI_AGAIN",
    "EHOSTUNREACH",
    "ENETUNREACH",
  ]);

  // provider fora do ar: normalmente NÃO vem response
  if (!hasResponse && providerDownCodes.has(code)) {
    return {
      status: 502,
      body: {
        ok: false,
        message: "Falha ao consultar a Meta (provider fora do ar).",
        provider: "meta",
        code,
      },
    };
  }

  // timeout sem code confiável
  if (!hasResponse && /timeout/i.test(String(err.message ?? ""))) {
    return {
      status: 502,
      body: {
        ok: false,
        message: "Falha ao consultar a Meta (timeout).",
        provider: "meta",
      },
    };
  }

  return null;
}

/**
 * Resolve a conta de IG a ser usada (mesma lógica do sync):
 * - se vier instagramAccountId na query: valida ownership e usa
 * - senão: usa activeInstagramAccountId (se existir)
 * - fallback: última conta conectada (isConnected=true) por updatedAt desc
 */
async function resolveInstagramAccountId(
  userId: string,
  requestedId: string
): Promise<{ instagramAccountId: string | null; error?: any }> {
  const reqId = s(requestedId);

  if (reqId) {
    const owned = await prisma.instagramAccount.findFirst({
      where: { id: reqId, userId },
      select: { id: true },
    });

    if (!owned) {
      return {
        instagramAccountId: null,
        error: {
          status: 404,
          body: {
            ok: false,
            message: "instagramAccountId inválido ou não pertence ao usuário",
          },
        },
      };
    }

    return { instagramAccountId: owned.id };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { activeInstagramAccountId: true },
  });

  const activeId = s(user?.activeInstagramAccountId);
  if (activeId) {
    const ownedActive = await prisma.instagramAccount.findFirst({
      where: { id: activeId, userId },
      select: { id: true },
    });

    if (ownedActive) return { instagramAccountId: ownedActive.id };
  }

  const fallback = await prisma.instagramAccount.findFirst({
    where: { userId, isConnected: true },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  });

  return { instagramAccountId: fallback?.id ?? null };
}

function normalizeType(t: string): string {
  // aceita "reel", "reels", etc.
  const v = s(t).toUpperCase();
  if (!v) return "";
  if (v === "REELS") return "REEL";
  if (v === "REEL") return "REEL";
  if (v === "IMAGE") return "IMAGE";
  if (v === "VIDEO") return "VIDEO";
  if (v === "CAROUSEL_ALBUM") return "CAROUSEL_ALBUM";
  return v;
}

function prismaToHttpError(e: unknown): { status: number; body: any } | null {
  // ✅ erros comuns do Prisma -> respostas mais “limpas”
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    // P2025: record not found (quando usa update/delete/findUniqueOrThrow etc.)
    if (e.code === "P2025") {
      return {
        status: 404,
        body: { ok: false, message: "Registro não encontrado" },
      };
    }
    // P2002: unique constraint
    if (e.code === "P2002") {
      return {
        status: 409,
        body: { ok: false, message: "Conflito de dados (unique constraint)" },
      };
    }
    return {
      status: 400,
      body: { ok: false, message: "Erro de banco (Prisma)", code: e.code },
    };
  }

  if (e instanceof Prisma.PrismaClientValidationError) {
    return {
      status: 400,
      body: { ok: false, message: "Parâmetros inválidos (Prisma validation)" },
    };
  }

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

    const typeRaw =
      typeof req.query.type === "string" ? req.query.type.trim() : "";
    const type = normalizeType(typeRaw);

    const limit = parseLimit(req.query.limit, 20, 200);

    if (from && !isValidYmd(from)) {
      return res
        .status(400)
        .json({ ok: false, message: "from inválido (YYYY-MM-DD)" });
    }

    if (to && !isValidYmd(to)) {
      return res
        .status(400)
        .json({ ok: false, message: "to inválido (YYYY-MM-DD)" });
    }

    if (from && to && from > to) {
      return res.status(400).json({ ok: false, message: "Range inválido" });
    }

    const resolved = await resolveInstagramAccountId(userId, instagramAccountId);
    if (resolved.error) {
      return res.status(resolved.error.status).json(resolved.error.body);
    }

    const where: any = { userId };

    // Se achou conta, filtra. Se não achou nenhuma, retorna vazio (sem estourar 500)
    if (resolved.instagramAccountId) {
      where.instagramAccountId = resolved.instagramAccountId;
    } else {
      return res.json({
        ok: true,
        source: "database",
        total: 0,
        instagramAccountId: null,
        filters: {
          from: from || null,
          to: to || null,
          type: type || null,
          limit,
        },
        posts: [],
        message: "Nenhuma conta do Instagram conectada para este usuário",
      });
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
      filters: {
        from: from || null,
        to: to || null,
        type: type || null,
        limit,
      },
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
    // ✅ 1) Meta provider down -> 502
    const metaMapped = mapMetaProviderError(error);
    if (metaMapped) return res.status(metaMapped.status).json(metaMapped.body);

    // ✅ 2) Prisma -> respostas mais “limpas”
    const mapped = prismaToHttpError(error);
    if (mapped) return res.status(mapped.status).json(mapped.body);

    // ✅ Não vazar detalhes em produção (mas mantém útil em dev/test)
    const env = String(process.env.NODE_ENV ?? "").toLowerCase();
    const detail =
      env === "production"
        ? undefined
        : String(error?.stack || error?.message || error);

    return res.status(500).json({
      ok: false,
      message: "Falha ao listar posts",
      ...(detail ? { detail } : {}),
    });
  }
}