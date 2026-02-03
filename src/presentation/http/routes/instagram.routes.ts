// src/presentation/http/routes/instagramRouter.ts
import { Router } from "express";
import { authMiddleware } from "../middlewares/authMiddleware";

import {
  makeInstagramOAuthController,
  makeInstagramAccountsController,
  makeInstagramCandidatesController,
  makeInstagramMetricsController,
} from "../../composition/instagramComposition";

export const instagramRouter = Router();

/**
 * =========================
 * CONTROLLERS
 * =========================
 */
const oauthController = makeInstagramOAuthController();
const accountsController = makeInstagramAccountsController();
const candidatesController = makeInstagramCandidatesController();
const metricsController = makeInstagramMetricsController();

/**
 * =========================
 * OPENAPI (GLOBAL COMPONENTS)
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
 *     ErrorResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: false
 *         error:
 *           type: string
 *           example: "Mensagem de erro"
 *
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
 *       required: [id, igUserId, isConnected, updatedAt]
 *
 *     InstagramStatusResponse:
 *       type: object
 *       properties:
 *         connected:
 *           type: boolean
 *           example: true
 *         activeInstagramAccountId:
 *           type: string
 *           nullable: true
 *           example: "acc_123"
 *         accountsCount:
 *           type: integer
 *           example: 1
 *
 *     InstagramAccountsResponse:
 *       type: object
 *       properties:
 *         accounts:
 *           type: array
 *           items:
 *             $ref: "#/components/schemas/InstagramAccount"
 *
 *     SetActiveAccountRequest:
 *       type: object
 *       required: [instagramAccountId]
 *       properties:
 *         instagramAccountId:
 *           type: string
 *           example: "acc_123"
 *
 *     DisconnectRequest:
 *       type: object
 *       properties:
 *         instagramAccountId:
 *           type: string
 *           nullable: true
 *           description: "Se enviado, desconecta apenas essa conta. Se omitido, desconecta a conta ativa (dependendo da regra do backend)."
 *           example: "acc_123"
 *
 *     CandidateAccount:
 *       type: object
 *       properties:
 *         igUserId:
 *           type: string
 *           example: "17841400000000000"
 *         username:
 *           type: string
 *           nullable: true
 *           example: "minha_conta"
 *         accountType:
 *           type: string
 *           nullable: true
 *           example: "BUSINESS"
 *         facebookPageId:
 *           type: string
 *           nullable: true
 *           example: "1234567890"
 *
 *     InstagramCandidatesResponse:
 *       type: object
 *       properties:
 *         candidates:
 *           type: array
 *           items:
 *             $ref: "#/components/schemas/CandidateAccount"
 *
 *     ConfirmCandidatesRequest:
 *       oneOf:
 *         - type: object
 *           properties:
 *             igUserIds:
 *               type: array
 *               items:
 *                 type: string
 *               example: ["17841400000000000"]
 *         - type: object
 *           properties:
 *             selections:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   igUserId:
 *                     type: string
 *                   username:
 *                     type: string
 *                     nullable: true
 *               example:
 *                 - igUserId: "17841400000000000"
 *                   username: "minha_conta"
 *
 *     ConfirmCandidatesResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         connectedAccounts:
 *           type: integer
 *           example: 1
 *
 *     InstagramMetricsQuery:
 *       type: object
 *       properties:
 *         from:
 *           type: string
 *           format: date
 *           example: "2026-01-01"
 *         to:
 *           type: string
 *           format: date
 *           example: "2026-01-31"
 *
 *     InstagramMetricsResponse:
 *       type: object
 *       properties:
 *         platform:
 *           type: string
 *           example: "instagram"
 *         from:
 *           type: string
 *           format: date
 *         to:
 *           type: string
 *           format: date
 *         kpis:
 *           type: object
 *           additionalProperties: true
 *           description: "KPIs agregados do período (depende do seu backend)."
 *         series:
 *           type: array
 *           items:
 *             type: object
 *             additionalProperties: true
 *           description: "Séries diárias/por data (depende do seu backend)."
 */

/**
 * =========================
 * AUTH FLOW
 * =========================
 */

