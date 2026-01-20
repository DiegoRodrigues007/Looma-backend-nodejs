// src/application/insights/PostInsightRulesService.ts
import { PostInsightRaw } from "./PostInsightDataService";

/* =========================
   Types
========================= */

export type EvidenceMetric = {
  label: string;
  value: number;
  baselineLabel?: string;
  baselineValue?: number;
  deltaPct?: number;
  ratio?: number;
};

export type ProvenItem = {
  key: string;
  section: "why" | "improve" | "continue";
  context: {
    mediaType?: string;
    publishedHour?: number;
    hasCTA?: boolean;
  };
  evidence: {
    metrics: EvidenceMetric[];
  };
  confidence: "high" | "medium" | "low";
};

export type PostInsightResult = {
  post: {
    id?: string;
    timestamp?: string;
    publishedHour: number;
    mediaType: string;
    caption: string;
    permalink?: string;

    reach: number;
    likes: number;
    comments: number;
    interactions: number;
    saves: number;
    shares: number;

    hasCTA: boolean;
  };
  baseline: {
    sampleSize: number;
  };
  why: ProvenItem[];
  improve: ProvenItem[];
  continue: ProvenItem[];
  missingData: string[];
};

/* =========================
   Utils
========================= */

const pct = (cur: number, base: number) =>
  base > 0 ? Number((((cur / base) - 1) * 100).toFixed(1)) : 0;

const ratio = (cur: number, base: number) =>
  base > 0 ? Number((cur / base).toFixed(2)) : 0;

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

