// src/presentation/http/controllers/InsightsController.ts

import { Request, Response } from "express";

import {
  WeeklyInsightsService,
  TopContentForInsights,
} from "../../../application/services/WeeklyInsightsService";

import { prisma } from "../../../infrastructure/db/prismaClient";
import { InstagramTopContentService } from "../../../infrastructure/instagram/InstagramTopContentService";

function getUserIdFromReq(req: Request): string | null {
  const anyReq = req as any;

  return (
    anyReq.userId ||
    anyReq.user?.id ||
    anyReq.user?.userId ||
    anyReq.user?.sub || // ✅ IMPORTANTÍSSIMO (seu middleware usa sub)
    anyReq.auth?.userId ||
    anyReq.session?.userId ||
    null
  );
}

function getUserEmailFromReq(req: Request): string | null {
  const anyReq = req as any;
  return anyReq.user?.email || anyReq.email || null;
}

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

function parseYmd(ymdStr: string): Date {
  return new Date(`${ymdStr}T00:00:00.000Z`);
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

type IgCreds = {
  igUserId: string;
  accessToken: string;
};

async function tryGetInstagramCreds(
  userId: string,
  userEmail: string | null
): Promise<IgCreds | null> {
  // ⚠️ Você precisa ajustar esses campos para os nomes REAIS do seu banco,
  // se forem diferentes. Eu deixei como "best-effort" + fallback.

  // 1) tenta por id
  let u: any = null;

  try {
    u = await (prisma as any).user.findUnique({
      where: { id: userId },
      select: {
        instagramIgUserId: true,
        igUserId: true,
        instagramUserId: true,

        instagramAccessToken: true,
        igAccessToken: true,
        accessToken: true,
      },
    });
  } catch {
    u = null;
  }

  // 2) fallback por email (muito comum o JWT sub não ser o id)
  if (!u && userEmail) {
    try {
      u = await (prisma as any).user.findUnique({
        where: { email: userEmail },
        select: {
          instagramIgUserId: true,
          igUserId: true,
          instagramUserId: true,

          instagramAccessToken: true,
          igAccessToken: true,
          accessToken: true,
        },
      });
    } catch {
      u = null;
    }
  }

  const igUserId =
    u?.instagramIgUserId || u?.igUserId || u?.instagramUserId || null;

  const accessToken =
    u?.instagramAccessToken || u?.igAccessToken || u?.accessToken || null;

  if (igUserId && accessToken) {
    return { igUserId: String(igUserId), accessToken: String(accessToken) };
  }

  return null;
}

export class InsightsController {
  private readonly topContentService = new InstagramTopContentService();

  constructor(private readonly weeklyInsightsService: WeeklyInsightsService) {}

  /**
   * GET /api/metrics/instagram/insights/weekly?days=7
   */
  async weeklyInstagramInsights(req: Request, res: Response) {
    try {
      const userId = getUserIdFromReq(req);
      const userEmail = getUserEmailFromReq(req);

      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }

      const daysRaw = String(req.query.days ?? "7");
      const days = Math.min(Math.max(parseInt(daysRaw, 10) || 7, 3), 30); // 3..30

      // ✅ Período atual (pra buscar TopContent)
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);

      const to = today;
      const fromAll = addDays(to, -(days * 2 - 1));
      const currentFrom = addDays(parseYmd(ymd(fromAll)), days);

      const periodFrom = ymd(currentFrom);
      const periodTo = ymd(to);

      // ✅ tenta buscar topContent para regra viral
      let topContent: TopContentForInsights[] | undefined;

      try {
        const creds = await tryGetInstagramCreds(String(userId), userEmail);

        if (creds) {
          const top = await this.topContentService.fetchTopContent({
            accessToken: creds.accessToken,
            igUserId: creds.igUserId,
            from: periodFrom,
            to: periodTo,
            limit: 10,
          });

          // normaliza pro formato do WeeklyInsightsService
          topContent = top.map((x) => ({
            totalInteractions: Number(x.totalInteractions ?? 0),
            reach: x.reach ? Number(x.reach) : undefined,
            captionLength: x.captionLength,
            mediaType: x.mediaType,
          }));
        }
      } catch {
        // não quebra: se falhar, insights continuam só com snapshots
        topContent = undefined;
      }

      const data = await this.weeklyInsightsService.generateForUser(
        String(userId),
        "instagram",
        days,
        topContent
      );

      return res.status(200).json(data);
    } catch (err: any) {
      return res.status(500).json({
        message: "Failed to generate weekly insights",
        error: err?.message ?? String(err),
      });
    }
  }
}
