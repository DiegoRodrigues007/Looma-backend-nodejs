import { Router } from "express";
import { makeInstagramAuthController } from "../../composition/instagramComposition";

export const instagramRouter = Router();
const controller = makeInstagramAuthController();

/**
 * @openapi
 * /api/instagram/start:
 *   get:
 *     tags:
 *       - Instagram
 *     summary: Inicia o login do Instagram
 *     parameters:
 *       - in: query
 *         name: redirect
 *         schema:
 *           type: boolean
 *         required: false
 *         description: Se true (default), redireciona direto para o Instagram.
 *       - in: query
 *         name: state
 *         schema:
 *           type: string
 *         required: false
 *         description: Opcional. Pode ser usado como "returnTo" (rota do front) ou state aleatório.
 *     responses:
 *       200:
 *         description: URL de login retornada (quando redirect=false)
 */
instagramRouter.get("/start", (req, res) => controller.start(req, res));

/**
 * @openapi
 * /api/instagram/callback:
 *   get:
 *     tags:
 *       - Instagram
 *     summary: Callback do login do Instagram
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
 */
instagramRouter.get("/callback", (req, res) => controller.callback(req, res));

/**
 * @openapi
 * /api/instagram/status:
 *   get:
 *     tags:
 *       - Instagram
 *     summary: Retorna se há conta do Instagram conectada
 */
instagramRouter.get("/status", (req, res) => controller.status(req, res));

/**
 * @openapi
 * /api/instagram/disconnect:
 *   post:
 *     tags:
 *       - Instagram
 *     summary: Desconecta a conta do Instagram
 */
instagramRouter.post("/disconnect", (req, res) => controller.disconnect(req, res));

/**
 * @openapi
 * /api/instagram/metrics:
 *   get:
 *     tags:
 *       - Instagram
 *     summary: Retorna métricas do Instagram para o dashboard
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
 *       409:
 *         description: Instagram não conectado
 */
instagramRouter.get("/metrics", (req, res) => controller.metrics(req, res));

export default instagramRouter;
