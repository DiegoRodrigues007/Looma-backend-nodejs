import { Request, Response } from "express";
import crypto from "crypto";
import axios from "axios";
import { IInstagramIgLoginAuthService } from "../../../application/instagram/IInstagramIgLoginAuthService";
import { CompleteIgLoginUseCase } from "../../../application/instagram/CompleteIgLoginUseCase";
import { prisma } from "../../../infrastructure/db/prismaClient";

// =====================================================
// Helpers de data
// =====================================================
function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

function parseYmd(ymdStr: string): Date {
  return new Date(`${ymdStr}T00:00:00.000Z`);
}

function listDays(from: string, to: string): string[] {
  const start = parseYmd(from);
  const end = parseYmd(to);

  const days: string[] = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(ymd(d));
  }
  return days;
}

function mapInsightByDay(insightsData: any[], metricName: string): Record<string, number> {
  const item = insightsData?.find((x: any) => x?.name === metricName);
  const values = item?.values ?? [];
  const out: Record<string, number> = {};

  for (const v of values) {
    const endTime: string | undefined = v?.end_time;
    if (!endTime) continue;
    const day = endTime.slice(0, 10);
    out[day] = Number(v?.value ?? 0);
  }

  return out;
}

// =====================================================
// 🔐 Helpers de autenticação
// =====================================================
function getAuthenticatedUserId(req: Request): string | null {
  const anyReq = req as any;

  const fromUser =
    anyReq?.user?.sub ||
    anyReq?.user?.id ||
    anyReq?.user?.userId ||
    anyReq?.userId ||
    null;

  if (typeof fromUser === "string" && fromUser.trim().length > 0) return fromUser.trim();
  if (typeof fromUser === "number") return String(fromUser);

  const fromHeader = req.header("x-user-id");
  if (typeof fromHeader === "string" && fromHeader.trim().length > 0) return fromHeader.trim();

  return null;
}

// =====================================================
// Cookie temporário para callback
// =====================================================
const IG_LOGIN_UID_COOKIE = "ig_login_uid";

function setIgLoginCookie(res: Response, userId: string) {
  res.cookie(IG_LOGIN_UID_COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 10 * 60 * 1000,
    path: "/",
  });
}