/**
 * @openapi
 * /instagram/start:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags: [Instagram]
 *     summary: Inicia o fluxo OAuth do Instagram
 *     description: >
 *       Retorna uma URL para o usuário iniciar o OAuth do Instagram e, opcionalmente,
 *       redireciona automaticamente para a URL de autorização (dependendo do controller).
 *     parameters:
 *       - in: query
 *         name: redirect
 *         schema:
 *           type: boolean
 *           default: false
 *         required: false
 *         description: "Se true, redireciona automaticamente para o OAuth."
 *       - in: query
 *         name: returnTo
 *         schema:
 *           type: string
 *         required: false
 *         description: "URL/rota do frontend para retornar após concluir o fluxo."
 *     responses:
 *       200:
 *         description: "URL do OAuth gerada."
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 authorizationUrl:
 *                   type: string
 *                   example: "https://www.facebook.com/v19.0/dialog/oauth?client_id=..."
 *       302:
 *         description: "Redireciona para o OAuth (quando redirect=true)."
 *       401:
 *         description: "Não autenticado."
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ErrorResponse"
 *       500:
 *         description: "Erro interno."
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ErrorResponse"
 */
instagramRouter.get("/start", authMiddleware, (req, res) =>
  oauthController.start(req, res)
);

/**
 * @openapi
 * /instagram/callback:
 *   get:
 *     tags: [Instagram]
 *     summary: Callback OAuth do Instagram
 *     description: >
 *       Endpoint chamado pelo provedor OAuth após o usuário autorizar.
 *       Normalmente recebe o `code` e opcionalmente `state`.
 *     parameters:
 *       - in: query
 *         name: code
 *         schema:
 *           type: string
 *         required: true
 *         description: "Authorization code retornado pelo OAuth."
 *       - in: query
 *         name: state
 *         schema:
 *           type: string
 *         required: false
 *         description: "State opcional (anti-CSRF / contexto)."
 *       - in: query
 *         name: error
 *         schema:
 *           type: string
 *         required: false
 *         description: "Se o usuário cancelar/der erro no provedor, pode vir um error."
 *       - in: query
 *         name: error_description
 *         schema:
 *           type: string
 *         required: false
 *         description: "Descrição do erro retornado pelo provedor."
 *     responses:
 *       200:
 *         description: "Callback processado com sucesso."
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 *       302:
 *         description: "Pode redirecionar para o frontend após concluir."
 *       400:
 *         description: "Requisição inválida (ex: sem code)."
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ErrorResponse"
 *       500:
 *         description: "Erro interno."
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ErrorResponse"
 */
instagramRouter.get("/callback", (req, res) => oauthController.callback(req, res));

/**
 * =========================
 * STATUS / ACCOUNTS
 * =========================
 */

/**
 * @openapi
 * /instagram/status:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags: [Instagram]
 *     summary: Retorna status da conexão com Instagram
 *     description: "Informa se existe conta conectada e qual conta está ativa."
 *     responses:
 *       200:
 *         description: "Status retornado."
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/InstagramStatusResponse"
 *       401:
 *         description: "Não autenticado."
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ErrorResponse"
 *       500:
 *         description: "Erro interno."
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ErrorResponse"
 */
instagramRouter.get("/status", authMiddleware, (req, res) =>
  accountsController.status(req, res)
);

/**
 * @openapi
 * /instagram/accounts:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags: [Instagram]
 *     summary: Lista contas Instagram conectadas
 *     responses:
 *       200:
 *         description: "Lista de contas conectadas."
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/InstagramAccountsResponse"
 *       401:
 *         description: "Não autenticado."
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ErrorResponse"
 *       500:
 *         description: "Erro interno."
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ErrorResponse"
 */
instagramRouter.get("/accounts", authMiddleware, (req, res) =>
  accountsController.accounts(req, res)
);

/**
 * =========================
 * ACTIVE ACCOUNT
 * =========================
 */

/**
 * @openapi
 * /instagram/active:
 *   post:
 *     security:
 *       - bearerAuth: []
 *     tags: [Instagram]
 *     summary: Define conta Instagram ativa
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/SetActiveAccountRequest"
 *     responses:
 *       200:
 *         description: "Conta ativa definida com sucesso."
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 activeInstagramAccountId:
 *                   type: string
 *                   example: "acc_123"
 *       400:
 *         description: "Payload inválido (ex: faltou instagramAccountId)."
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ErrorResponse"
 *       401:
 *         description: "Não autenticado."
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ErrorResponse"
 *       500:
 *         description: "Erro interno."
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ErrorResponse"
 */
