import { Request, Response } from "express";
import crypto from "crypto";
import axios from "axios";
import { IInstagramIgLoginAuthService } from "../../../application/instagram/IInstagramIgLoginAuthService";
import { CompleteIgLoginUseCase } from "../../../application/instagram/CompleteIgLoginUseCase";
import { prisma } from "../../../infrastructure/db/prismaClient";

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

export class InstagramAuthController {
  constructor(
    private readonly authService: IInstagramIgLoginAuthService,
    private readonly completeLogin: CompleteIgLoginUseCase
  ) {}

  async start(req: Request, res: Response): Promise<void> {
    const stateFromQuery = (req.query.state as string | undefined) ?? "";
    const redirect = (req.query.redirect as string | undefined) ?? "true";

    const state =
      stateFromQuery.trim().length > 0
        ? stateFromQuery.trim()
        : crypto.randomBytes(16).toString("hex");

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

    await this.completeLogin.execute(code, state ?? "");

    const frontUrl = process.env.FRONTEND_URL ?? "http://localhost:5173";
    const returnTo = typeof state === "string" && state.startsWith("/") ? state : "/settings";
    const redirectUrl = `${frontUrl}${returnTo}${returnTo.includes("?") ? "&" : "?"}instagram=connected`;

    res.redirect(redirectUrl);
  }

  async status(req: Request, res: Response): Promise<void> {
    const row = await prisma.instagramAccount.findFirst({
      orderBy: { updatedAt: "desc" }
    });

    if (!row || !row.instagramId || (!row.pageAccessToken && !row.accessToken)) {
      res.json({ connected: false });
      return;
    }

    try {
      // Preferir Page Access Token (IG Graph geralmente exige ele)
      const tokenToUse = row.pageAccessToken ?? row.accessToken!;
      const me = await this.authService.getMe(tokenToUse);

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
    await prisma.instagramAccount.deleteMany({});
    res.status(204).send();
  }

  /**
   * GET /api/instagram/metrics?from=YYYY-MM-DD&to=YYYY-MM-DD
   */
  async metrics(req: Request, res: Response): Promise<void> {
    const from = (req.query.from as string | undefined) ?? "";
    const to = (req.query.to as string | undefined) ?? "";

    if (!from || !to) {
      res.status(400).json({ message: "from e to são obrigatórios no formato YYYY-MM-DD" });
      return;
    }

    const row = await prisma.instagramAccount.findFirst({
      orderBy: { updatedAt: "desc" }
    });

    if (!row || !row.instagramId || (!row.pageAccessToken && !row.accessToken)) {
      res.status(409).json({ message: "Instagram não conectado" });
      return;
    }

    const igUserId = row.instagramId;
    const accessToken = row.pageAccessToken ?? row.accessToken!;

    const graphBaseUrl = process.env.INSTAGRAM_GRAPH_BASE_URL ?? "https://graph.facebook.com/v21.0";

    // unix timestamp em segundos
    const since = Math.floor(parseYmd(from).getTime() / 1000);
    const until = Math.floor((parseYmd(to).getTime() + 86399999) / 1000);

    const graph = axios.create({ baseURL: graphBaseUrl, timeout: 15000 });

    try {
      // 1) profile atual
      const profileRes = await graph.get(`/${igUserId}`, {
        params: {
          fields: "followers_count,username",
          access_token: accessToken
        }
      });

      const followers = Number(profileRes.data?.followers_count ?? 0);
      const username = String(profileRes.data?.username ?? row.instagramUserName ?? "");

      // 2) reach (normal)
      const reachRes = await graph.get(`/${igUserId}/insights`, {
        params: {
          metric: "reach",
          period: "day",
          since,
          until,
          access_token: accessToken
        }
      });

      // 3) profile_views + total_interactions (EXIGE metric_type=total_value)
      const totalsRes = await graph.get(`/${igUserId}/insights`, {
        params: {
          metric: "profile_views,total_interactions",
          metric_type: "total_value",
          period: "day",
          since,
          until,
          access_token: accessToken
        }
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

        // taxa simples (interactions / reach)
        const engagementRate = reach > 0 ? (totalInteractions / reach) * 100 : 0;

        return {
          date: day,
          followers,
          reach,
          profileViews,
          totalInteractions,
          engagementRate
        };
      });

      const totalReach = timeseries.reduce((acc, t) => acc + t.reach, 0);
      const totalInteractions = timeseries.reduce((acc, t) => acc + t.totalInteractions, 0);
      const avgEngagementRate =
        timeseries.length > 0
          ? timeseries.reduce((acc, t) => acc + t.engagementRate, 0) / timeseries.length
          : 0;

      res.json({
        filters: { from, to, granularity: "day", providers: ["instagram"] },
        kpis: {
          followers,
          reach: totalReach,
          totalInteractions,
          engagementRate: avgEngagementRate
        },
        timeseries,
        account: {
          igUserId,
          username
        }
      });
    } catch (err: any) {
      console.error("Erro ao buscar métricas IG:", err?.response?.data ?? err);
      res.status(500).json({
        message: "Erro ao buscar métricas do Instagram",
        details: err?.response?.data ?? String(err)
      });
    }
  }
}
