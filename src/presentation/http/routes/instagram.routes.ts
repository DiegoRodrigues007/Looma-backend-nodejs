// src/presentation/http/routes/instagramRouter.ts
import { Router } from "express";
import { makeInstagramAuthController } from "../../composition/instagramComposition";
import { authMiddleware } from "../middlewares/authMiddleware";

// ✅ DB
import { prisma } from "../../../infrastructure/db/prismaClient";

export const instagramRouter = Router();
const controller = makeInstagramAuthController();

/**
 * Helper: transforma querystring "true"/"false" em boolean real.
 */
function parseBool(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  const s = String(value).toLowerCase();
  if (s === "true" || s === "1") return true;
  if (s === "false" || s === "0") return false;
  return undefined;
}

function parseYmdToUtcStart(v: string): Date {
  return new Date(`${v}T00:00:00.000Z`);
}
function parseYmdToUtcEnd(v: string): Date {
  return new Date(`${v}T23:59:59.999Z`);
}

function getUserIdFromReq(req: any): string | null {
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
 * =========================
 * AUTH FLOW
 * =========================
 */

/**
 * @openapi
 * /api/instagram/start:
 *   get:
 *     tags:
 *       - Instagram
 *     summary: Inicia o login do Instagram
 *     security:
 *       - bearerAuth: []
 */
instagramRouter.get("/start", authMiddleware, async (req, res) => {
  const redirect = parseBool(req.query.redirect);
  if (redirect !== undefined) {
    (req.query as any).redirect = redirect;
  }
  await controller.start(req, res);
});

/**
 * @openapi
 * /api/instagram/callback:
 *   get:
 *     tags:
 *       - Instagram
 *     summary: Callback do login do Instagram (público)
 */
instagramRouter.get("/callback", async (req, res) => {
  await controller.callback(req, res);
});

/**
 * @openapi
 * /api/instagram/status:
 *   get:
 *     tags:
 *       - Instagram
 *     summary: Retorna se há conta do Instagram conectada para o usuário logado
 *     security:
 *       - bearerAuth: []
 */
instagramRouter.get("/status", authMiddleware, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  await controller.status(req, res);
});

/**
 * =========================
 * MULTI-CONTA: ACTIVE ACCOUNT
 * =========================
 */

/**
 * ✅ Retorna conta ativa atual (activeInstagramAccountId) + dados básicos
 *
 * @openapi
 * /api/instagram/active:
 *   get:
 *     tags:
 *       - Instagram
 *     summary: Retorna a conta Instagram ativa do usuário logado
 *     security:
 *       - bearerAuth: []
 */
instagramRouter.get("/active", authMiddleware, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  const userId = getUserIdFromReq(req);
  if (!userId) return res.status(401).json({ ok: false, message: "Não autenticado" });

  const user = await prisma.user.findUnique({
    where: { id: String(userId) },
    select: {
      id: true,
      activeInstagramAccountId: true,
    },
  });

  if (!user?.activeInstagramAccountId) {
    return res.json({ ok: true, activeInstagramAccountId: null, account: null });
  }

  const acc = await prisma.instagramAccount.findFirst({
    where: {
      id: user.activeInstagramAccountId,
      userId: String(userId),
      isConnected: true,
      OR: [{ pageAccessToken: { not: null } }, { accessToken: { not: null } }],
    },
    select: {
      id: true,
      igUserId: true,
      username: true,
      accountType: true,
      facebookPageId: true,
      expiresAt: true,
      updatedAt: true,
      isConnected: true,
    },
  });

  return res.json({
    ok: true,
    activeInstagramAccountId: acc?.id ?? user.activeInstagramAccountId,
    account: acc
      ? {
          id: acc.id,
          igUserId: acc.igUserId,
          username: acc.username ?? null,
          accountType: acc.accountType ?? null,
          facebookPageId: acc.facebookPageId ?? null,
          expiresAt: acc.expiresAt ?? null,
          isConnected: acc.isConnected,
          updatedAt: acc.updatedAt,
        }
      : null,
  });
});

/**
 * ✅ Define a conta ativa do usuário
 * Body: { instagramAccountId: string }
 *
 * @openapi
 * /api/instagram/active:
 *   post:
 *     tags:
 *       - Instagram
 *     summary: Define a conta Instagram ativa do usuário logado
 *     security:
 *       - bearerAuth: []
 */
