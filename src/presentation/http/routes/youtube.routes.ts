import { Router } from "express";
import { makeYouTubeAuthController } from "../../composition/youtubeComposition";
import { authMiddleware } from "../middlewares/authMiddleware";

export const youtubeRouter = Router();
const controller = makeYouTubeAuthController();

function parseBool(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim().toLowerCase();
  if (s === "true" || s === "1") return true;
  if (s === "false" || s === "0") return false;
  return undefined;
}

/**
 * @openapi
 * /api/youtube/start:
 *   get:
 *     tags:
 *       - YouTube
 *     summary: Inicia o login do YouTube
 *     description: Gera a URL de autorização do Google para conectar a conta do YouTube.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: redirect
 *         required: false
 *         schema:
 *           type: boolean
 *           default: true
 *       - in: query
 *         name: state
 *         required: false
 *         schema:
 *           type: string
 *           default: /settings
 *     responses:
 *       200:
 *         description: Retorna a URL de autorização
 *       401:
 *         description: Não autenticado
 */
youtubeRouter.get("/start", authMiddleware, async (req, res) => {
  const redirect = parseBool(req.query.redirect);
  if (redirect !== undefined) {
    (req.query as any).redirect = redirect;
  }
  await controller.start(req, res);
});

/**
 * @openapi
 * /api/youtube/callback:
 *   get:
 *     tags:
 *       - YouTube
 *     summary: Callback do OAuth do YouTube
 *     description: Endpoint chamado pelo Google após autorização. Troca o code por tokens e salva no banco.
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
 *         description: Redireciona para o frontend após conectar
 *       400:
 *         description: Parâmetros inválidos
 */
youtubeRouter.get("/callback", async (req, res) => {
  await controller.callback(req, res);
});

/**
 * @openapi
 * /api/youtube/status:
 *   get:
 *     tags:
 *       - YouTube
 *     summary: Retorna se o usuário logado tem conta do YouTube conectada
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Status de conexão
 *       401:
 *         description: Não autenticado
 */
youtubeRouter.get("/status", authMiddleware, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  await controller.status(req, res);
});

/**
 * @openapi
 * /api/youtube/disconnect:
 *   post:
 *     tags:
 *       - YouTube
 *     summary: Desconecta a conta do YouTube do usuário logado
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       204:
 *         description: Desconectado com sucesso
 *       401:
 *         description: Não autenticado
 */
youtubeRouter.post("/disconnect", authMiddleware, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  await controller.disconnect(req, res);
  if (!res.headersSent) return res.status(204).send();
});

/**
 * @openapi
 * /api/youtube/metrics:
 *   get:
 *     tags:
 *       - YouTube
 *     summary: Retorna métricas do YouTube para o dashboard (usuário logado)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         required: true
 *         schema:
 *           type: string
 *           example: "2025-12-01"
 *       - in: query
 *         name: to
 *         required: true
 *         schema:
 *           type: string
 *           example: "2025-12-31"
 *     responses:
 *       200:
 *         description: Métricas do YouTube
 *       400:
 *         description: Parâmetros inválidos
 *       401:
 *         description: Não autenticado
 *       409:
 *         description: YouTube não conectado
 */
youtubeRouter.get("/metrics", authMiddleware, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  await controller.metrics(req, res);
});

/**
 * @openapi
 * /api/youtube/top-content:
 *   get:
 *     tags:
 *       - YouTube
 *     summary: Retorna os Top Conteúdos (vídeos) do canal no período
 *     description: Usa YouTube Analytics API para rankear vídeos no período e YouTube Data API para retornar título/thumbnail.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         required: true
 *         schema:
 *           type: string
 *           example: "2025-12-01"
 *       - in: query
 *         name: to
 *         required: true
 *         schema:
 *           type: string
 *           example: "2025-12-31"
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           default: 10
 *           minimum: 1
 *           maximum: 25
 *     responses:
 *       200:
 *         description: Lista de vídeos mais performáticos no período
 *       400:
 *         description: Parâmetros inválidos
 *       401:
 *         description: Não autenticado
 *       409:
 *         description: YouTube não conectado ou token inválido/expirado (reconectar)
 *       502:
 *         description: Falha ao consultar APIs do Google/YouTube
 */
youtubeRouter.get("/top-content", authMiddleware, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  await controller.topContent(req, res);
});

export default youtubeRouter;
