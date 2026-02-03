import { Router } from "express";
import { MetricsController } from "../controllers/insights/MetricsController";

// ✅ Insights
import { PrismaMetricsSnapshotRepository } from "../../../infrastructure/db/repositories/metrics/PrismaMetricsSnapshotRepository";
import { WeeklyInsightsService } from "../../../application/services/insights/WeeklyInsightsService";
import { InsightsController } from "../controllers/insights/InsightsController";

const router = Router();
const controller = new MetricsController();

// ✅ wiring igual seu padrão: instâncias direto no routes
const snapshotRepo = new PrismaMetricsSnapshotRepository();
const weeklyInsightsService = new WeeklyInsightsService(snapshotRepo);
const insightsController = new InsightsController(weeklyInsightsService);

/**
 * @swagger
 * tags:
 *   - name: Metrics
 *     description: Métricas comparativas e histórico (Instagram, YouTube, etc.)
 */

/**
 * @swagger
 * /api/metrics/instagram/snapshot/ensure:
 *   post:
 *     summary: Garante snapshot diário do Instagram (modo híbrido)
 *     description: >
 *       Cria o snapshot do dia (1 por usuário) caso ainda não exista.
 *       Recomendado chamar ao abrir o dashboard para evitar métricas zeradas.
 *     tags:
 *       - Metrics
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Resultado da operação
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 saved:
 *                   type: boolean
 *                   example: true
 *       400:
 *         description: Conta Instagram não conectada ou credenciais ausentes
 *       401:
 *         description: Usuário não autenticado
 *       500:
 *         description: Falha ao garantir snapshot do dia
 */
router.post(
  "/instagram/snapshot/ensure",
  controller.instagramEnsureSnapshot.bind(controller)
);

/**
 * @swagger
 * /api/metrics/instagram/overview:
 *   get:
 *     summary: Retorna métricas comparativas do Instagram (último vs anterior)
 *     description: >
 *       Retorna métricas do Instagram com comparação automática entre
 *       o snapshot mais recente e o snapshot imediatamente anterior,
 *       incluindo tendência (↑ ↓ =) e variação.
 *     tags:
 *       - Metrics
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Métricas comparativas retornadas com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 followers:
 *                   type: object
 *                   example:
 *                     label: Seguidores
 *                     current: 120
 *                     previous: 115
 *                     delta: 5
 *                     deltaPercent: 4.3
 *                     trend: up
 *                     deltaLabel: "▲ +5 (4.3%)"
 *                 engagement:
 *                   type: object
 *                   example:
 *                     label: Engajamento
 *                     current: 3.2
 *                     previous: 4.0
 *                     delta: -0.8
 *                     trend: down
 *                     deltaLabel: "▼ -0.80pp"
 *       204:
 *         description: Histórico insuficiente para gerar comparação
 *       401:
 *         description: Usuário não autenticado
 */
router.get("/instagram/overview", controller.instagramOverview.bind(controller));

/**
 * @swagger
 * /api/metrics/instagram/period:
 *   get:
 *     summary: Retorna métricas comparativas do Instagram por período
 *     description: >
 *       Compara métricas médias do período atual com o período anterior
 *       (exemplo: últimos 7 dias vs 7 dias anteriores).
 *     tags:
 *       - Metrics
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: days
 *         required: false
 *         schema:
 *           type: number
 *           example: 7
 *         description: Quantidade de dias do período de comparação
 *     responses:
 *       200:
 *         description: Métricas comparativas por período
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 reach:
 *                   type: object
 *                   example:
 *                     label: Alcance
 *                     current: 8200
 *                     previous: 7600
 *                     delta: 600
 *                     deltaPercent: 7.8
 *                     trend: up
 *                     deltaLabel: "▲ +600 (7.8%)"
 *       204:
 *         description: Histórico insuficiente para o período solicitado
 *       401:
 *         description: Usuário não autenticado
 */
router.get("/instagram/period", controller.instagramPeriod.bind(controller));

/**
 * @swagger
 * /api/metrics/instagram/insights/weekly:
 *   get:
 *     summary: Retorna insights semanais (regras simples, sem IA pesada)
 *     description: >
 *       Gera alertas analíticos para o dashboard (ex: queda de engajamento, alcance em queda,
 *       aumento de interações), comparando os últimos N dias com os N dias anteriores.
 *     tags:
 *       - Metrics
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: days
 *         required: false
 *         schema:
 *           type: integer
 *           example: 7
 *         description: Dias do período atual (compara com os N dias anteriores). Min 3, max 30.
 *     responses:
 *       200:
 *         description: Insights retornados com sucesso
 *       401:
 *         description: Usuário não autenticado
 *       500:
 *         description: Falha ao gerar insights
 */
router.get(
  "/instagram/insights/weekly",
  insightsController.weeklyInstagramInsights.bind(insightsController)
);

/**
 * ✅ NOVO: insights do tooltip (post específico)
 *
 * @swagger
 * /api/metrics/instagram/insights/post:
 *   get:
 *     summary: Gera insights acionáveis para um post (tooltip do gráfico)
 *     description: >
 *       Gera A) Por que aconteceu (com prova), B) O que melhorar (vs baseline),
 *       C) O que continuar fazendo. Pode usar IA (Ollama/llama3.2) como narrador,
 *       mas os números/provas são sempre calculados no backend.
 *     tags:
 *       - Metrics
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: postId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID do post (Instagram media id) associado ao pico do gráfico
 *       - in: query
 *         name: baselineDays
 *         required: false
 *         schema:
 *           type: integer
 *           example: 30
 *         description: Quantidade de dias usados como baseline (min 7, max 90). Default 30.
 *     responses:
 *       200:
 *         description: Insights do post retornados com sucesso
 *       400:
 *         description: postId ausente ou Instagram não conectado
 *       401:
 *         description: Usuário não autenticado
 *       404:
 *         description: Post não encontrado
 *       500:
 *         description: Falha ao gerar insights do post
 */
router.get(
  "/instagram/insights/post",
  insightsController.instagramPostInsights.bind(insightsController)
);

export default router;
