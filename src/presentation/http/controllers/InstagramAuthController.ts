import { Request, Response } from "express";
import crypto from "crypto";
import { IInstagramIgLoginAuthService } from "../../../application/instagram/IInstagramIgLoginAuthService";
import { CompleteIgLoginUseCase } from "../../../application/instagram/CompleteIgLoginUseCase";
import { prisma } from "../../../infrastructure/db/prismaClient";

export class InstagramAuthController {
  constructor(
    private readonly authService: IInstagramIgLoginAuthService,
    private readonly completeLogin: CompleteIgLoginUseCase
  ) {}

  async start(req: Request, res: Response): Promise<void> {
    /**
     * Você pode usar:
     * - state = rota do frontend para voltar (ex: /settings, /dashboard?tab=1)
     * - redirect=true (default) para já redirecionar pro Instagram
     * - redirect=false para retornar JSON com a URL
     */
    const stateFromQuery = (req.query.state as string | undefined) ?? "";
    const redirect = (req.query.redirect as string | undefined) ?? "true";

    // Se não vier state, gera um aleatório (mantém CSRF basic)
    // Se vier state, usamos como "returnTo" (rota do frontend)
    const state =
      stateFromQuery.trim().length > 0 ? stateFromQuery.trim() : crypto.randomBytes(16).toString("hex");

    const url = this.authService.buildLoginUrl(state);

    if (redirect === "true") {
      res.redirect(url);
      return;
    }

    res.json({ url, state });
  }

  async callback(req: Request, res: Response): Promise<void> {
    const code = req.query.code as string;
    const state = req.query.state as string;

    if (!code) {
      res.status(400).json({ message: "code é obrigatório" });
      return;
    }

    // state é opcional aqui: se não vier, a gente só volta para /settings
    const result = await this.completeLogin.execute(code, state ?? "");

    // ✅ Ao invés de mostrar JSON, redireciona pro frontend
    const frontUrl = process.env.FRONTEND_URL ?? "http://localhost:5173";

    // Se o state for uma rota (ex: "/settings"), voltamos pra ela.
    // Caso seja um state randômico, cai no fallback.
    const returnTo =
      typeof state === "string" && state.startsWith("/") ? state : "/settings";

    // Se quiser passar um "flag" pro front mostrar toast:
    const redirectUrl = `${frontUrl}${returnTo}${returnTo.includes("?") ? "&" : "?"}instagram=connected`;

    res.redirect(redirectUrl);
  }

  async status(req: Request, res: Response): Promise<void> {
    // ✅ Ajustado para usar instagramAccount (seu schema)
    const row = await prisma.instagramAccount.findFirst();

    if (!row || !row.accessToken || !row.instagramId) {
      res.json({ connected: false });
      return;
    }

    try {
      // Aqui pode ser só retornar do banco também.
      // authService.getMe(...) exige token válido e pode falhar.
      const me = await this.authService.getMe(row.accessToken);

      res.json({
        connected: true,
        igUserId: row.instagramId,
        username: me.username,
        accountType: me.accountType,
        expiresAt: row.accessTokenExpiresAt
      });
    } catch (err) {
      console.error("Erro ao consultar status do Instagram:", err);
      res.status(200).json({
        connected: false,
        message: "Erro ao consultar Instagram. Tente reconectar a conta."
      });
    }
  }

  async disconnect(req: Request, res: Response): Promise<void> {
    // ✅ Ajustado para usar instagramAccount
    await prisma.instagramAccount.deleteMany({});
    res.status(204).send();
  }
}
