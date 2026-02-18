import { Router } from "express";
import { authMiddleware } from "../middlewares/authMiddleware";

import {
  getInstagramGrowthAnalytics,
  getInstagramEngagementAnalytics,
  getInstagramCorrelationAnalytics,
  getInstagramContentAnalytics,
} from "../controllers/instagram/InstagramAnalyticsController";

import { getInstagramInsightsAnalytics } from "../controllers/instagram/InstagramInsightsController";

// ✅ NOVO CONTROLLER (queda e saturação) — não altera o cálculo antigo
import { getInstagramDropSaturationAnalytics } from "../controllers/instagram/InstagramDropSaturationController";

const router = Router();

/**
 * ============================================
 * @openapi
 * tags:
 *   - name: Instagram Analytics
 *     description: |
 *       Endpoints de analytics do Instagram filtrados por período.
 *       Usados pela tela de Analytics (calendário).
 * ============================================
 */

router.use(authMiddleware);

/**
 * @openapi
 * /api/instagram/analytics/growth:
 *   get:
 *     tags:
 *       - Instagram Analytics
 *     summary: Análise de Crescimento (profile views, interações, novos seguidores)
 *     description: |
 *       Retorna as métricas de crescimento da conta no período selecionado no calendário:
 *       - Visualizações no perfil (profile views)
 *       - Interações (total interactions)
 *       - Novos seguidores (delta no período)
 *
 *       Além dos totais do período, retorna a série diária para alimentar o gráfico.
 *
 *       - Range máximo: 30 dias
 *       - Datas em formato YYYY-MM-DD
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         required: true
 *         schema:
 *           type: string
 *           example: "2026-01-01"
 *       - in: query
 *         name: to
 *         required: true
 *         schema:
 *           type: string
 *           example: "2026-01-30"
 *       - in: query
 *         name: instagramAccountId
 *         required: false
 *         schema:
 *           type: string
 *           example: "963930d3-3ab5-45c7-ab74-93071128769f"
 *     responses:
 *       200:
 *         description: Métricas de crescimento do período
 *       400:
 *         description: Parâmetros inválidos
 *       401:
 *         description: Não autenticado
 */
router.get("/analytics/growth", getInstagramGrowthAnalytics);

/**
 * @openapi
 * /api/instagram/analytics/engagement:
 *   get:
 *     tags:
 *       - Instagram Analytics
 *     summary: Diagnóstico de engajamento por período
 *     description: |
 *       Retorna o total diário de likes, comentários, saves e shares
 *       para o período selecionado no calendário.
 *
 *       - Range máximo: 30 dias
 *       - Datas em formato YYYY-MM-DD
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         required: true
 *         schema:
 *           type: string
 *           example: "2026-01-01"
 *       - in: query
 *         name: to
 *         required: true
 *         schema:
 *           type: string
 *           example: "2026-01-30"
 *       - in: query
 *         name: instagramAccountId
 *         required: false
 *         schema:
 *           type: string
 *           example: "963930d3-3ab5-45c7-ab74-93071128769f"
 *     responses:
 *       200:
 *         description: Engajamento diário do período
 *       400:
 *         description: Parâmetros inválidos
 *       401:
 *         description: Não autenticado
 */
router.get("/analytics/engagement", getInstagramEngagementAnalytics);

/**
 * @openapi
 * /api/instagram/analytics/correlation:
 *   get:
 *     tags:
 *       - Instagram Analytics
 *     summary: Correlação entre horário/dia e performance
 *     description: |
 *       Retorna uma matriz (dia da semana × hora)
 *       com a taxa média de engajamento (%),
 *       usada no heatmap de correlação.
 *
 *       - Range máximo: 30 dias
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         required: true
 *         schema:
 *           type: string
 *           example: "2026-01-01"
 *       - in: query
 *         name: to
 *         required: true
 *         schema:
 *           type: string
 *           example: "2026-01-30"
 *       - in: query
 *         name: instagramAccountId
 *         required: false
 *         schema:
 *           type: string
 *           example: "963930d3-3ab5-45c7-ab74-93071128769f"
 *     responses:
 *       200:
 *         description: Heatmap de correlação
 *       400:
 *         description: Parâmetros inválidos
 *       401:
 *         description: Não autenticado
 */
