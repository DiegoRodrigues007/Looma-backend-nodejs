import { Request, Response } from "express";
import crypto from "crypto";
import { prisma } from "../../../infrastructure/db/prismaClient";
import { IInstagramIgLoginAuthService } from "../../../application/instagram/IInstagramIgLoginAuthService";
import { CompleteIgLoginUseCase } from "../../../application/instagram/CompleteIgLoginUseCase";
import { ListInstagramAccountsUseCase } from "../../../application/instagram/ListInstagramAccountsUseCase";
import { SetActiveInstagramAccountUseCase } from "../../../application/instagram/SetActiveInstagramAccountUseCase";
import { ymd, listDays } from "../instagram/instagramDateUtils";
import { toFiniteNumber } from "../instagram/instagramInsightsMapper";
import { setIgLoginCookie, getIgLoginCookie, clearIgLoginCookie } from "../instagram/instagramCookies";
import { signState, safeParseState } from "../instagram/instagramState";

function s(v: any): string {
  return String(v ?? "").trim();
}

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

function safeJson(res: Response, status: number, body: any) {
  if (!res.headersSent) return res.status(status).json(body);
  return undefined;
}

function safeRedirect(res: Response, status: number, url: string) {
  if (!res.headersSent) return res.redirect(status, url);
  return undefined;
}

function dateOnlyUtcFromYmd(ymdStr: string): Date {
  return new Date(`${ymdStr.slice(0, 10)}T00:00:00.000Z`);
}

function clampRangeDays(from: string, to: string, maxDays = 92) {
  const days = listDays(from, to);
  if (days.length <= maxDays) return { days, from, to };
  const tail = days.slice(days.length - maxDays);
  return { days: tail, from: tail[0], to: tail[tail.length - 1] };
}

function parseBool(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  const ss = String(value).toLowerCase();
  if (ss === "true" || ss === "1") return true;
  if (ss === "false" || ss === "0") return false;
  return undefined;
}

function candidatesOrderBy() {
  return [{ selectedAt: "desc" as const }, { createdAt: "desc" as const }];
}

export class InstagramAuthController {
  constructor(
    private readonly authService: IInstagramIgLoginAuthService,
    private readonly completeLogin: CompleteIgLoginUseCase,
    private readonly listAccounts: ListInstagramAccountsUseCase,
    private readonly setActiveAccount: SetActiveInstagramAccountUseCase
  ) {}

  async start(req: Request, res: Response) {
    const userId = getAuthenticatedUserId(req);
    if (!userId) {
      return safeJson(res, 401, { ok: false, message: "Não autenticado" });
    }

    const rawState = JSON.stringify({
      uid: userId,
      nonce: crypto.randomBytes(12).toString("hex"),
      ts: Date.now(),
    });

    const signedState = signState(rawState);
    setIgLoginCookie(res, userId);

    const url = this.authService.buildLoginUrl(signedState, false);

    const redirect = parseBool((req.query as any)?.redirect);
    if (redirect) return safeRedirect(res, 302, url);

    return safeJson(res, 200, { ok: true, url });
  }

  async callback(req: Request, res: Response) {
    const code = String(req.query.code ?? "");
    const state = String(req.query.state ?? "");

    if (!code) {
      return safeJson(res, 400, { ok: false, message: "code é obrigatório" });
    }

    let userId = getIgLoginCookie(req);
    if (state) {
      const parsed = safeParseState(state);
      if (!userId && parsed?.uid) userId = parsed.uid;
    }

    if (!userId) {
      clearIgLoginCookie(res);
      return safeJson(res, 401, { ok: false, message: "Sessão expirada" });
    }

    try {
      const result = await this.completeLogin.execute(code, state, userId);

      if ((result as any)?.status === "reauth_required") {
        clearIgLoginCookie(res);
        return safeJson(res, 200, { ok: true, ...result });
      }

      if ((result as any)?.status === "choose_required") {
        const selectionId = s((result as any)?.selectionId);

        try {
          const pending = this.completeLogin.getPendingForPersist({
            selectionId,
            userId: s(userId),
          });

          const data = pending.candidates
            .map((c) => ({
              userId: s(userId),
              selectionId,

              igUserId: s(c.igUserId),
              username: c.username ? s(c.username) : null,
              accountType: c.accountType ? s(c.accountType) : null,

              facebookPageId: s(c.facebookPageId),
              facebookPageName: c.facebookPageName ? s(c.facebookPageName) : null,

              pageAccessToken: s((c as any).pageAccessToken),
              source: s(c.source),

              instagramAccountId: null,
            }))
            .filter((c) => c.igUserId && c.facebookPageId && c.pageAccessToken && c.source);

          await prisma.instagramCandidate.deleteMany({
            where: { userId: s(userId), selectionId },
          });

          if (data.length > 0) {
            await prisma.instagramCandidate.createMany({
              data,
              skipDuplicates: true,
            });
          }
        } catch (e: any) {
          console.error("[IG][CANDIDATES][DB_ERROR]", e?.message ?? e);
        }

        clearIgLoginCookie(res);
        return safeJson(res, 200, { ok: true, ...result });
      }

      clearIgLoginCookie(res);
      return safeJson(res, 200, { ok: true, status: "ok" });
    } catch (e: any) {
      clearIgLoginCookie(res);
      return safeJson(res, 500, {
        ok: false,
        message: e?.message ?? "Erro no login IG",
      });
    }
  }

