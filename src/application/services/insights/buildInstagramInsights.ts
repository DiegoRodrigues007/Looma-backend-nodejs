// src/application/services/insights/buildInstagramInsights.ts

import type {
  Insight,
  BuildInstagramInsightsInput,
  BuildInstagramInsightsResult,
} from "../../../shared/types/insights/types";

import { baselineEngine } from "./engines/baselineEngine";
import { postingTimeEngine } from "./engines/postingTimeEngine";
import { contentTypeEngine } from "./engines/contentTypeEngine";
import { frequencyEngine } from "./engines/frequencyEngine";
import { predictionEngine } from "./engines/predictionEngine";

function isValidYmd(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? "").trim());
}

function parseYmdToUtcStart(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

export async function buildInstagramInsights(
  input: BuildInstagramInsightsInput
): Promise<BuildInstagramInsightsResult> {
  const userId = String(input.userId ?? "").trim();
  const instagramAccountId = String(input.instagramAccountId ?? "").trim();
  const from = String(input.from ?? "").trim();
  const to = String(input.to ?? "").trim();

  if (!userId) throw new Error("buildInstagramInsights: userId is required");
  if (!instagramAccountId)
    throw new Error("buildInstagramInsights: instagramAccountId is required");

  if (!isValidYmd(from) || !isValidYmd(to)) {
    throw new Error("buildInstagramInsights: from/to must be YYYY-MM-DD");
  }

  const fromStart = parseYmdToUtcStart(from);
  const toStart = parseYmdToUtcStart(to);

  if (fromStart.getTime() > toStart.getTime()) {
    throw new Error("buildInstagramInsights: from cannot be > to");
  }

  // max 30 dias (inclusive)
  const days =
    Math.floor((toStart.getTime() - fromStart.getTime()) / 86400000) + 1;
  if (days > 30) throw new Error("buildInstagramInsights: max range is 30 days");

  const baselineDays = Number.isFinite(Number(input.baselineDays))
    ? Number(input.baselineDays)
    : 60;

  const maxInsights = Number.isFinite(Number(input.maxInsights))
    ? Number(input.maxInsights)
    : 6;

  const engineResults: { insights: Insight[]; debug: Record<string, any> }[] = [];

  // ✅ Engine 1: Baseline
  engineResults.push(
    await baselineEngine({
      userId,
      instagramAccountId,
      from,
      to,
      baselineDays,
    })
  );

  // ✅ Engine 2: Horário de postagem (driver)
  engineResults.push(
    await postingTimeEngine({
      userId,
      instagramAccountId,
      from,
      to,
    })
  );

  // ✅ Engine 3: Tipo de conteúdo (reels/feed/carrossel)
  engineResults.push(
    await contentTypeEngine({
      userId,
      instagramAccountId,
      from,
      to,
    })
  );

  // ✅ Engine 4: Frequência (posts/dia)
  engineResults.push(
    await frequencyEngine({
      userId,
      instagramAccountId,
      from,
      to,
    })
  );

  engineResults.push(
    await predictionEngine({
      userId,
      instagramAccountId,
      to,
      lookbackDays: 14,
      horizonDays: 7,
    })
  );

  const insights = engineResults.flatMap((r) => r.insights);
  insights.sort((a, b) => b.confidence - a.confidence);

  const top = insights.slice(0, Math.max(0, maxInsights));

  const debug: Record<string, any> = {
    computedAt: new Date().toISOString(),
    engines: engineResults.map((r, i) => ({
      index: i,
      ...r.debug,
    })),
  };

  return {
    range: { from, to, days },
    insights: top,
    debug,
  };
}
