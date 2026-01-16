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

/**
 * @openapi
 * /api/instagram/start:
 *   get:
 *     tags:
 *       - Instagram
 *     summary: Inicia o login do Instagram
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: redirect
 *         schema:
 *           type: boolean
 *         required: false
 *         description: Se true, o backend responde com a URL de autorização (JSON). Se false, pode redirecionar.
 *       - in: query
 *         name: state
 *         schema:
 *           type: string
 *         required: false
 *         description: Pode ser usado como "returnTo" (rota do front) ou state aleatório.
 *     responses:
 *       200:
 *         description: URL de login retornada em JSON (quando redirect=true) ou redirecionamento (quando redirect=false)
 *       401:
 *         description: Não autenticado
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
 *     parameters:
 *       - in: query
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: state
 *         required: false
 *         schema:
 *           type: string
 *     responses:
 *       302:
 *         description: Redireciona de volta para o front (ex: /settings?instagram=connected)
 *       400:
 *         description: Parâmetro code inválido
 *       401:
 *         description: Cookie de sessão do login expirou
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
 *     responses:
 *       200:
 *         description: Status retornado com sucesso
 *       401:
 *         description: Não autenticado
 */
instagramRouter.get("/status", authMiddleware, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  await controller.status(req, res);
});

/**
 * ✅ NOVO: listar TODAS as contas Instagram conectadas do usuário
 *
 * @openapi
 * /api/instagram/accounts:
 *   get:
 *     tags:
 *       - Instagram
 *     summary: Lista todas as contas do Instagram conectadas do usuário logado
 *     description: Retorna todas as contas IG conectadas (multi-conta) para o usuário logado.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de contas conectadas
 *       401:
 *         description: Não autenticado
 */
instagramRouter.get("/accounts", authMiddleware, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  // ✅ se você ainda não implementou controller.accounts, já deixo fallback aqui
  if (typeof (controller as any).accounts === "function") {
    return (controller as any).accounts(req, res);
  }

  // Fallback: lista direto do Prisma (não quebra seu build)
  const userId =
    (req as any)?.user?.sub ||
    (req as any)?.user?.id ||
    (req as any)?.user?.userId ||
    (req as any)?.userId ||
    null;

  if (!userId) {
    return res.status(401).json({ ok: false, message: "Não autenticado" });
  }

  const rows = await prisma.instagramAccount.findMany({
    where: {
      userId: String(userId),
      isConnected: true,
      OR: [{ pageAccessToken: { not: null } }, { accessToken: { not: null } }],
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      instagramId: true,
      instagramUserName: true,
      accountType: true,
      facebookPageId: true,
      accessTokenExpiresAt: true,
      isConnected: true,
      updatedAt: true,
    },
    take: 20,
  });

  return res.json({
    ok: true,
    total: rows.length,
    accounts: rows.map((r) => ({
      id: r.id,
      igUserId: r.instagramId,
      username: r.instagramUserName,
      accountType: r.accountType,
      facebookPageId: r.facebookPageId,
      expiresAt: r.accessTokenExpiresAt,
      isConnected: r.isConnected,
      updatedAt: r.updatedAt,
    })),
  });
});

/**
 * ✅ NOVO: Candidates para o usuário escolher a página/conta IG
 *
 * O frontend pode chamar em rotas diferentes (variações/legado).
 * Todas apontam pro mesmo handler pra evitar 404.
 *
 * @openapi
 * /api/instagram/candidates:
 *   get:
 *     tags:
 *       - Instagram
 *     summary: Lista candidates (páginas/contas) para o usuário escolher após o callback
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: selectionId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID temporário criado no callback (usado para listar candidatos)
 *     responses:
 *       200:
 *         description: Lista de candidates retornada
 *       400:
 *         description: selectionId ausente/inválido
 *       401:
 *         description: Não autenticado
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               selectionId:
 *                 type: string
 *               selections:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     igUserId:
 *                       type: string
 *                     facebookPageId:
 *                       type: string
 *     responses:
 *       200:
 *         description: Seleção confirmada
 *       400:
 *         description: Payload inválido
 *       401:
 *         description: Não autenticado
 */
instagramRouter.post("/confirm", authMiddleware, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  await controller.confirm(req, res);
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
 *     responses:
 *       204:
 *         description: Conta desconectada com sucesso
 *       401:
 *         description: Não autenticado
 */
instagramRouter.post("/disconnect", authMiddleware, async (req, res) => {
  await controller.disconnect(req, res);
  if (!res.headersSent) {
    return res.status(204).send();
  }
});

/**
 * @openapi
 * /api/instagram/metrics:
 *   get:
 *     tags:
 *       - Instagram
 *     summary: Retorna métricas do Instagram para o dashboard (do usuário logado)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         required: true
 *         schema:
 *           type: string
 *         description: Data inicial (YYYY-MM-DD)
 *       - in: query
 *         name: to
 *         required: true
 *         schema:
 *           type: string
 *         description: Data final (YYYY-MM-DD)
 *     responses:
 *       200:
 *         description: Métricas retornadas com sucesso
 *       400:
 *         description: Datas inválidas/ausentes
 *       401:
 *         description: Não autenticado
 *       409:
 *         description: Instagram não conectado
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
 *     description: Retorna posts salvos no banco (backfill), com a última métrica coletada por post.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         required: false
 *         schema:
 *           type: string
 *           example: "2025-12-01"
 *       - in: query
 *         name: to
 *         required: false
 *         schema:
 *           type: string
 *           example: "2026-01-14"
 *       - in: query
 *         name: type
 *         required: false
 *         schema:
 *           type: string
 *           example: "REELS"
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           example: 50
 *     responses:
 *       200:
 *         description: Lista de posts importados
 *       401:
 *         description: Não autenticado
 *       501:
 *         description: Model Prisma ainda não criado para posts
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

  const userId =
    (req as any)?.user?.sub ||
    (req as any)?.user?.id ||
    (req as any)?.user?.userId ||
    (req as any)?.userId ||
    null;

  if (!userId) {
    return res.status(401).json({ ok: false, message: "Não autenticado" });
  }

  const from = typeof req.query.from === "string" ? req.query.from.trim() : "";
  const to = typeof req.query.to === "string" ? req.query.to.trim() : "";
  const type = typeof req.query.type === "string" ? req.query.type.trim() : "";
  const limitRaw =
    typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
  const limit = Number.isFinite(limitRaw)
    ? Math.min(200, Math.max(1, limitRaw!))
    : 50;

  const where: any = { userId };
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
    total: posts.length,
    posts,
  });
});

export default instagramRouter;
