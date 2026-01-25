// src/presentation/http/routes/instagramRouter.ts
import { Router } from "express";
import { makeInstagramAuthController } from "../../composition/instagramComposition";
import { authMiddleware } from "../middlewares/authMiddleware";
import { prisma } from "../../../infrastructure/db/prismaClient";

export const instagramRouter = Router();

// ✅ IMPORTANT: evita erro TS "Property X does not exist on type InstagramAuthController"
const controller: any = makeInstagramAuthController();

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
    req?.user?.userId || // ✅ primeiro
    req?.user?.id ||
    req?.user?.sub ||
    req?.userId ||
    null;

  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number") return String(v);
  return null;
}

/**
 * =========================
 * OPENAPI COMPONENTS
 * =========================
 *
 * @openapi
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *   schemas:
 *     InstagramAccount:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         igUserId:
 *           type: string
 *         username:
 *           type: string
 *           nullable: true
 *         accountType:
 *           type: string
 *           nullable: true
 *         facebookPageId:
 *           type: string
 *           nullable: true
 *         expiresAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         isConnected:
 *           type: boolean
 *         updatedAt:
 *           type: string
 *           format: date-time
 *       required:
 *         - id
 *         - igUserId
 *         - isConnected
 *         - updatedAt
 *
 *     InstagramActiveResponse:
 *       type: object
 *       properties:
 *         ok:
 *           type: boolean
 *         activeInstagramAccountId:
 *           type: string
 *           nullable: true
 *         account:
 *           $ref: '#/components/schemas/InstagramAccount'
 *           nullable: true
 *       required:
 *         - ok
 *         - activeInstagramAccountId
 *         - account
 *
 *     InstagramAccountsResponse:
 *       type: object
 *       properties:
 *         ok:
 *           type: boolean
 *         activeInstagramAccountId:
 *           type: string
 *           nullable: true
 *         total:
 *           type: integer
 *         accounts:
 *           type: array
 *           items:
 *             allOf:
 *               - $ref: '#/components/schemas/InstagramAccount'
 *               - type: object
 *                 properties:
 *                   isActive:
 *                     type: boolean
 *       required:
 *         - ok
 *         - activeInstagramAccountId
 *         - total
 *         - accounts
 *
 *     InstagramSetActiveRequest:
 *       type: object
 *       required:
 *         - instagramAccountId
 *       properties:
 *         instagramAccountId:
 *           type: string
 *
 *     ErrorResponse:
 *       type: object
 *       properties:
 *         ok:
 *           type: boolean
 *         message:
 *           type: string
 *       required:
 *         - ok
 *         - message
 *
 *     InstagramConfirmRequest:
 *       type: object
 *       description: >
 *         Payload flexível. O frontend pode mandar selections: [{ igUserId, facebookPageId }].
 *         O backend adapta para igUserIds[] quando necessário.
 *       properties:
 *         igUserIds:
 *           type: array
 *           items:
 *             type: string
 *         candidateIds:
 *           type: array
 *           items:
 *             type: string
 *         selections:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               igUserId:
 *                 type: string
 *               facebookPageId:
 *                 type: string
 *             required:
 *               - igUserId
 *
 *     InstagramPostsResponse:
 *       type: object
 *       properties:
 *         ok:
 *           type: boolean
 *         source:
 *           type: string
 *           example: database
 *         activeInstagramAccountId:
 *           type: string
 *           nullable: true
 *         total:
 *           type: integer
 *         posts:
 *           type: array
 *           items:
 *             type: object
 *       required:
 *         - ok
 *         - source
 *         - activeInstagramAccountId
 *         - total
 *         - posts
 */

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
 *     summary: Inicia o fluxo de autenticação do Instagram (OAuth).
 *     description: Gera a URL de login e (opcionalmente) redireciona para o provedor.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: redirect
 *         schema:
 *           type: boolean
 *         required: false
 *         description: Se true, o backend pode responder com redirect (depende do controller).
 *     responses:
 *       200:
 *         description: Fluxo iniciado.
 *       401:
 *         description: Não autenticado.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       501:
 *         description: Controller.start não implementado.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
