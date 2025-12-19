import { Router } from "express";
import { makeInstagramAuthController } from "../../composition/instagramComposition";
import { authMiddleware } from "../middlewares/authMiddleware";

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
  // Normaliza redirect para evitar bug de "redirect" vir como string
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
  // Evita cache de navegador/proxy SEM criar CORS preflight (isso é header de resposta, não de request)
  res.setHeader("Cache-Control", "no-store");

  await controller.status(req, res);
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

  // Se o controller já respondeu, não faz nada.
  // Se ele não respondeu, garante o contrato do OpenAPI (204).
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
  // Também não cacheia métricas (bom pra dashboard)
  res.setHeader("Cache-Control", "no-store");

  await controller.metrics(req, res);
});

export default instagramRouter;