router.get("/analytics/correlation", getInstagramCorrelationAnalytics);

/**
 * @openapi
 * /api/instagram/analytics/content:
 *   get:
 *     tags:
 *       - Instagram Analytics
 *     summary: Análise de performance de posts
 *     description: |
 *       Retorna a lista de posts do período com:
 *       - views
 *       - likes
 *       - comentários
 *       - comparação com a média do período
 *       - classificação (acima / abaixo / outlier)
 *
 *       Usado nos cards de Análise de Conteúdo.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         required: true
 *         schema:
 *           type: string
 *           example: "2026-01-01"
 *       - in: query
 *         name: to
 *         required: true
 *         schema:
 *           type: string
 *           example: "2026-01-30"
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: number
 *           example: 15
 *       - in: query
 *         name: instagramAccountId
 *         required: false
 *         schema:
 *           type: string
 *           example: "963930d3-3ab5-45c7-ab74-93071128769f"
 *     responses:
 *       200:
 *         description: Lista de posts analisados
 *       400:
 *         description: Parâmetros inválidos
 *       401:
 *         description: Não autenticado
 */
router.get("/analytics/content", getInstagramContentAnalytics);

/**
 * @openapi
 * /api/instagram/analytics/insights:
 *   get:
 *     tags:
 *       - Instagram Analytics
 *     summary: Insights inteligentes do período (drivers, baseline, anomalias, predição)
 *     description: |
 *       Retorna insights estruturados e explicáveis para o período selecionado no calendário.
 *       Ideal para a camada "IA" do Looma (por que cresceu / o que repetir / o que evitar).
 *
 *       Exemplos de insights:
 *       - Crescimento acima do baseline histórico
 *       - Picos/Quedas fora do padrão (anomalias)
 *       - Drivers prováveis (tipo de conteúdo, horário, frequência) *(quando habilitados)*
 *       - Predição simples (tendência) *(quando habilitada)*
 *
 *       - Range máximo: 30 dias
 *       - Datas em formato YYYY-MM-DD
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         required: true
 *         schema:
 *           type: string
 *           example: "2026-01-01"
 *       - in: query
 *         name: to
 *         required: true
 *         schema:
 *           type: string
 *           example: "2026-01-30"
 *       - in: query
 *         name: instagramAccountId
 *         required: false
 *         schema:
 *           type: string
 *           example: "963930d3-3ab5-45c7-ab74-93071128769f"
 *     responses:
 *       200:
 *         description: Lista de insights do período
 *       400:
 *         description: Parâmetros inválidos
 *       401:
 *         description: Não autenticado
 */
router.get("/analytics/insights", getInstagramInsightsAnalytics);

/**
 * @openapi
 * /api/instagram/analytics/drop-saturation:
 *   get:
 *     tags:
 *       - Instagram Analytics
 *     summary: Análise de Queda e Saturação do período (novo cálculo)
 *     description: |
 *       ✅ NOVO endpoint (não altera o /analytics/insights).
 *
 *       Retorna alertas/insights focados em:
 *       - Quedas relevantes (reach, interações, visitas ao perfil) comparando
 *         o período atual vs o período anterior (mesmo tamanho).
 *       - Saturação por frequência: quando a frequência (posts/dia) aumenta,
 *         mas a entrega/resultado médio cai.
 *
 *       - Range máximo: 30 dias
 *       - Datas em formato YYYY-MM-DD
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: from
 *         required: true
 *         schema:
 *           type: string
 *           example: "2026-01-01"
 *       - in: query
 *         name: to
 *         required: true
 *         schema:
 *           type: string
 *           example: "2026-01-30"
 *       - in: query
 *         name: instagramAccountId
 *         required: false
 *         schema:
 *           type: string
 *           example: "963930d3-3ab5-45c7-ab74-93071128769f"
 *     responses:
 *       200:
 *         description: Lista de insights de queda/saturação do período
 *       400:
 *         description: Parâmetros inválidos
 *       401:
 *         description: Não autenticado
 */
router.get("/analytics/drop-saturation", getInstagramDropSaturationAnalytics);

/**
 * ✅ Export padrão + named (pra você poder importar do jeito que já estiver no projeto)
 */
export const instagramAnalyticsRouter = router;
export default router;
