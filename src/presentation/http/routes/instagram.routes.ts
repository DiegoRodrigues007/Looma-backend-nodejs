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
 *     description: >
 *       Inicia o fluxo OAuth do Instagram.
 *       Se redirect=false, retorna um JSON com a URL de login. Caso contrário, redireciona (302).
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: redirect
 *         required: false
 *         schema:
 *           type: boolean
 *           default: true
 *         description: >
 *           Se false, retorna { url, state } em JSON ao invés de redirecionar.
 *       - in: query
 *         name: state
 *         required: false
 *         schema:
 *           type: string
 *           example: /settings
 *         description: >
 *           Caminho do frontend para retornar após o login (ex: /settings).
 *     responses:
 *       200:
 *         description: Retorna a URL de login em JSON (quando redirect=false)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 url:
 *                   type: string
 *                 state:
 *                   type: string
 *       302:
 *         description: Redireciona para a URL de login do Instagram
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
 *     description: >
 *       Endpoint chamado pelo Facebook/Instagram após autorização.
 *       Recebe code e state e finaliza o login.
 *     parameters:
 *       - in: query
 *         name: code
 *         required: true
 *         schema:
 *           type: string
 *         description: Código de autorização retornado pelo Instagram/Facebook.
 *       - in: query
 *         name: state
 *         required: false
 *         schema:
 *           type: string
 *         description: State assinado, usado para recuperar returnTo/userId.
 *       - in: query
 *         name: redirect
 *         required: false
 *         schema:
 *           type: boolean
 *           default: true
 *         description: Se false, retorna JSON em vez de redirecionar.
 *     responses:
 *       200:
 *         description: Resposta em JSON quando redirect=false (pode incluir choose_required, reauth_required)
 *       302:
 *         description: Redirecionamento para o frontend (fluxo padrão)
 *       400:
 *         description: Parâmetros inválidos (ex.: code ausente)
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
 *     summary: Status de conexão do Instagram (por conta ativa ou informada)
 *     description: >
 *       Retorna se há Instagram conectado para o usuário.
 *       Se instagramAccountId/accountId for enviado, avalia aquela conta.
 *       Caso contrário, usa conta ativa do usuário (fallback: última conectada).
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: instagramAccountId
 *         required: false
 *         schema:
 *           type: string
 *         description: ID da conta do Instagram no banco (multi-conta).
 *       - in: query
 *         name: accountId
 *         required: false
 *         schema:
 *           type: string
 *         description: Alias de instagramAccountId.
 *     responses:
 *       200:
 *         description: Status de conexão
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 connected:
 *                   type: boolean
 *                 instagramAccountId:
 *                   type: string
 *                   nullable: true
 *                 igUserId:
 *                   type: string
 *                   nullable: true
 *                 username:
 *                   type: string
 *                   nullable: true
 *                 accountType:
 *                   type: string
 *                   nullable: true
 *                 expiresAt:
 *                   type: string
 *                   nullable: true
 *       401:
 *         description: Não autenticado
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
 * @openapi
 * /api/instagram/active:
 *   get:
 *     tags:
 *       - Instagram
 *     summary: Retorna a conta Instagram ativa do usuário logado
 *     description: >
 *       Retorna activeInstagramAccountId do usuário e os dados da conta ativa (se conectada).
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Conta ativa
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 ok:
 *                   type: boolean
 *                 activeInstagramAccountId:
 *                   type: string
 *                   nullable: true
 *                 account:
 *                   type: object
 *                   nullable: true
 *       401:
 *         description: Não autenticado
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
 * @openapi
 * /api/instagram/active:
 *   post:
 *     tags:
 *       - Instagram
 *     summary: Define a conta Instagram ativa do usuário logado
 *     description: >
 *       Define activeInstagramAccountId do usuário.
 *       Body: { instagramAccountId }.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - instagramAccountId
 *             properties:
 *               instagramAccountId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Conta ativa definida
 *       400:
 *         description: Body inválido
 *       401:
 *         description: Não autenticado
 *       404:
 *         description: Conta não encontrada/não conectada
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
 * @openapi
 * /api/instagram/accounts:
 *   get:
 *     tags:
 *       - Instagram
 *     summary: Lista todas as contas do Instagram conectadas do usuário logado
 *     description: >
 *       Lista as contas conectadas e marca qual é a ativa (activeInstagramAccountId).
 *       Se não houver ativa e existir ao menos 1 conta conectada, define a primeira como ativa.
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
 * @openapi
 * /api/instagram/candidates:
 *   get:
 *     tags:
 *       - Instagram
 *     summary: Lista candidates (contas/páginas) para seleção após callback
 *     description: >
 *       Retorna candidates associados a um selectionId, para o usuário escolher qual conta/página conectar.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: selectionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Lista de candidates
 *       400:
 *         description: selectionId inválido/ausente
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
 *     summary: Confirma seleção e persiste conta/token necessários
 *     description: >
 *       Confirma selectionId e selections, persiste InstagramAccount(s) e enfileira backfill.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - selectionId
 *               - selections
 *             properties:
 *               selectionId:
 *                 type: string
 *               returnTo:
 *                 type: string
 *                 example: /settings
 *               redirect:
 *                 type: boolean
 *                 default: false
 *               selections:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - igUserId
 *                     - facebookPageId
 *                   properties:
 *                     igUserId:
 *                       type: string
 *                     facebookPageId:
 *                       type: string
 *     responses:
 *       200:
 *         description: Contas confirmadas e backfill enfileirado
 *       400:
 *         description: Payload inválido
 *       401:
 *         description: Não autenticado
 *       500:
 *         description: Erro interno ao confirmar
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
 *     summary: Desconecta Instagram do usuário
 *     description: >
 *       Marca contas como desconectadas e limpa tokens. Também limpa activeInstagramAccountId.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       204:
 *         description: Desconectado com sucesso
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
 *     summary: Retorna métricas do Instagram para o dashboard
 *     description: >
 *       Retorna KPIs, série temporal e topContent.
 *       Usa multi-conta: se instagramAccountId/accountId não for enviado, usa conta ativa do usuário.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         required: true
 *         schema:
 *           type: string
 *           example: "2026-01-10"
 *         description: Data inicial (YYYY-MM-DD)
 *       - in: query
 *         name: to
 *         required: true
 *         schema:
 *           type: string
 *           example: "2026-01-17"
 *         description: Data final (YYYY-MM-DD)
 *       - in: query
 *         name: instagramAccountId
 *         required: false
 *         schema:
 *           type: string
 *         description: ID da conta do Instagram (multi-conta). Se omitido, usa conta ativa.
 *       - in: query
 *         name: accountId
 *         required: false
 *         schema:
 *           type: string
 *         description: Alias de instagramAccountId.
 *     responses:
 *       200:
 *         description: Métricas e topContent
 *       400:
 *         description: Parâmetros inválidos
 *       401:
 *         description: Não autenticado
 *       409:
 *         description: Instagram não conectado / token inválido
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
 *     summary: Lista posts importados do Instagram (DB-first)
 *     description: >
 *       Retorna posts salvos no banco para a conta ativa do usuário (ou filtros de data/tipo).
 *       Ideal para histórico (backfill).
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         required: false
 *         schema:
 *           type: string
 *           example: "2026-01-01"
 *         description: Data inicial (YYYY-MM-DD)
 *       - in: query
 *         name: to
 *         required: false
 *         schema:
 *           type: string
 *           example: "2026-01-17"
 *         description: Data final (YYYY-MM-DD)
 *       - in: query
 *         name: type
 *         required: false
 *         schema:
 *           type: string
 *           example: "REELS"
 *         description: Tipo de mídia (REELS, IMAGE, VIDEO, CAROUSEL_ALBUM)
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           default: 50
 *           maximum: 200
 *         description: Máximo de posts retornados
 *     responses:
 *       200:
 *         description: Lista de posts do banco (filtrados pela conta ativa)
 *       401:
 *         description: Não autenticado
 *       501:
 *         description: Model InstagramPost não existe no Prisma
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