instagramRouter.post("/active", authMiddleware, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  const userId = getUserIdFromReq(req);
  if (!userId) return res.status(401).json({ ok: false, message: "Não autenticado" });

  const instagramAccountId = String(req.body?.instagramAccountId ?? "").trim();
  if (!instagramAccountId) {
    return res.status(400).json({ ok: false, message: "instagramAccountId é obrigatório" });
  }

  // ✅ se existir controller.setActive, usa ele (regra centralizada)
  if (typeof (controller as any).setActive === "function") {
    return (controller as any).setActive(req, res);
  }

  // fallback
  const exists = await prisma.instagramAccount.findFirst({
    where: {
      id: instagramAccountId,
      userId: String(userId),
      isConnected: true,
      OR: [{ pageAccessToken: { not: null } }, { accessToken: { not: null } }],
    },
    select: {
      id: true,
      igUserId: true,
      username: true,
      accountType: true,
      facebookPageId: true,
      updatedAt: true,
    },
  });

  if (!exists) {
    return res.status(404).json({
      ok: false,
      message: "Conta Instagram não encontrada para este usuário (ou não está conectada).",
    });
  }

  await prisma.user.update({
    where: { id: String(userId) },
    data: { activeInstagramAccountId: exists.id },
  });

  return res.json({
    ok: true,
    activeInstagramAccountId: exists.id,
    account: {
      id: exists.id,
      igUserId: exists.igUserId,
      username: exists.username ?? null,
      accountType: exists.accountType ?? null,
      facebookPageId: exists.facebookPageId ?? null,
      updatedAt: exists.updatedAt,
    },
  });
});

/**
 * ✅ Lista TODAS as contas Instagram conectadas do usuário (e marca a ativa)
 *
 * @openapi
 * /api/instagram/accounts:
 *   get:
 *     tags:
 *       - Instagram
 *     summary: Lista todas as contas do Instagram conectadas do usuário logado
 *     security:
 *       - bearerAuth: []
 */
instagramRouter.get("/accounts", authMiddleware, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  // ✅ prioridade: controller.accounts (usecase)
  if (typeof (controller as any).accounts === "function") {
    return (controller as any).accounts(req, res);
  }

  const userId = getUserIdFromReq(req);
  if (!userId) {
    return res.status(401).json({ ok: false, message: "Não autenticado" });
  }

  const user = await prisma.user.findUnique({
    where: { id: String(userId) },
    select: { activeInstagramAccountId: true },
  });

  const rows = await prisma.instagramAccount.findMany({
    where: {
      userId: String(userId),
      isConnected: true,
      OR: [{ pageAccessToken: { not: null } }, { accessToken: { not: null } }],
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      igUserId: true,
      username: true,
      accountType: true,
      facebookPageId: true,
      expiresAt: true,
      isConnected: true,
      updatedAt: true,
    },
    take: 50,
  });

  // ✅ se não existir ativa e tiver contas, define a primeira como ativa
  let activeId = user?.activeInstagramAccountId ?? null;
  const activeExists = activeId ? rows.some((r) => r.id === activeId) : false;

  if ((!activeId || !activeExists) && rows.length > 0) {
    activeId = rows[0].id;
    await prisma.user.update({
      where: { id: String(userId) },
      data: { activeInstagramAccountId: activeId },
    });
  }

  return res.json({
    ok: true,
    activeInstagramAccountId: activeId,
    total: rows.length,
    accounts: rows.map((r) => ({
      id: r.id,
      igUserId: r.igUserId,
      username: r.username ?? null,
      accountType: r.accountType ?? null,
      facebookPageId: r.facebookPageId ?? null,
      expiresAt: r.expiresAt ?? null,
      isConnected: r.isConnected,
      updatedAt: r.updatedAt,
      isActive: activeId ? r.id === activeId : false,
    })),
  });
});

/**
 * =========================
 * CANDIDATES + CONFIRM
 * =========================
 */

/**
 * Candidates para o usuário escolher a página/conta IG
 */
const candidatesHandler = async (req: any, res: any) => {
  res.setHeader("Cache-Control", "no-store");
  await controller.candidates(req, res);
};