instagramRouter.get("/start", authMiddleware, async (req, res) => {
  const redirect = parseBool(req.query.redirect);
  if (redirect !== undefined) {
    (req.query as any).redirect = redirect;
  }

  if (typeof controller.start !== "function") {
    return res
      .status(501)
      .json({ ok: false, message: "Controller.start não implementado" });
  }

  await controller.start(req, res);
});

/**
* =========================
* 🔁 TOKEN REFRESH (ADICIONADO)
* =========================
*/


/**
* @openapi
* /api/instagram/refresh:
* post:
* tags:
* - Instagram
* summary: Renova o token do Instagram quando expirado.
* description: >
* Tenta renovar o token de acesso. Caso falhe, sinaliza necessidade de reautenticação.
* security:
* - bearerAuth: []
* responses:
* 200:
* description: Token renovado com sucesso.
* 400:
* description: Erro controlado no refresh.
* 401:
* description: Não autenticado.
* 403:
* description: Reautenticação necessária.
* 501:
* description: Controller.refresh não implementado.
*/
instagramRouter.post("/refresh", authMiddleware, async (req, res) => {
res.setHeader("Cache-Control", "no-store");


if (typeof controller.refresh !== "function") {
return res
.status(501)
.json({ ok: false, message: "Controller.refresh não implementado" });
}


await controller.refresh(req, res);
});

