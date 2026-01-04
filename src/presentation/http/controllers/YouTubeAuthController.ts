import { Request, Response } from "express";
import crypto from "crypto";
import { IYouTubeAuthService } from "../../../application/youtube/IYouTubeAuthService";
import { CompleteYouTubeLoginUseCase } from "../../../application/youtube/CompleteYouTubeLoginUseCase";
import { PrismaYouTubeTokenStore } from "../../../infrastructure/db/PrismaYouTubeTokenStore";

function getAuthenticatedUserId(req: Request): string | null {
  const anyReq = req as any;

  const fromUser =
    anyReq?.user?.sub ||
    anyReq?.user?.id ||
    anyReq?.user?.userId ||
    anyReq?.userId ||
    null;

  if (typeof fromUser === "string" && fromUser.trim()) return fromUser.trim();
  if (typeof fromUser === "number") return String(fromUser);

  const fromHeader = req.header("x-user-id");
  if (typeof fromHeader === "string" && fromHeader.trim()) return fromHeader.trim();

  return null;
}

const YT_LOGIN_UID_COOKIE = "yt_login_uid";

function setYtLoginCookie(res: Response, userId: string) {
  res.cookie(YT_LOGIN_UID_COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 10 * 60 * 1000,
    path: "/",
  });
}

function getYtLoginCookie(req: Request): string | null {
  const anyReq = req as any;
  const v = anyReq?.cookies?.[YT_LOGIN_UID_COOKIE];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function clearYtLoginCookie(res: Response) {
  res.clearCookie(YT_LOGIN_UID_COOKIE, { path: "/" });
}

const STATE_SIGN_SECRET =
  process.env.YT_STATE_SIGN_SECRET || process.env.JWT_SECRET || "dev_secret_change_me";

function signState(payload: string) {
  const h = crypto.createHmac("sha256", STATE_SIGN_SECRET).update(payload).digest("hex");
  return `${payload}.${h}`;
}

function verifyState(signed: string): string | null {
  const idx = signed.lastIndexOf(".");
  if (idx <= 0) return null;

  const payload = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);

  const expected = crypto.createHmac("sha256", STATE_SIGN_SECRET).update(payload).digest("hex");
  if (sig.length !== expected.length) return null;

  const ok = crypto.timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(expected, "utf8"));
  return ok ? payload : null;
}

function safeParseState(state: string): { uid?: string; returnTo?: string } {
  const verified = verifyState(state);
  if (!verified) return {};

  try {
    const parsed = JSON.parse(verified);
    return {
      uid: parsed?.uid != null ? String(parsed.uid) : undefined,
      returnTo: typeof parsed?.returnTo === "string" ? String(parsed.returnTo) : undefined,
    };
  } catch {
    return {};
  }
}

function parseRedirectParam(v: unknown): boolean {
  if (v === undefined || v === null || v === "") return true;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1;

  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes" || s === "y") return true;
    if (s === "false" || s === "0" || s === "no" || s === "n") return false;
  }
  return true;
}

export class YouTubeAuthController {
  private tokenStore = new PrismaYouTubeTokenStore();

  constructor(
    private readonly authService: IYouTubeAuthService,
    private readonly completeLogin: CompleteYouTubeLoginUseCase
  ) {}

  async start(req: Request, res: Response) {
    const userId = getAuthenticatedUserId(req);
    if (!userId) return res.status(401).json({ message: "Não autenticado" });

    const redirect = parseRedirectParam(req.query.redirect);

    // state pode vir como "returnTo"
    const returnTo = typeof req.query.state === "string" ? req.query.state : "/settings";

    // cookie curto só pra segurar userId no callback
    setYtLoginCookie(res, userId);

    const payload = JSON.stringify({ uid: userId, returnTo });
    const signedState = signState(payload);

    const url = this.authService.buildLoginUrl(signedState);

    // padrão igual IG: se redirect=true -> JSON com url. Se false -> res.redirect(url)
    if (redirect) return res.json({ url });
    return res.redirect(url);
  }

  async callback(req: Request, res: Response) {
    const code = typeof req.query.code === "string" ? req.query.code : null;
    const state = typeof req.query.state === "string" ? req.query.state : null;

    if (!code) return res.status(400).json({ message: "Parâmetro code inválido" });

    const cookieUid = getYtLoginCookie(req);
    clearYtLoginCookie(res);

    const parsed = state ? safeParseState(state) : {};
    const userId = parsed.uid || cookieUid;

    if (!userId) return res.status(401).json({ message: "Sessão do login expirou (cookie ausente)" });

    await this.completeLogin.execute({ userId, code });

    const returnTo = parsed.returnTo || "/settings";
    const url = returnTo.includes("?")
      ? `${returnTo}&youtube=connected`
      : `${returnTo}?youtube=connected`;

    return res.redirect(url);
  }

  async status(req: Request, res: Response) {
    const userId = getAuthenticatedUserId(req);
    if (!userId) return res.status(401).json({ message: "Não autenticado" });

    const rec = await this.tokenStore.getByUserId(userId);
    return res.json({
      connected: !!rec?.channelId,
      channelId: rec?.channelId ?? null,
    });
  }

  async disconnect(req: Request, res: Response) {
    const userId = getAuthenticatedUserId(req);
    if (!userId) return res.status(401).json({ message: "Não autenticado" });

    await this.tokenStore.disconnect(userId);
    return res.status(204).send();
  }

  async metrics(req: Request, res: Response) {
    const userId = getAuthenticatedUserId(req);
    if (!userId) return res.status(401).json({ message: "Não autenticado" });

    const from = typeof req.query.from === "string" ? req.query.from : null;
    const to = typeof req.query.to === "string" ? req.query.to : null;

    if (!from || !to) return res.status(400).json({ message: "from e to são obrigatórios (YYYY-MM-DD)" });

    const rec = await this.tokenStore.getByUserId(userId);
    if (!rec?.channelId) return res.status(409).json({ message: "YouTube não conectado" });

    let accessToken = rec.accessToken;

    // tenta renovar se não tiver accessToken
    if (!accessToken && rec.refreshToken) {
      const refreshed = await this.authService.refreshAccessToken(rec.refreshToken);
      accessToken = refreshed.accessToken;

      await this.tokenStore.saveOrUpdate({
        userId,
        channelId: rec.channelId,
        accessToken,
        expiresAt: refreshed.expiresAt ?? null,
        lastRefreshedAt: new Date(),
        isConnected: true,
      });
    }

    if (!accessToken) return res.status(401).json({ message: "Sem accessToken (reconecte o YouTube)" });

    const channel = await this.authService.getMyChannel(accessToken);
    const analytics = await this.authService.getAnalyticsDaily({ accessToken, from, to });

    return res.json({
      channel,
      analytics,
      range: { from, to },
    });
  }
}