function safeNum(n: any): number {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

/* =========================
   Service
========================= */

export class PostInsightRulesService {
  build(raw: PostInsightRaw): PostInsightResult {
    const { post, baseline } = raw;

    const why: ProvenItem[] = [];
    const improve: ProvenItem[] = [];
    const cont: ProvenItem[] = [];
    const missingData: string[] = [];

    const ctx = {
      mediaType: post.mediaType,
      publishedHour: post.publishedHour,
      hasCTA: post.hasCTA,
    };

    // --------
    // Métricas do post
    // --------
    const reach = safeNum(post.reach);
    const interactions = safeNum(post.interactions);
    const comments = safeNum(post.comments);
    const saves = safeNum(post.saves);

    const engagementRate = reach > 0 ? clamp01(interactions / reach) : 0; // 0..1 (% depois)

    // --------
    // Baseline (overall)
    // --------
    const overall = baseline.overall;

    const avgReach = safeNum(overall?.avgReach);
    const avgInteractions = safeNum(overall?.avgInteractions);

    // ✅ não existe avgEngagementRate no tipo — calculamos aqui de forma segura
    const avgEngagementRate = avgReach > 0 ? clamp01(avgInteractions / avgReach) : 0;

    // flags de baseline
    const hasAvgInteractions = avgInteractions > 0;
    const hasAvgReach = avgReach > 0;

    if (!hasAvgInteractions) missingData.push("missing_avg_interactions");
    if (!hasAvgReach) missingData.push("missing_avg_reach");

    /* =========================
       WHY – causas prováveis
    ========================= */

    // (1) Interações vs média
    if (hasAvgInteractions) {
      const r = ratio(interactions, avgInteractions);

      why.push({
        key: "why_interactions_vs_average",
        section: "why",
        context: ctx,
        evidence: {
          metrics: [
            {
              label: "interactions_post",
              value: interactions,
              baselineLabel: "avg_interactions",
              baselineValue: avgInteractions,
              deltaPct: pct(interactions, avgInteractions),
              ratio: r,
            },
          ],
        },
        confidence: r >= 1.2 ? "high" : r >= 0.85 ? "medium" : "low",
      });
    }

    // (2) Profundidade do engajamento abaixo do baseline (quando baseline existe)
    // Só faz sentido comparar se tiver avgReach e avgInteractions
    if (reach > 0 && hasAvgReach && hasAvgInteractions) {
      // compara % do post vs % média
      if (engagementRate + 1e-9 < avgEngagementRate) {
        const gap = avgEngagementRate - engagementRate;

        why.push({
          key: "why_low_engagement_depth",
          section: "why",
          context: ctx,
          evidence: {
            metrics: [
              {
                label: "engagement_rate",
                value: Number((engagementRate * 100).toFixed(2)),
                baselineLabel: "avg_engagement_rate",
                baselineValue: Number((avgEngagementRate * 100).toFixed(2)),
              },
            ],
          },
          confidence: gap >= 0.01 ? "medium" : "low", // gap >= 1pp => medium
        });
      }
    } else {
      // se reach=0 não dá pra calcular ER do post também
      if (reach <= 0) missingData.push("missing_reach_for_engagement_rate");
    }

    // (3) Conteúdo denso sem salvamentos
    const captionLen = post.caption?.length ?? 0;
    if (captionLen > 300 && saves === 0) {
      why.push({
        key: "why_no_saves_on_dense_content",
        section: "why",
        context: ctx,
        evidence: {
          metrics: [
            { label: "caption_length", value: captionLen },
            { label: "saves_post", value: saves },
          ],
        },
        confidence: captionLen >= 800 ? "high" : "medium",
      });
    }

    /* =========================
       IMPROVE – ações claras
    ========================= */

    // (1) Baixo engagement rate vs baseline * 0.8 (só se baseline existir)
    if (reach > 0 && hasAvgReach && hasAvgInteractions) {
      if (engagementRate < avgEngagementRate * 0.8) {
        improve.push({
          key: "improve_low_engagement_rate",
          section: "improve",
          context: ctx,
          evidence: {
            metrics: [
              {
                label: "engagement_rate",
                value: Number((engagementRate * 100).toFixed(2)),
                baselineLabel: "avg_engagement_rate",
                baselineValue: Number((avgEngagementRate * 100).toFixed(2)),
              },
            ],
          },
          confidence: "high",
        });
      }
    }

    // (2) Sem comentários
    if (comments === 0) {
      improve.push({
        key: "improve_no_comments",
        section: "improve",
        context: ctx,
        evidence: {
          metrics: [{ label: "comments_post", value: 0 }],
        },
        confidence: "medium",
      });
    }

    // (3) Sem CTA detectável
    if (!post.hasCTA) {
      improve.push({
        key: "improve_missing_cta",
        section: "improve",
        context: ctx,
        evidence: {
          metrics: [{ label: "has_cta", value: 0 }],
        },
        confidence: "medium",
      });
    }

    /* =========================
       CONTINUE – sinais positivos
    ========================= */

    if (reach > 0) {
      cont.push({
        key: "continue_reach_generated",
        section: "continue",
        context: ctx,
        evidence: {
          metrics: [{ label: "reach_post", value: reach }],
        },
        confidence: "medium",
      });
    }

    if (interactions > 0) {
      cont.push({
        key: "continue_interactions_generated",
        section: "continue",
        context: ctx,
        evidence: {
          metrics: [{ label: "interactions_post", value: interactions }],
        },
        confidence: interactions >= 10 ? "medium" : "low",
      });
    }

    // ✅ carrossel como sinal de formato “bom” (pode ser medium pq é fato objetivo)
    if (post.mediaType === "CAROUSEL_ALBUM") {
      cont.push({
        key: "continue_carousel_format",
        section: "continue",
        context: ctx,
        evidence: {
          metrics: [{ label: "media_type", value: 1 }],
        },
        confidence: "medium",
      });
    }

    /* =========================
       Garantias mínimas
    ========================= */

    if (!why.length) {
      why.push({
        key: "why_basic_visibility",
        section: "why",
        context: ctx,
        evidence: { metrics: [{ label: "reach_post", value: reach }] },
        confidence: "low",
      });
    }

    if (!improve.length) {
      improve.push({
        key: "improve_refine_message",
        section: "improve",
        context: ctx,
        evidence: { metrics: [{ label: "interactions_post", value: interactions }] },
        confidence: "low",
      });
    }

    if (!cont.length) {
      cont.push({
        key: "continue_consistency",
        section: "continue",
        context: ctx,
        evidence: { metrics: [{ label: "reach_post", value: reach }] },
        confidence: "low",
      });
    }

    return {
      post: {
        id: (post as any).id,
        timestamp: (post as any).timestamp,
        publishedHour: post.publishedHour,
        mediaType: post.mediaType,
        caption: post.caption,
        permalink: (post as any).permalink,

        reach,
        likes: safeNum(post.likes),
        comments,
        interactions,
        saves,
        shares: safeNum(post.shares),

        hasCTA: post.hasCTA,
      },
      baseline: {
        sampleSize: baseline.sampleSize,
      },
      why,
      improve,
      continue: cont,
      missingData,
    };
  }
}