/**
 * @openapi
 * /api/instagram/callback:
 *   get:
 *     tags:
 *       - Instagram
 *     summary: Callback do OAuth do Instagram.
 *     description: Endpoint chamado pelo provedor após o usuário autorizar.
 *     responses:
 *       200:
 *         description: Callback processado.
 *       400:
 *         description: Dados inválidos ou ausência de parâmetros necessários.
 *       501:
 *         description: Controller.callback não implementado.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
instagramRouter.get("/callback", async (req, res) => {
  if (typeof controller.callback !== "function") {
    return res
      .status(501)
      .json({ ok: false, message: "Controller.callback não implementado" });
  }

  await controller.callback(req, res);
});

/**
 * @openapi
 * /api/instagram/status:
 *   get:
 *     tags:
 *       - Instagram
 *     summary: Status da conexão do Instagram para o usuário autenticado.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Retorna status/estado atual do vínculo.
 *       401:
 *         description: Não autenticado.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       501:
 *         description: Controller.status não implementado.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
instagramRouter.get("/status", authMiddleware, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (typeof controller.status !== "function") {
    return res
      .status(501)
      .json({ ok: false, message: "Controller.status não implementado" });
  }

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
 *     summary: Obtém a conta Instagram ativa do usuário.
 *     description: >
 *       Se não houver conta ativa definida, tenta selecionar automaticamente a última atualizada
 *       (isConnected=true). **Não filtra por token** para evitar accountsLen=0 no Topbar.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Conta ativa (ou null se não houver).
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/InstagramActiveResponse'
 *       401:
 *         description: Não autenticado.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
instagramRouter.get("/active", authMiddleware, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  const userId = getUserIdFromReq(req);
  if (!userId)
    return res.status(401).json({ ok: false, message: "Não autenticado" });

  const user = await prisma.user.findUnique({
    where: { id: String(userId) },
    select: {
      id: true,
      activeInstagramAccountId: true,
    },
  });

  // ✅ AJUSTE CRÍTICO: removido filtro de token
  if (!user?.activeInstagramAccountId) {
    const first = await prisma.instagramAccount.findFirst({
      where: {
        userId: String(userId),
        isConnected: true,
      },
      orderBy: { updatedAt: "desc" },
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

    if (!first) {
      return res.json({
        ok: true,
        activeInstagramAccountId: null,
        account: null,
      });
    }

    try {
      await prisma.user.update({
        where: { id: String(userId) },
        data: { activeInstagramAccountId: first.id },
      });
    } catch {
      // silencioso
    }

    return res.json({
      ok: true,
      activeInstagramAccountId: first.id,
      account: {
        id: first.id,
        igUserId: first.igUserId,
        username: first.username ?? null,
        accountType: first.accountType ?? null,
        facebookPageId: first.facebookPageId ?? null,
        expiresAt: first.expiresAt ?? null,
        isConnected: first.isConnected,
        updatedAt: first.updatedAt,
      },
    });
  }

  const acc = await prisma.instagramAccount.findFirst({
    where: {
      id: user.activeInstagramAccountId,
      userId: String(userId),
      isConnected: true,
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

  if (!acc) {
    const fallback = await prisma.instagramAccount.findFirst({
      where: {
        userId: String(userId),
        isConnected: true,
      },
      orderBy: { updatedAt: "desc" },
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

    if (!fallback) {
      return res.json({
        ok: true,
        activeInstagramAccountId: null,
        account: null,
      });
    }

    try {
      await prisma.user.update({
        where: { id: String(userId) },
        data: { activeInstagramAccountId: fallback.id },
      });
    } catch {
      // silencioso
    }

    return res.json({
      ok: true,
      activeInstagramAccountId: fallback.id,
      account: {
        id: fallback.id,
        igUserId: fallback.igUserId,
        username: fallback.username ?? null,
        accountType: fallback.accountType ?? null,
        facebookPageId: fallback.facebookPageId ?? null,
        expiresAt: fallback.expiresAt ?? null,
        isConnected: fallback.isConnected,
        updatedAt: fallback.updatedAt,
      },
    });
  }

  return res.json({
    ok: true,
    activeInstagramAccountId: acc.id,
    account: {
      id: acc.id,
      igUserId: acc.igUserId,
      username: acc.username ?? null,
      accountType: acc.accountType ?? null,
      facebookPageId: acc.facebookPageId ?? null,
      expiresAt: acc.expiresAt ?? null,
      isConnected: acc.isConnected,
      updatedAt: acc.updatedAt,
    },
  });
});

/**
 * @openapi
 * /api/instagram/active:
 *   post:
 *     tags:
 *       - Instagram
 *     summary: Define a conta Instagram ativa do usuário.
 *     description: >
 *       Define a conta ativa a partir do instagramAccountId. Se existir controller.setActive, delega para ele.
 *       Caso contrário, usa fallback no prisma (isConnected=true).
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/InstagramSetActiveRequest'
 *     responses:
 *       200:
 *         description: Conta ativa definida com sucesso.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/InstagramActiveResponse'
 *       400:
 *         description: instagramAccountId ausente.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Não autenticado.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Conta não encontrada ou não conectada para este usuário.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
instagramRouter.post("/active", authMiddleware, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  const userId = getUserIdFromReq(req);
  if (!userId)
    return res.status(401).json({ ok: false, message: "Não autenticado" });

  const instagramAccountId = String(req.body?.instagramAccountId ?? "").trim();
  if (!instagramAccountId) {
    return res
      .status(400)
      .json({ ok: false, message: "instagramAccountId é obrigatório" });
  }

  if (typeof controller.setActive === "function") {
    return controller.setActive(req, res);
  }

  // ✅ AJUSTE CRÍTICO: removido filtro de token
  const exists = await prisma.instagramAccount.findFirst({
    where: {
      id: instagramAccountId,
      userId: String(userId),
      isConnected: true,
    },
    select: {
      id: true,
      igUserId: true,
      username: true,
      accountType: true,
      facebookPageId: true,
      updatedAt: true,
      expiresAt: true,
      isConnected: true,
    },
  });

  if (!exists) {
    return res.status(404).json({
      ok: false,
      message:
        "Conta Instagram não encontrada para este usuário (ou não está conectada).",
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
      expiresAt: exists.expiresAt ?? null,
      isConnected: exists.isConnected,
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
 *     summary: Lista contas Instagram conectadas do usuário (multi-conta).
 *     description: >
 *       Retorna accounts + activeInstagramAccountId. Se não houver conta ativa válida, define a primeira automaticamente.
 *       **Não filtra por token** para evitar retornar lista vazia no Topbar.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de contas conectadas e conta ativa.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/InstagramAccountsResponse'
 *       401:
 *         description: Não autenticado.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
instagramRouter.get("/accounts", authMiddleware, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (typeof controller.accounts === "function") {
    return controller.accounts(req, res);
  }

  const userId = getUserIdFromReq(req);
  if (!userId) {
    return res.status(401).json({ ok: false, message: "Não autenticado" });
  }

  const user = await prisma.user.findUnique({
    where: { id: String(userId) },
    select: { activeInstagramAccountId: true },
  });

  // ✅ AJUSTE CRÍTICO: removido filtro de token
  const rows = await prisma.instagramAccount.findMany({
    where: {
      userId: String(userId),
      isConnected: true,
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
 *     summary: Lista candidatos de contas Instagram para o usuário escolher.
 *     description: Pode incluir contas Business/Creator encontradas via Graph API.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de candidatos.
 *       401:
 *         description: Não autenticado.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       501:
 *         description: Controller.candidates não implementado.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
const candidatesHandler = async (req: any, res: any) => {
  res.setHeader("Cache-Control", "no-store");

  if (typeof controller.candidates !== "function") {
    return res
      .status(501)
      .json({ ok: false, message: "Controller.candidates não implementado" });
  }

  await controller.candidates(req, res);
};

instagramRouter.get("/candidates", authMiddleware, candidatesHandler);

/**
 * @openapi
 * /api/instagram/confirm:
 *   post:
 *     tags:
 *       - Instagram
 *     summary: Confirma o vínculo de uma conta/candidato e finaliza a conexão.
 *     description: >
 *       O frontend pode mandar { selections: [{ igUserId, facebookPageId }] }.
 *       O backend adapta para igUserIds[] quando necessário e delega para controller.confirm.
 *       Após confirmar, se não houver activeInstagramAccountId definido, seta a última conectada.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/InstagramConfirmRequest'
 *     responses:
 *       200:
 *         description: Conta confirmada/conectada.
 *       400:
 *         description: Payload inválido.
 *       401:
 *         description: Não autenticado.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       501:
 *         description: Controller.confirm não implementado.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
instagramRouter.post("/confirm", authMiddleware, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  try {
    const body: any = req.body ?? {};
    const hasIgUserIds =
      Array.isArray(body?.igUserIds) && body.igUserIds.length > 0;
    const hasCandidateIds =
      Array.isArray(body?.candidateIds) && body.candidateIds.length > 0;

    if (!hasIgUserIds && !hasCandidateIds && Array.isArray(body?.selections)) {
      const igUserIds = body.selections
        .map((x: any) => String(x?.igUserId ?? "").trim())
        .filter((x: string) => x.length > 0);

      if (igUserIds.length > 0) {
        body.igUserIds = igUserIds;
        req.body = body;
      }
    }
  } catch {
    // ignora
  }

  if (typeof controller.confirm !== "function") {
    return res
      .status(501)
      .json({ ok: false, message: "Controller.confirm não implementado" });
  }

  await controller.confirm(req, res);

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
 * =========================
 * DISCONNECT
 * =========================
 */