instagramRouter.get("/candidates", authMiddleware, candidatesHandler);
instagramRouter.get("/pages", authMiddleware, candidatesHandler);
instagramRouter.get("/accounts/candidates", authMiddleware, candidatesHandler);
instagramRouter.get("/ig-candidates", authMiddleware, candidatesHandler);

/**
 * @openapi
 * /api/instagram/confirm:
 *   post:
 *     tags:
 *       - Instagram
 *     summary: Confirma seleção e persiste a conta/token necessários
 *     security:
 *       - bearerAuth: []
 */
instagramRouter.post("/confirm", authMiddleware, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  await controller.confirm(req, res);

  // ✅ extra: se confirmou e não definiu ativa, define a última conectada
  try {
    const userId = getUserIdFromReq(req);
    if (userId) {
      const user = await prisma.user.findUnique({
        where: { id: String(userId) },
        select: { activeInstagramAccountId: true },
      });

      if (!user?.activeInstagramAccountId) {
        const latest = await prisma.instagramAccount.findFirst({
          where: { userId: String(userId), isConnected: true },
          orderBy: { updatedAt: "desc" },
          select: { id: true },
        });

        if (latest?.id) {
          await prisma.user.update({
            where: { id: String(userId) },
            data: { activeInstagramAccountId: latest.id },
          });
        }
      }
    }
  } catch {
    // ignora
  }
});

/**
 * @openapi
 * /api/instagram/disconnect:
 *   post:
 *     tags:
 *       - Instagram
 *     summary: Desconecta a conta do Instagram do usuário logado
 *     security:
 *       - bearerAuth: []
 */
instagramRouter.post("/disconnect", authMiddleware, async (req, res) => {
  await controller.disconnect(req, res);
  if (!res.headersSent) {
    return res.status(204).send();
  }
});

/**
 * =========================
 * DASHBOARD DATA
 * =========================
 */

/**
 * @openapi
 * /api/instagram/metrics:
 *   get:
 *     tags:
 *       - Instagram
 *     summary: Retorna métricas do Instagram para o dashboard (do usuário logado)
 *     security:
 *       - bearerAuth: []
 */
instagramRouter.get("/metrics", authMiddleware, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  await controller.metrics(req, res);
});

/**
 * @openapi
 * /api/instagram/posts:
 *   get:
 *     tags:
 *       - Instagram Posts
 *     summary: Listar posts importados do Instagram (DB-first)
 *     security:
 *       - bearerAuth: []
 */
instagramRouter.get("/posts", authMiddleware, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  const anyPrisma = prisma as any;
  if (!anyPrisma.instagramPost) {
    return res.status(501).json({
      ok: false,
      message:
        "Model InstagramPost ainda não existe no Prisma. Crie os models (InstagramPost/InstagramPostMetric) e rode a migration.",
    });
  }

  const userId = getUserIdFromReq(req);
  if (!userId) {
    return res.status(401).json({ ok: false, message: "Não autenticado" });
  }

  const user = await prisma.user.findUnique({
    where: { id: String(userId) },
    select: { activeInstagramAccountId: true },
  });

  const activeInstagramAccountId = user?.activeInstagramAccountId ?? null;

  const from = typeof req.query.from === "string" ? req.query.from.trim() : "";
  const to = typeof req.query.to === "string" ? req.query.to.trim() : "";
  const type = typeof req.query.type === "string" ? req.query.type.trim() : "";
  const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
  const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, limitRaw!)) : 50;

  const where: any = { userId: String(userId) };

  // ✅ multi-conta: filtra por conta ativa automaticamente
  if (activeInstagramAccountId) {
    where.instagramAccountId = activeInstagramAccountId;
  }

  if (type) where.mediaType = type;

  if (from || to) {
    where.publishedAt = {};
    if (from) where.publishedAt.gte = parseYmdToUtcStart(from);
    if (to) where.publishedAt.lte = parseYmdToUtcEnd(to);
  }

  const posts = await anyPrisma.instagramPost.findMany({
    where,
    orderBy: { publishedAt: "desc" },
    take: limit,
    include: {
      metrics: {
        orderBy: { pulledAt: "desc" },
        take: 1,
      },
    },
  });

  return res.json({
    ok: true,
    source: "database",
    activeInstagramAccountId,
    total: posts.length,
    posts,
  });
});

export default instagramRouter;