  async candidates(req: Request, res: Response) {
    res.setHeader("Cache-Control", "no-store");

    const userId = getAuthenticatedUserId(req);
    if (!userId) return safeJson(res, 401, { ok: false, message: "Não autenticado" });

    let selectionId = s((req.query as any)?.selectionId);

    if (!selectionId) {
      const last = await prisma.instagramCandidate.findFirst({
        where: { userId: s(userId) },
        orderBy: candidatesOrderBy(),
        select: { selectionId: true },
      });
      selectionId = s(last?.selectionId);
    }

    const where: any = { userId: s(userId) };
    if (selectionId) where.selectionId = selectionId;

    const rows = await prisma.instagramCandidate.findMany({
      where,
      orderBy: candidatesOrderBy(),
      take: 50,
    });

    return safeJson(res, 200, {
      ok: true,
      selectionId: selectionId || null,
      total: rows.length,
      candidates: rows,
    });
  }

  async status(req: Request, res: Response) {
    res.setHeader("Cache-Control", "no-store");

    const userId = getAuthenticatedUserId(req);
    if (!userId) return safeJson(res, 401, { ok: false, message: "Não autenticado" });

    const user = await prisma.user.findUnique({
      where: { id: s(userId) },
      select: { id: true, activeInstagramAccountId: true },
    });

    const accounts = await prisma.instagramAccount.findMany({
      where: {
        userId: s(userId),
        isConnected: true,
        OR: [{ pageAccessToken: { not: null } }, { accessToken: { not: null } }],
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        igUserId: true,
        username: true,
        accountType: true,
        facebookPageId: true,
        expiresAt: true,
        isConnected: true,
        updatedAt: true,
      },
      take: 50,
    });

    let activeId = user?.activeInstagramAccountId ?? null;
    let active = activeId ? accounts.find((a) => a.id === activeId) ?? null : null;

    if ((!activeId || !active) && accounts.length > 0) {
      active = accounts[0];
      activeId = active.id;
      try {
        await prisma.user.update({
          where: { id: s(userId) },
          data: { activeInstagramAccountId: activeId },
        });
      } catch {}
    }

    return safeJson(res, 200, {
      ok: true,
      connected: accounts.length > 0,
      totalAccounts: accounts.length,
      activeInstagramAccountId: activeId,
      account: active
        ? {
            id: active.id,
            igUserId: active.igUserId,
            username: active.username ?? null,
            accountType: active.accountType ?? null,
            facebookPageId: active.facebookPageId ?? null,
            expiresAt: active.expiresAt ?? null,
            isConnected: active.isConnected,
            updatedAt: active.updatedAt,
          }
        : null,
    });
  }

  async accounts(req: Request, res: Response) {
    res.setHeader("Cache-Control", "no-store");

    const userId = getAuthenticatedUserId(req);
    if (!userId) return safeJson(res, 401, { ok: false, message: "Não autenticado" });

    if (this.listAccounts && typeof (this.listAccounts as any).execute === "function") {
      const out = await (this.listAccounts as any).execute(s(userId));
      return safeJson(res, 200, { ok: true, ...out });
    }

    const user = await prisma.user.findUnique({
      where: { id: s(userId) },
      select: { activeInstagramAccountId: true },
    });

    const rows = await prisma.instagramAccount.findMany({
      where: {
        userId: s(userId),
        isConnected: true,
        OR: [{ pageAccessToken: { not: null } }, { accessToken: { not: null } }],
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        igUserId: true,
        username: true,
        accountType: true,
        facebookPageId: true,
        expiresAt: true,
        isConnected: true,
        updatedAt: true,
      },
      take: 50,
    });

    let activeId = user?.activeInstagramAccountId ?? null;
    const activeExists = activeId ? rows.some((r) => r.id === activeId) : false;

    if ((!activeId || !activeExists) && rows.length > 0) {
      activeId = rows[0].id;
      try {
        await prisma.user.update({
          where: { id: s(userId) },
          data: { activeInstagramAccountId: activeId },
        });
      } catch {}
    }

    return safeJson(res, 200, {
      ok: true,
      activeInstagramAccountId: activeId,
      total: rows.length,
      accounts: rows.map((r) => ({
        id: r.id,
        igUserId: r.igUserId,
        username: r.username ?? null,
        accountType: r.accountType ?? null,
        facebookPageId: r.facebookPageId ?? null,
        expiresAt: r.expiresAt ?? null,
        isConnected: r.isConnected,
        updatedAt: r.updatedAt,
        isActive: activeId ? r.id === activeId : false,
      })),
    });
  }

