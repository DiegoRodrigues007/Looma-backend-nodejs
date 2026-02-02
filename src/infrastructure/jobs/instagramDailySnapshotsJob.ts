// src/infrastructure/jobs/instagramDailySnapshotsJob.ts
import axios from "axios";
import { prisma } from "../db/prismaClient";
import { fetchDailyInteractionsByPosts } from "../../application/services/instagram/fetchDailyInteractionsByPosts";

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

function extractGraphErrorMessage(e: any): string {
  return String(
    e?.response?.data?.error?.message ||
      e?.response?.data?.message ||
      e?.message ||
      "unknown_error"
  );
}

/**
 * Busca uma métrica "day" do endpoint /{igUserId}/insights
 * e retorna o valor do dia (primeiro item em values).
 *
 * IMPORTANTE:
 * - Se der erro, lança (não retorna 0).
 * - Isso evita mascarar permissão/token errado.
 */
async function fetchIgInsightDayMetric(opts: {
  graph: ReturnType<typeof axios.create>;
  igUserId: string;
  accessToken: string;
  metric: "reach" | "profile_views";
  since: number;
  until: number;
}): Promise<number> {
  const { graph, igUserId, accessToken, metric, since, until } = opts;

  try {
    const res = await graph.get(`/${igUserId}/insights`, {
      params: {
        metric,
        period: "day",
        since,
        until,
        access_token: accessToken,
      },
    });

    const rows = Array.isArray(res.data?.data) ? res.data.data : [];
    const row = rows.find((x: any) => x?.name === metric);

    // Para period=day geralmente vem: values: [{ value, end_time }]
    const value =
      row?.values?.[0]?.value ??
      row?.total_value?.value ??
      row?.total_value ??
      row?.value ??
      0;

    return toFiniteNumber(value);
  } catch (e: any) {
    const reason = extractGraphErrorMessage(e);
    // 🔥 NÃO mascarar erro -> propaga
    throw new Error(`[IG][INSIGHTS:${metric}] ${reason}`);
  }
}

async function fetchReachForDay(opts: {
  graph: ReturnType<typeof axios.create>;
  igUserId: string;
  accessToken: string;
  since: number;
  until: number;
}) {
  return fetchIgInsightDayMetric({ ...opts, metric: "reach" });
}

async function fetchProfileViewsTotalForDay(opts: {
  graph: ReturnType<typeof axios.create>;
  igUserId: string;
  accessToken: string;
  since: number;
  until: number;
}) {
  return fetchIgInsightDayMetric({ ...opts, metric: "profile_views" });
}

/**
 * Soma o total de interações a partir do retorno atual de fetchDailyInteractionsByPosts,
 * que é um array DailyInteractions[] (sem totalByDay).
 *
 * Como o shape pode variar entre versões, tentamos campos comuns e caímos em "0".
 */
function sumTotalInteractionsForYmd(
  dailyInteractions: any,
  targetYmd: string
): number {
  const arr = Array.isArray(dailyInteractions) ? dailyInteractions : [];
  let total = 0;

  for (const it of arr) {
    const ymd = String((it as any).ymd ?? (it as any).day ?? (it as any).date ?? "")
      .slice(0, 10);

    // tenta reconhecer o total em campos comuns
    const maybeTotal =
      (it as any).total ??
      (it as any).totalInteractions ??
      (it as any).interactions ??
      (it as any).value ??
      // ou somatório de componentes comuns (caso exista)
      toFiniteNumber((it as any).likes ?? 0) +
        toFiniteNumber((it as any).comments ?? 0) +
        toFiniteNumber((it as any).saved ?? 0) +
        toFiniteNumber((it as any).shares ?? 0);

    // se não tem ymd (array já pode ser só do dia), soma mesmo
    if (!ymd || ymd === targetYmd) {
      total += toFiniteNumber(maybeTotal);
    }
  }

  return total;
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

  // ✅ desde 00:00 UTC
  const since = Math.floor(day.getTime() / 1000);
  // ✅ até 24h depois (padrão mais seguro no Graph)
  const until = since + 86400;

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
      // se você tiver accountType salvo, pode incluir aqui pra debug:
      // accountType: true,
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
      // 1) followers (Graph /{igUserId}?fields=followers_count)
      const profileRes = await graph.get(`/${igUserId}`, {
        params: { fields: "followers_count", access_token: accessToken },
      });
      const followers = toFiniteNumber(profileRes.data?.followers_count);

      // 2) profile views (Insights day)
      const profileViewsTotal = await fetchProfileViewsTotalForDay({
        graph,
        igUserId,
        accessToken,
        since,
        until,
      });

      // 3) reach (Insights day)
      const reach = await fetchReachForDay({
        graph,
        igUserId,
        accessToken,
        since,
        until,
      });

      // 4) interactions por posts (REAL)
      // ✅ novo contrato: fetchDailyInteractionsByPosts(graphClient, input)
      const dailyInteractions = await fetchDailyInteractionsByPosts(graph as any, {
        igUserId,
        accessToken,
        from: targetYmd,
        to: targetYmd,
      });

      const totalInteractions = sumTotalInteractionsForYmd(
        dailyInteractions,
        targetYmd
      );

      // 5) upsert no snapshot diário
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
      const reasonStr = extractGraphErrorMessage(e);
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
        } catch {
          // ignora
        }
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
