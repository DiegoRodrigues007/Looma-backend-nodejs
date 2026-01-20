import type { ProvenItem, EvidenceMetric } from "../PostInsightRules";

function confScore(c: ProvenItem["confidence"]) {
  return c === "high" ? 3 : c === "medium" ? 2 : 1;
}

const KEY_PRIORITY: Record<string, number> = {
  why_no_saves_on_dense_content: 100,
  why_low_engagement_depth: 90,
  why_interactions_vs_average: 80,

  improve_low_engagement_rate: 100,
  improve_no_comments: 90,
  improve_missing_cta: 80,

  continue_reach_generated: 90,
  continue_interactions_generated: 80,
  continue_carousel_format: 70,
};

function itemPriority(key?: string) {
  if (!key) return 0;
  return KEY_PRIORITY[key] ?? 0;
}

export function pickBest(items: ProvenItem[] | undefined): ProvenItem | undefined {
  const arr = items ?? [];
  if (!arr.length) return undefined;

  return arr
    .slice()
    .sort((a, b) => {
      const pa = itemPriority(a.key);
      const pb = itemPriority(b.key);
      if (pb !== pa) return pb - pa;

      const ca = confScore(a.confidence);
      const cb = confScore(b.confidence);
      if (cb !== ca) return cb - ca;

      return 0;
    })[0];
}

export function pickTop(items: ProvenItem[], n: number) {
  return (items ?? []).slice(0, n);
}

function compactMetric(m: EvidenceMetric) {
  const out: any = { label: m.label, value: m.value };
  if (m.baselineLabel) out.baselineLabel = m.baselineLabel;
  if (typeof m.baselineValue === "number") out.baselineValue = m.baselineValue;
  if (typeof m.deltaPct === "number") out.deltaPct = m.deltaPct;
  if (typeof m.ratio === "number") out.ratio = m.ratio;
  return out;
}

export function compactItem(it: ProvenItem) {
  return {
    key: it.key,
    section: it.section,
    confidence: it.confidence,
    context: it.context ?? {},
    evidence: { metrics: (it.evidence?.metrics ?? []).map(compactMetric) },
  };
}
