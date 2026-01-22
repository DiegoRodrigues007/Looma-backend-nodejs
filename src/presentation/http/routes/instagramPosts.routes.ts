import { Router, type Request, type Response } from "express";
import { authMiddleware } from "../middlewares/authMiddleware";
import { listInstagramPosts } from "../controllers/InstagramPostsController";
import { SyncInstagramRecentPostsUseCase } from "../../../application/use-cases/instagram/SyncInstagramRecentPostsUseCase";

const router = Router();

function getAuthenticatedUserId(req: Request): string | null {
  const anyReq = req as any;
  const v =
    anyReq?.user?.sub ||
    anyReq?.user?.id ||
    anyReq?.user?.userId ||
    anyReq?.userId ||
    req.header("x-user-id") ||
    null;

  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number") return String(v);
  return null;
}

function parseLimit(req: Request, fallback = 20, max = 50) {
  const raw = typeof req.query.limit === "string" ? Number(req.query.limit) : NaN;
  if (Number.isFinite(raw)) return Math.min(max, Math.max(1, Math.floor(raw)));
  return fallback;
}

/**
 * @openapi
 * /api/instagram/posts:
 *   get:
 *     tags:
 *       - Instagram Posts
 *     summary: Listar posts importados do Instagram (DB-first)
 *     description: Retorna posts já salvos no banco, com a última métrica coletada por post.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: instagramAccountId
 *         required: false
 *         schema:
 *           type: string
 *         description: Filtra posts por uma conta específica do Instagram (multi-conta)
 *       - in: query
 *         name: from
 *         required: false
 *         schema:
 *           type: string
 *           example: "2025-12-01"
 *         description: Data inicial (YYYY-MM-DD)
 *       - in: query
 *         name: to
 *         required: false
 *         schema:
 *           type: string
 *           example: "2026-01-14"
 *         description: Data final (YYYY-MM-DD)
 *       - in: query
 *         name: type
 *         required: false
 *         schema:
 *           type: string
 *           example: "REELS"
 *         description: Tipo de mídia (REELS, IMAGE, CAROUSEL_ALBUM, VIDEO)
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           example: 20
 *         description: Quantidade máxima de itens (máx 200)
 *     responses:
 *       200:
 *         description: Lista de posts do banco
 *       401:
 *         description: Não autorizado
 *       400:
 *         description: Query inválida
 */
router.get("/posts", authMiddleware, listInstagramPosts);

/**
 * @openapi
 * /api/instagram/posts/sync:
 *   post:
 *     tags:
 *       - Instagram Posts
 *     summary: Sincronizar últimos posts do Instagram
 *     description: Importa apenas os posts mais recentes (default 20) e remove os antigos para evitar crescimento do banco.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           example: 20
 *         description: Quantidade de posts a sincronizar (máx 50)
 *     responses:
 *       200:
 *         description: Sincronização concluída
 *       401:
 *         description: Não autorizado
 *       500:
 *         description: Erro interno
 */
router.post("/posts/sync", authMiddleware, async (req: Request, res: Response) => {
  try {
    res.setHeader("Cache-Control", "no-store");

    const userId = getAuthenticatedUserId(req);
    if (!userId) {
      return res.status(401).json({ ok: false, message: "Não autenticado" });
    }

    const limit = parseLimit(req, 20, 50);

    const useCase = new SyncInstagramRecentPostsUseCase();

    const result = await useCase.execute({
      userId,
      limit,
      deleteOldBeyondLimit: true,
    });

    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      message: "Falha ao sincronizar posts",
      detail: String(error?.message ?? error),
    });
  }
});

export default router;
