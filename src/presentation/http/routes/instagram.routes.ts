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
 *         required: true
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

export default instagramRouter;
