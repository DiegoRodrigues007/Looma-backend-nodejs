// src/infrastructure/jobs/instagramDailySnapshotsJob.ts
import axios from "axios";
import { prisma } from "../db/prismaClient";
import { fetchDailyInteractionsByPosts } from "../instagram/fetchDailyInteractionsByPosts";

/* =========================
   Helpers
========================= */

function toFiniteNumber(v: any): number {
  const n = Number(
    v?.total_value?.value ??
      v?.total_value ??
      v?.value ??
      (Array.isArray(v?.values) ? v.values?.[0]?.value : undefined) ??
      v ??
      0
  );
  return Number.isFinite(n) ? n : 0;
}

function ymdUtc(d: Date) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dayDateUtc(ymd: string) {
  return new Date(`${ymd}T00:00:00.000Z`);
}

function isTokenLikelyInvalid(reason: string) {
  const msg = reason.toLowerCase();
  return (
    msg.includes("oauth") ||
    msg.includes("token") ||
    msg.includes("expired") ||
    msg.includes("access token") ||
    msg.includes("invalid")
  );
}

/* =========================
   IG Fetch helpers
========================= */

async function fetchReachForDay(opts: {
  graph: ReturnType<typeof axios.create>;
  igUserId: string;
  accessToken: string;
  since: number;
  until: number;
}) {
  const { graph, igUserId, accessToken, since, until } = opts;

  try {
    const res = await graph.get(`/${igUserId}/insights`, {
      params: {
        metric: "reach",
        metric_type: "time_series",
        period: "day",
        since,
        until,
        access_token: accessToken,
      },
    });

    const row = (res.data?.data ?? []).find((x: any) => x?.name === "reach");
    const v = row?.values?.[0]?.value ?? row?.value ?? row?.total_value ?? 0;
    return toFiniteNumber(v);
  } catch {
    return 0;
  }
}

async function fetchProfileViewsTotalForDay(opts: {
  graph: ReturnType<typeof axios.create>;
  igUserId: string;
  accessToken: string;
  since: number;
  until: number;
}) {
  const { graph, igUserId, accessToken, since, until } = opts;

  try {
    const pvRes = await graph.get(`/${igUserId}/insights`, {
      params: {
        metric: "profile_views",
        metric_type: "total_value",
        period: "day",
        since,
        until,
        access_token: accessToken,
      },
    });

    const row = (pvRes.data?.data ?? []).find(
      (x: any) => x?.name === "profile_views"
    );

    return toFiniteNumber(row?.total_value ?? row?.value ?? 0);
  } catch {
    return 0;
  }
}

/* =========================
   Job
========================= */

export type InstagramDailySnapshotsJobResult = {
  ranAt: string;
  processed: number;
  ok: number;
  failed: number;
  failures: Array<{ instagramAccountId: string; reason: string }>;
};

export async function runInstagramDailySnapshotsJob(opts?: {
  ymd?: string;
  limit?: number;
}): Promise<InstagramDailySnapshotsJobResult> {
  const graphBaseUrl =
    process.env.INSTAGRAM_GRAPH_BASE_URL ?? "https://graph.facebook.com/v21.0";

  const graph = axios.create({
    baseURL: graphBaseUrl,
    timeout: 20000,
  });

  const targetYmd = (opts?.ymd ?? ymdUtc(new Date())).slice(0, 10);
  const day = dayDateUtc(targetYmd);

  const since = Math.floor(day.getTime() / 1000);
  const until = Math.floor((day.getTime() + 86399999) / 1000);

  const limit = Math.max(1, Math.min(500, Number(opts?.limit ?? 200)));

  const accounts = await prisma.instagramAccount.findMany({
    where: {
      isConnected: true,
      igUserId: { not: "" },
      userId: { not: "" },
      OR: [{ pageAccessToken: { not: null } }, { accessToken: { not: null } }],
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
    select: {
      id: true,
      userId: true,
      igUserId: true,
      pageAccessToken: true,
      accessToken: true,
    },
  });

  const failures: Array<{ instagramAccountId: string; reason: string }> = [];
  let ok = 0;

  for (const acc of accounts) {
    const instagramAccountId = acc.id;
    const userId = acc.userId;

    const igUserId = String(acc.igUserId ?? "").trim();
    const accessToken = String(acc.pageAccessToken ?? acc.accessToken ?? "").trim();

    if (!igUserId || !accessToken) {
      failures.push({ instagramAccountId, reason: "missing_igUserId_or_token" });
      continue;
    }

    try {
      // followers
      const profileRes = await graph.get(`/${igUserId}`, {
        params: { fields: "followers_count", access_token: accessToken },
      });
      const followers = toFiniteNumber(profileRes.data?.followers_count);

      // profile views
      const profileViewsTotal = await fetchProfileViewsTotalForDay({
        graph,
        igUserId,
        accessToken,
        since,
        until,
      });

      // reach
      const reach = await fetchReachForDay({
        graph,
        igUserId,
        accessToken,
        since,
        until,
      });

      // ✅ total interactions REAL (posts)
      const interactions = await fetchDailyInteractionsByPosts({
        igUserId,
        accessToken,
        from: targetYmd,
        to: targetYmd,
        graph,
      });

      const totalInteractions =
        interactions.totalByDay[targetYmd] ?? 0;

      await prisma.instagramAccountDailyMetrics.upsert({
        where: { instagramAccountId_day: { instagramAccountId, day } },
        update: {
          followers,
          profileViewsTotal,
          reach,
          totalInteractions,
        },
        create: {
          userId,
          instagramAccountId,
          day,
          followers,
          profileViewsTotal,
          reach,
          totalInteractions,
        },
      });

      ok++;
    } catch (e: any) {
      const reason =
        e?.response?.data?.error?.message ||
        e?.response?.data?.message ||
        e?.message ||
        "unknown_error";

      const reasonStr = String(reason);
      failures.push({ instagramAccountId, reason: reasonStr });

      if (isTokenLikelyInvalid(reasonStr)) {
        try {
          await prisma.instagramAccount.update({
            where: { id: instagramAccountId },
            data: {
              isConnected: false,
              accessToken: null,
              pageAccessToken: null,
              expiresAt: null,
              grantedScopes: null,
              facebookPageId: null,
            },
          });
        } catch {}
      }
    }
  }

  return {
    ranAt: new Date().toISOString(),
    processed: accounts.length,
    ok,
    failed: failures.length,
    failures,
  };
}