instagramRouter.post("/active", authMiddleware, (req, res) =>
  accountsController.setActive(req, res)
);

/**
 * =========================
 * CANDIDATES + CONFIRM
 * =========================
 */

/**
 * @openapi
 * /instagram/candidates:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags: [Instagram]
 *     summary: Lista candidatos de contas Instagram
 *     description: >
 *       Retorna possíveis contas/usuários IG (candidates) disponíveis para seleção,
 *       quando o fluxo OAuth retorna mais de uma opção.
 *     responses:
 *       200:
 *         description: "Lista de candidates."
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/InstagramCandidatesResponse"
 *       401:
 *         description: "Não autenticado."
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ErrorResponse"
 *       500:
 *         description: "Erro interno."
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ErrorResponse"
 */
instagramRouter.get("/candidates", authMiddleware, (req, res) =>
  candidatesController.candidates(req, res)
);

/**
 * @openapi
 * /instagram/confirm:
 *   post:
 *     security:
 *       - bearerAuth: []
 *     tags: [Instagram]
 *     summary: Confirma seleção de conta Instagram
 *     description: >
 *       Confirma uma (ou mais) contas IG escolhidas dentre os candidates.
 *       Aceita dois formatos: `igUserIds` (simples) ou `selections` (estruturado).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/ConfirmCandidatesRequest"
 *     responses:
 *       200:
 *         description: "Confirmação processada."
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ConfirmCandidatesResponse"
 *       400:
 *         description: "Payload inválido (ex: lista vazia)."
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ErrorResponse"
 *       401:
 *         description: "Não autenticado."
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ErrorResponse"
 *       500:
 *         description: "Erro interno."
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ErrorResponse"
 */
instagramRouter.post("/confirm", authMiddleware, (req, res) =>
  candidatesController.confirm(req, res)
);

/**
 * =========================
 * DISCONNECT
 * =========================
 */

/**
 * @openapi
 * /instagram/disconnect:
 *   post:
 *     security:
 *       - bearerAuth: []
 *     tags: [Instagram]
 *     summary: Desconecta conta Instagram
 *     description: >
 *       Desconecta a conta ativa (por padrão) ou uma conta específica quando `instagramAccountId` é informado.
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/DisconnectRequest"
 *     responses:
 *       200:
 *         description: "Conta desconectada."
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *       401:
 *         description: "Não autenticado."
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ErrorResponse"
 *       500:
 *         description: "Erro interno."
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ErrorResponse"
 */
instagramRouter.post("/disconnect", authMiddleware, (req, res) =>
  accountsController.disconnect(req, res)
);

/**
 * =========================
 * METRICS
 * =========================
 */

/**
 * @openapi
 * /instagram/metrics:
 *   get:
 *     security:
 *       - bearerAuth: []
 *     tags: [Instagram]
 *     summary: Retorna métricas do dashboard Instagram
 *     description: "Retorna KPIs e séries temporais para o período `from`..`to` (datas no formato YYYY-MM-DD)."
 *     parameters:
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *         required: false
 *         description: "Data inicial (YYYY-MM-DD). Se omitida, o backend define um padrão."
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *         required: false
 *         description: "Data final (YYYY-MM-DD). Se omitida, o backend define um padrão."
 *       - in: query
 *         name: timezone
 *         schema:
 *           type: string
 *         required: false
 *         description: "Timezone opcional para agregação (ex: America/Sao_Paulo), se seu backend suportar."
 *     responses:
 *       200:
 *         description: "Métricas do dashboard."
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/InstagramMetricsResponse"
 *       400:
 *         description: "Parâmetros inválidos (ex: from > to)."
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ErrorResponse"
 *       401:
 *         description: "Não autenticado."
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ErrorResponse"
 *       500:
 *         description: "Erro interno."
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/ErrorResponse"
 */
instagramRouter.get("/metrics", authMiddleware, (req, res) =>
  metricsController.metrics(req, res)
);

export default instagramRouter;
