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
    const stateFromQuery = (req.query.state as string | undefined) ?? "";
    const redirect = (req.query.redirect as string | undefined) ?? "true";

    const state =
      stateFromQuery.trim().length > 0 ? stateFromQuery : crypto.randomBytes(16).toString("hex");

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

    if (!code || !state) {
      res.status(400).json({ message: "code e state são obrigatórios" });
      return;
    }

    const result = await this.completeLogin.execute(code, state);
    res.json(result);
  }

  async status(req: Request, res: Response): Promise<void> {
    const row = await prisma.instagramToken.findFirst();

    if (!row) {
      res.json({ connected: false });
      return;
    }

    try {
      const me = await this.authService.getMe(row.accessToken);

      res.json({
        connected: true,
        igUserId: row.igUserId,
        username: me.username,
        accountType: me.accountType,
        expiresAt: row.expiresAt
      });
    } catch (err) {
      console.error("Erro ao consultar status do Instagram:", err);
      res.status(500).json({
        connected: false,
        message: "Erro ao consultar Instagram. Tente reconectar a conta."
      });
    }
  }

  async disconnect(req: Request, res: Response): Promise<void> {
    await prisma.instagramToken.deleteMany({});
    res.status(204).send();
  }
}