/**
 * @openapi
 * /api/instagram/disconnect:
 *   post:
 *     tags:
 *       - Instagram
 *     summary: Desconecta a conta Instagram (e/ou revoga tokens) do usuário.
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
 *                 description: Opcional. Se seu controller suportar, desconecta uma conta específica.
 *     responses:
 *       204:
 *         description: Desconectado com sucesso (sem conteúdo).
 *       401:
 *         description: Não autenticado.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       501:
 *         description: Controller.disconnect não implementado.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
instagramRouter.post("/disconnect", authMiddleware, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (typeof controller.disconnect !== "function") {
    return res
      .status(501)
      .json({ ok: false, message: "Controller.disconnect não implementado" });
  }

  await controller.disconnect(req, res);
  if (!res.headersSent) return res.status(204).send();
});

/**
 * =========================
 * DASHBOARD METRICS
 * =========================
 */

/**
 * @openapi
 * /api/instagram/metrics:
 *   get:
 *     tags:
 *       - Instagram
 *     summary: Retorna métricas do dashboard do Instagram.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           example: "2026-01-01"
 *         required: false
 *         description: Data inicial (YYYY-MM-DD).
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           example: "2026-01-19"
 *         required: false
 *         description: Data final (YYYY-MM-DD).
 *     responses:
 *       200:
 *         description: Métricas retornadas com sucesso.
 *       401:
 *         description: Não autenticado.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       501:
 *         description: Controller.metrics não implementado.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
instagramRouter.get("/metrics", authMiddleware, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (typeof controller.metrics !== "function") {
    return res
      .status(501)
      .json({ ok: false, message: "Controller.metrics não implementado" });
  }

  await controller.metrics(req, res);
});

export default instagramRouter;
