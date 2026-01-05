import { Request, Response } from "express";
import crypto from "crypto";
import axios from "axios";
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

function normalizeReturnTo(raw: unknown, frontendUrl: string): string {
  const fallback = "/settings";
  if (typeof raw !== "string") return fallback;

  const v = raw.trim();
  if (!v) return fallback;

  if (v.startsWith("/")) return v;

  try {
    const u = new URL(v);
    const front = new URL(frontendUrl);

    if (u.origin === front.origin) {
      const path = u.pathname + (u.search || "") + (u.hash || "");
      return path.startsWith("/") ? path : `/${path}`;
    }
  } catch {
  }

  return fallback;
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

function buildFrontRedirect(frontendUrl: string, returnTo: string, flagKey: string) {
  const sep = returnTo.includes("?") ? "&" : "?";
  return `${frontendUrl}${returnTo}${sep}${flagKey}=connected`;
}

function isExpired(expiresAt: Date | null | undefined, skewSeconds = 60): boolean {
  if (!expiresAt) return false;
  const now = Date.now();
  const exp = expiresAt.getTime();
  return exp - now <= skewSeconds * 1000;
}

type RefreshResult = {
  accessToken: string;
  expiresAt?: Date | null;
};

type TokenRec = {
  userId: string;
  channelId: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: Date | null;
};

export class YouTubeAuthController {
  private tokenStore = new PrismaYouTubeTokenStore();

  constructor(
    private readonly authService: IYouTubeAuthService,
    private readonly completeLogin: CompleteYouTubeLoginUseCase
  ) {}

  private async ensureValidAccessToken(rec: TokenRec) {
    const canRefresh = !!rec.refreshToken;
    let accessToken = rec.accessToken || "";

    if ((!accessToken || isExpired(rec.expiresAt ?? null)) && canRefresh) {
      const refreshed: RefreshResult = await this.authService.refreshAccessToken(rec.refreshToken!);
      accessToken = refreshed.accessToken;

      await this.tokenStore.saveOrUpdate({
        userId: rec.userId,
        channelId: rec.channelId!,
        accessToken,
        expiresAt: refreshed.expiresAt ?? null,
        lastRefreshedAt: new Date(),
        isConnected: true,
      });
    }

    if (!accessToken) {
      const err: any = new Error("Sem accessToken do YouTube. Reconecte sua conta.");
      err.code = "YOUTUBE_TOKEN_MISSING";
      err.httpStatus = 409;
      throw err;
    }

    return { accessToken, canRefresh };
  }

  private handleProviderError(
    res: Response,
    err: any,
    fallbackMessage: string,
    fallbackCode: string
  ) {
    if (axios.isAxiosError(err)) {
      const providerStatus = err.response?.status;
      const providerData = err.response?.data;

      if (providerStatus === 401 || providerStatus === 403) {
        return res.status(409).json({
          message: "Credenciais do YouTube inválidas/expiradas. Reconecte sua conta do YouTube.",
          code: "YOUTUBE_TOKEN_INVALID",
          details: { providerStatus, providerData },
        });
      }

      return res.status(502).json({
        message: "Falha ao consultar a API do YouTube/Google.",
        code: "YOUTUBE_PROVIDER_ERROR",
        details: { providerStatus, providerData },
      });
    }

    return res.status(500).json({
      message: err?.message || fallbackMessage,
      code: fallbackCode,
    });
  }

  async start(req: Request, res: Response) {
    const userId = getAuthenticatedUserId(req);
    if (!userId) return res.status(401).json({ message: "Não autenticado" });

    const redirect = parseRedirectParam(req.query.redirect);
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

    const returnTo = normalizeReturnTo(req.query.state, frontendUrl);

    setYtLoginCookie(res, userId);

    const payload = JSON.stringify({ uid: userId, returnTo });
    const signedState = signState(payload);

    const url = this.authService.buildLoginUrl(signedState);

    if (redirect) return res.json({ url });
    return res.redirect(url);
  }

  async callback(req: Request, res: Response) {
    const code = typeof req.query.code === "string" ? req.query.code : null;
    const state = typeof req.query.state === "string" ? req.query.state : null;

    if (!code) return res.status(400).json({ message: "Parâmetro code inválido" });

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

    const cookieUid = getYtLoginCookie(req);
    clearYtLoginCookie(res);

    const parsed = state ? safeParseState(state) : {};
    const userId = parsed.uid || cookieUid;

    if (!userId) {
      return res.status(401).json({ message: "Sessão do login expirou (cookie ausente)" });
    }

    await this.completeLogin.execute({ userId, code });

    const returnTo = normalizeReturnTo(parsed.returnTo, frontendUrl);
    const redirectUrl = buildFrontRedirect(frontendUrl, returnTo, "youtube");

    return res.redirect(redirectUrl);
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

    if (!from || !to) {
      return res.status(400).json({
        message: "from e to são obrigatórios (YYYY-MM-DD)",
        code: "INVALID_RANGE",
      });
    }

    const recDb = await this.tokenStore.getByUserId(userId);
    if (!recDb?.channelId) {
      return res.status(409).json({
        message: "YouTube não conectado",
        code: "YOUTUBE_NOT_CONNECTED",
      });
    }

    const rec: TokenRec = {
      userId,
      channelId: recDb.channelId,
      accessToken: recDb.accessToken ?? null,
      refreshToken: recDb.refreshToken ?? null,
      expiresAt: recDb.expiresAt ?? null,
    };

    try {
      let { accessToken, canRefresh } = await this.ensureValidAccessToken(rec);

      try {
        const channel = await this.authService.getMyChannel(accessToken);
        const analytics = await this.authService.getAnalyticsDaily({ accessToken, from, to });

        return res.json({
          channel,
          analytics,
          range: { from, to },
        });
      } catch (err: any) {
        if (
          axios.isAxiosError(err) &&
          (err.response?.status === 401 || err.response?.status === 403) &&
          canRefresh
        ) {
          const refreshed = await this.authService.refreshAccessToken(rec.refreshToken!);
          accessToken = refreshed.accessToken;

          await this.tokenStore.saveOrUpdate({
            userId,
            channelId: rec.channelId!,
            accessToken,
            expiresAt: refreshed.expiresAt ?? null,
            lastRefreshedAt: new Date(),
            isConnected: true,
          });

          const channel = await this.authService.getMyChannel(accessToken);
          const analytics = await this.authService.getAnalyticsDaily({ accessToken, from, to });

          return res.json({
            channel,
            analytics,
            range: { from, to },
          });
        }

        return this.handleProviderError(
          res,
          err,
          "Erro inesperado ao buscar métricas do YouTube.",
          "YOUTUBE_UNKNOWN_ERROR"
        );
      }
    } catch (err: any) {
      if (err?.httpStatus) {
        return res.status(err.httpStatus).json({ message: err.message, code: err.code });
      }
      return res.status(500).json({
        message: err?.message || "Erro inesperado ao buscar métricas do YouTube.",
        code: "YOUTUBE_UNKNOWN_ERROR",
      });
    }
  }

  async topContent(req: Request, res: Response) {
    const userId = getAuthenticatedUserId(req);
    if (!userId) return res.status(401).json({ message: "Não autenticado" });

    const from = typeof req.query.from === "string" ? req.query.from : null;
    const to = typeof req.query.to === "string" ? req.query.to : null;
    const limit = Math.min(Math.max(Number(req.query.limit ?? 10) || 10, 1), 25);

    if (!from || !to) {
      return res.status(400).json({
        message: "from e to são obrigatórios (YYYY-MM-DD)",
        code: "INVALID_RANGE",
      });
    }

    const recDb = await this.tokenStore.getByUserId(userId);
    if (!recDb?.channelId) {
      return res.status(409).json({
        message: "YouTube não conectado",
        code: "YOUTUBE_NOT_CONNECTED",
      });
    }

    const rec: TokenRec = {
      userId,
      channelId: recDb.channelId,
      accessToken: recDb.accessToken ?? null,
      refreshToken: recDb.refreshToken ?? null,
      expiresAt: recDb.expiresAt ?? null,
    };

    try {
      let { accessToken, canRefresh } = await this.ensureValidAccessToken(rec);

      try {
        const result = await this.authService.getTopContent({
          accessToken,
          from,
          to,
          limit,
        });

        return res.json(result);
      } catch (err: any) {
        if (
          axios.isAxiosError(err) &&
          (err.response?.status === 401 || err.response?.status === 403) &&
          canRefresh
        ) {
          const refreshed = await this.authService.refreshAccessToken(rec.refreshToken!);
          accessToken = refreshed.accessToken;

          await this.tokenStore.saveOrUpdate({
            userId,
            channelId: rec.channelId!,
            accessToken,
            expiresAt: refreshed.expiresAt ?? null,
            lastRefreshedAt: new Date(),
            isConnected: true,
          });

          const result = await this.authService.getTopContent({
            accessToken,
            from,
            to,
            limit,
          });

          return res.json(result);
        }

        return this.handleProviderError(
          res,
          err,
          "Erro inesperado ao buscar top conteúdos do YouTube.",
          "YOUTUBE_TOP_CONTENT_ERROR"
        );
      }
    } catch (err: any) {
      if (err?.httpStatus) {
        return res.status(err.httpStatus).json({ message: err.message, code: err.code });
      }
      return res.status(500).json({
        message: err?.message || "Erro inesperado ao buscar top conteúdos do YouTube.",
        code: "YOUTUBE_TOP_CONTENT_ERROR",
      });
    }
  }
}