function getIgLoginCookie(req: Request): string | null {
  const anyReq = req as any;
  const v = anyReq?.cookies?.[IG_LOGIN_UID_COOKIE];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function clearIgLoginCookie(res: Response) {
  res.clearCookie(IG_LOGIN_UID_COOKIE, { path: "/" });
}

// =====================================================
// state assinado (fallback caso cookie falhe)
// =====================================================
const STATE_SIGN_SECRET =
  process.env.IG_STATE_SIGN_SECRET || process.env.JWT_SECRET || "dev_secret_change_me";

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

// ✅ parse robusto para querystring
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

/**
 * Extrai igUserId de retornos variados do UseCase
 */
function extractIgUserId(result: any): string | null {
  const v =
    result?.instagramId ||
    result?.igUserId ||
    result?.account?.instagramId ||
    result?.account?.igUserId ||
    result?.me?.id ||
    result?.me?.instagramId ||
    null;

  if (!v) return null;
  return String(v);
}

function isInstagramTokenInvalid(err: any): boolean {
  const data = err?.response?.data;
  const code = data?.error?.code;
  const subcode = data?.error?.error_subcode;
  const message = String(data?.error?.message ?? "").toLowerCase();

  if (code === 190) return true;
  if (typeof subcode === "number" && [458, 459, 460, 463, 464, 467].includes(subcode)) return true;
  if (message.includes("invalid oauth access token")) return true;
  if (message.includes("session has expired")) return true;
  if (message.includes("has been invalidated")) return true;

  return false;
}

// =====================================================
// Controller
// =====================================================
export class InstagramAuthController {
  constructor(
    private readonly authService: IInstagramIgLoginAuthService,
    private readonly completeLogin: CompleteIgLoginUseCase
  ) {}

  /**
   * GET /api/instagram/start?redirect=false&state=/settings
   */
  async start(req: Request, res: Response): Promise<void> {
    const userId = getAuthenticatedUserId(req);
    if (!userId) {
      res.status(401).json({ message: "Não autenticado" });
      return;
    }

    const stateFromQuery = String(req.query.state ?? "").trim();
    const redirect = parseRedirectParam(req.query.redirect);

    const returnTo = stateFromQuery.length > 0 ? stateFromQuery : "/settings";

    const rawState = JSON.stringify({
      returnTo,
      uid: userId,
      nonce: crypto.randomBytes(12).toString("hex"),
      ts: Date.now(),
    });

    const signedState = signState(rawState);

    setIgLoginCookie(res, userId);

    const url = this.authService.buildLoginUrl(signedState);

    reminderLogSafe("[IG] start", { userId, returnTo, redirect });

    if (!redirect) {
      res.status(200).json({ url, state: signedState });
      return;
    }

    res.redirect(302, url);
  }

  /**
   * GET /api/instagram/callback?code=...&state=...
   */
  async callback(req: Request, res: Response): Promise<void> {
    const code = String(req.query.code ?? "");
    const state = String(req.query.state ?? "");

    if (!code) {
      res.status(400).json({ message: "code é obrigatório" });
      return;
    }

    // 1) cookie
    let userId = getIgLoginCookie(req);

    // 2) fallback state assinado
    let returnTo = "/settings";
    if (state) {
      const parsed = safeParseState(state);
      if (!userId && parsed.uid) userId = parsed.uid;

      if (parsed.returnTo && parsed.returnTo.startsWith("/")) {
        returnTo = parsed.returnTo;
      }
    }

    if (!userId) {
      res.status(401).json({
        message: "Sessão do login do Instagram expirou. Inicie o login novamente.",
      });
      return;
    }

    reminderLogSafe("[IG] callback (before execute)", {
      hasCode: !!code,
      hasState: !!state,
      userId,
    });

    try {
      // ✅ Aqui o use-case deve salvar tokens via TokenStore
      const result: any = await this.completeLogin.execute(code, state ?? "", userId);

      const igUserId = extractIgUserId(result);

      // ✅ GARANTE que o registro ficou vinculado ao userId e marca como conectado
      // Se o TokenStore já gravou tudo, isso só reforça.
      if (igUserId) {
        await prisma.instagramAccount.updateMany({
          where: { instagramId: igUserId },
          data: { userId, isConnected: true },
        });
      } else {
        // fallback: marca o mais recente do userId
        const latest = await prisma.instagramAccount.findFirst({
          where: { userId },
          orderBy: { updatedAt: "desc" },
        });

        if (latest) {
          await prisma.instagramAccount.update({
            where: { id: latest.id },
            data: { isConnected: true },
          });
        }
      }
    } catch (err: any) {
      console.error("[IG] callback error:", err?.response?.data ?? err);
      res.status(500).json({
        message: "Erro ao completar login do Instagram",
        details: err?.response?.data ?? String(err),
      });
      return;
    } finally {
      clearIgLoginCookie(res);
    }

    const frontUrl = process.env.FRONTEND_URL ?? "http://localhost:5173";
    const redirectUrl = `${frontUrl}${returnTo}${
      returnTo.includes("?") ? "&" : "?"
    }instagram=connected`;

    reminderLogSafe("[IG] redirect -> front", { redirectUrl });

    res.redirect(302, redirectUrl);
  }

  /**
   * GET /api/instagram/status
   *
   * ✅ Endpoint de UI: confia no banco.
   * Não chama Graph (evita “oscilar” por timeout/rate-limit).
   */
  async status(req: Request, res: Response): Promise<void> {
    const userId = getAuthenticatedUserId(req);
    if (!userId) {
      res.status(401).json({ connected: false, message: "Não autenticado" });
      return;
    }

    const row = await prisma.instagramAccount.findFirst({
      where: { userId },
      orderBy: { updatedAt: "desc" },
    });

    const connected = !!row?.isConnected && (!!row?.pageAccessToken || !!row?.accessToken);

    reminderLogSafe("[IG] status", {
      userId,
      hasRow: !!row,
      instagramId: row?.instagramId ?? null,
      isConnected: row?.isConnected ?? false,
      hasAccessToken: !!row?.accessToken,
      hasPageAccessToken: !!row?.pageAccessToken,
      computedConnected: connected,
    });

    res.json({
      connected,
      igUserId: row?.instagramId ?? null,
      username: row?.instagramUserName ?? null,
      accountType: row?.accountType ?? null,
      expiresAt: row?.accessTokenExpiresAt ?? null,
    });
  }

  /**
   * POST /api/instagram/disconnect
   */
  async disconnect(req: Request, res: Response): Promise<void> {
    const userId = getAuthenticatedUserId(req);
    if (!userId) {
      res.status(401).json({ message: "Não autenticado" });
      return;
    }

    await prisma.instagramAccount.updateMany({
      where: { userId },
      data: {
        isConnected: false,
        accessToken: null,
        pageAccessToken: null,
        accessTokenExpiresAt: null,
        grantedScopes: null,
        facebookPageId: null,
      },
    });

    reminderLogSafe("[IG] disconnect", { userId });

    res.status(204).send();
  }

  /**
   * GET /api/instagram/metrics?from=YYYY-MM-DD&to=YYYY-MM-DD
   *
   * ✅ Aqui valida token de verdade.
   * Se token inválido => marca desconectado e retorna 409.
   */
  async metrics(req: Request, res: Response): Promise<void> {
    const userId = getAuthenticatedUserId(req);
    if (!userId) {
      res.status(401).json({ message: "Não autenticado" });
      return;
    }

    const from = String(req.query.from ?? "");
    const to = String(req.query.to ?? "");

    if (!from || !to) {
      res.status(400).json({ message: "from e to são obrigatórios no formato YYYY-MM-DD" });
      return;
    }

    const row = await prisma.instagramAccount.findFirst({
      where: { userId },
      orderBy: { updatedAt: "desc" },
    });

    if (!row || !row.isConnected || !row.instagramId || (!row.pageAccessToken && !row.accessToken)) {
      res.status(409).json({ message: "Instagram não conectado" });
      return;
    }

    const igUserId = row.instagramId;
    const accessToken = row.pageAccessToken ?? row.accessToken!;
    const graphBaseUrl = process.env.INSTAGRAM_GRAPH_BASE_URL ?? "https://graph.facebook.com/v21.0";

    const since = Math.floor(parseYmd(from).getTime() / 1000);
    const until = Math.floor((parseYmd(to).getTime() + 86399999) / 1000);

    const graph = axios.create({ baseURL: graphBaseUrl, timeout: 15000 });

    try {
      const profileRes = await graph.get(`/${igUserId}`, {
        params: {
          fields: "followers_count,username",
          access_token: accessToken,
        },
      });

      const followers = Number(profileRes.data?.followers_count ?? 0);
      const username = String(profileRes.data?.username ?? row.instagramUserName ?? "");

      const reachRes = await graph.get(`/${igUserId}/insights`, {
        params: {
          metric: "reach",
          period: "day",
          since,
          until,
          access_token: accessToken,
        },
      });

      const totalsRes = await graph.get(`/${igUserId}/insights`, {
        params: {
          metric: "profile_views,total_interactions",
          metric_type: "total_value",
          period: "day",
          since,
          until,
          access_token: accessToken,
        },
      });

      const reachData = reachRes.data?.data ?? [];
      const totalsData = totalsRes.data?.data ?? [];

      const reachByDay = mapInsightByDay(reachData, "reach");
      const profileViewsByDay = mapInsightByDay(totalsData, "profile_views");
      const totalInteractionsByDay = mapInsightByDay(totalsData, "total_interactions");

      const days = listDays(from, to);

      const timeseries = days.map((day) => {
        const reach = reachByDay[day] ?? 0;
        const profileViews = profileViewsByDay[day] ?? 0;
        const totalInteractions = totalInteractionsByDay[day] ?? 0;
        const engagementRate = reach > 0 ? (totalInteractions / reach) * 100 : 0;

        return { date: day, followers, reach, profileViews, totalInteractions, engagementRate };
      });

      const totalReach = timeseries.reduce((acc, t) => acc + t.reach, 0);
      const totalInteractions = timeseries.reduce((acc, t) => acc + t.totalInteractions, 0);
      const avgEngagementRate =
        timeseries.length > 0
          ? timeseries.reduce((acc, t) => acc + t.engagementRate, 0) / timeseries.length
          : 0;

      res.json({
        filters: { from, to, granularity: "day", providers: ["instagram"] },
        kpis: { followers, reach: totalReach, totalInteractions, engagementRate: avgEngagementRate },
        timeseries,
        account: { igUserId, username },
      });
    } catch (err: any) {
      console.error("[IG] metrics error:", err?.response?.data ?? err);

      if (isInstagramTokenInvalid(err)) {
        await prisma.instagramAccount.update({
          where: { id: row.id },
          data: {
            isConnected: false,
            accessToken: null,
            pageAccessToken: null,
            accessTokenExpiresAt: null,
            grantedScopes: null,
            facebookPageId: null,
          },
        });

        res.status(409).json({ message: "Token inválido/expirado. Reconecte o Instagram." });
        return;
      }

      res.status(500).json({
        message: "Erro ao buscar métricas do Instagram",
        details: err?.response?.data ?? String(err),
      });
    }
  }
}

// evita log gigante com token/url inteira no console
function reminderLogSafe(message: string, obj: any) {
  try {
    console.log(message, obj);
  } catch {
    console.log(message);
  }
}