  async setActive(req: Request, res: Response) {
    res.setHeader("Cache-Control", "no-store");

    const userId = getAuthenticatedUserId(req);
    if (!userId) return safeJson(res, 401, { ok: false, message: "Não autenticado" });

    const instagramAccountId = s((req.body as any)?.instagramAccountId);
    if (!instagramAccountId) {
      return safeJson(res, 400, { ok: false, message: "instagramAccountId é obrigatório" });
    }

    if (this.setActiveAccount && typeof (this.setActiveAccount as any).execute === "function") {
      const out = await (this.setActiveAccount as any).execute(s(userId), instagramAccountId);
      return safeJson(res, 200, { ok: true, ...out });
    }

    const exists = await prisma.instagramAccount.findFirst({
      where: {
        id: instagramAccountId,
        userId: s(userId),
        isConnected: true,
        OR: [{ pageAccessToken: { not: null } }, { accessToken: { not: null } }],
      },
      select: {
        id: true,
        igUserId: true,
        username: true,
        accountType: true,
        facebookPageId: true,
        updatedAt: true,
      },
    });

    if (!exists) {
      return safeJson(res, 404, {
        ok: false,
        message: "Conta Instagram não encontrada para este usuário (ou não está conectada).",
      });
    }

    await prisma.user.update({
      where: { id: s(userId) },
      data: { activeInstagramAccountId: exists.id },
    });

    return safeJson(res, 200, {
      ok: true,
      activeInstagramAccountId: exists.id,
      account: {
        id: exists.id,
        igUserId: exists.igUserId,
        username: exists.username ?? null,
        accountType: exists.accountType ?? null,
        facebookPageId: exists.facebookPageId ?? null,
        updatedAt: exists.updatedAt,
      },
    });
  }

  async metrics(req: Request, res: Response) {
    res.setHeader("Cache-Control", "no-store");

    const userId = getAuthenticatedUserId(req);
    if (!userId) return safeJson(res, 401, { ok: false, message: "Não autenticado" });

    const from = String(req.query.from ?? "").slice(0, 10);
    const to = String(req.query.to ?? "").slice(0, 10);

    if (!from || !to || from > to) {
      return safeJson(res, 400, { ok: false, message: "Range inválido" });
    }

    const { days, from: safeFrom, to: safeTo } = clampRangeDays(from, to, 92);

    const user = await prisma.user.findUnique({
      where: { id: s(userId) },
      select: { activeInstagramAccountId: true },
    });

    const account =
      (user?.activeInstagramAccountId
        ? await prisma.instagramAccount.findFirst({
            where: {
              id: user.activeInstagramAccountId,
              userId: s(userId),
              isConnected: true,
            },
            orderBy: { updatedAt: "desc" },
          })
        : null) ||
      (await prisma.instagramAccount.findFirst({
        where: { userId: s(userId), isConnected: true },
        orderBy: { updatedAt: "desc" },
      }));

    if (!account) {
      return safeJson(res, 404, { ok: false, message: "Conta do Instagram não encontrada" });
    }

    const rows = await prisma.instagramAccountDailyMetrics.findMany({
      where: {
        userId: s(userId),
        instagramAccountId: account.id,
        day: {
          gte: dateOnlyUtcFromYmd(safeFrom),
          lte: dateOnlyUtcFromYmd(safeTo),
        },
      },
      orderBy: { day: "asc" },
    });

    const byDay: Record<string, any> = {};
    for (const r of rows) byDay[ymd(r.day)] = r;

    const timeseries = days.map((day) => {
      const r = byDay[day];
      const followers = toFiniteNumber(r?.followers);
      const reach = toFiniteNumber(r?.reach);
      const profileViews = toFiniteNumber(r?.profileViewsTotal);
      const totalInteractions = toFiniteNumber(r?.totalInteractions);
      const engagementRate = reach > 0 ? (totalInteractions / reach) * 100 : 0;

      return {
        date: day,
        followers,
        reach,
        profileViews,
        totalInteractions,
        engagementRate,
      };
    });

    const totalReach = timeseries.reduce((a, b) => a + b.reach, 0);
    const totalInteractions = timeseries.reduce((a, b) => a + b.totalInteractions, 0);
    const avgEngagementRate =
      timeseries.reduce((a, b) => a + b.engagementRate, 0) / Math.max(1, timeseries.length);

    const followers = timeseries.length > 0 ? timeseries[timeseries.length - 1].followers : 0;

    return safeJson(res, 200, {
      ok: true,
      activeInstagramAccountId: user?.activeInstagramAccountId ?? null,
      instagramAccountIdUsed: account.id,
      filters: { from: safeFrom, to: safeTo },
      kpis: {
        followers,
        reach: totalReach,
        totalInteractions,
        engagementRate: avgEngagementRate,
      },
      timeseries,
      meta: {
        source: "instagram_account_daily_metrics",
        generatedBy: "cron",
      },
    });
  }
}
