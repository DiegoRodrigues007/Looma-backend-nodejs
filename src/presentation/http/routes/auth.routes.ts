import { Router } from "express";
import { makeAuthController } from "../../composition/authComposition";
import { authMiddleware } from "../middlewares/authMiddleware";

const controller = makeAuthController();
export const authRouter = Router();

/**
 * @openapi
 * /api/auth/register:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Registra um novo usuário
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 example: "user@example.com"
 *               userName:
 *                 type: string
 *                 example: "user123"
 *               name:
 *                 type: string
 *                 example: "User Name"
 *               password:
 *                 type: string
 *                 example: "SenhaForte123"
 *     responses:
 *       201:
 *         description: Usuário registrado com sucesso
 *       400:
 *         description: Erro de validação
 */
authRouter.post("/register", (req, res) => controller.register(req, res));

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Faz login do usuário
 *     description: |
 *       Retorna accessToken e seta um cookie httpOnly `refresh_token` para renovar a sessão sem deslogar.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 example: "user@example.com"
 *               password:
 *                 type: string
 *                 example: "SenhaForte123"
 *     responses:
 *       200:
 *         description: Login bem-sucedido
 *       401:
 *         description: Credenciais inválidas
 */
authRouter.post("/login", (req, res) => controller.login(req, res));

/**
 * @openapi
 * /api/auth/me:
 *   get:
 *     tags:
 *       - Auth
 *     summary: Retorna o usuário autenticado
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dados do usuário autenticado
 *       401:
 *         description: Não autenticado
 */
authRouter.get("/me", authMiddleware, (req, res) => controller.me(req, res));

/**
 * @openapi
 * /api/auth/refresh:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Renova o access token usando refresh token via cookie
 *     description: |
 *       Usa o cookie httpOnly `refresh_token` para gerar um novo accessToken sem deslogar.
 *       Não requer Bearer token.
 *     responses:
 *       200:
 *         description: Novo accessToken retornado com sucesso
 *       401:
 *         description: Refresh token ausente, inválido ou expirado
 */
authRouter.post("/refresh", (req, res) => controller.refresh(req, res));

/**
 * @openapi
 * /api/auth/logout:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Logout do usuário
 *     description: |
 *       Revoga o refresh token atual (se existir) e limpa o cookie `refresh_token`.
 *     responses:
 *       200:
 *         description: Logout realizado com sucesso
 */
authRouter.post("/logout", (req, res) => controller.logout(req, res));
