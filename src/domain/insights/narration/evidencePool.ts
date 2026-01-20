import type { PostInsightResult, ProvenItem } from "../PostInsightRules";

export function buildEvidencePool(result: PostInsightResult) {
  const pool = new Map<string, Set<string>>();

  const add = (label: string, value: unknown) => {
    const key = String(label ?? "").trim();
    if (!key) return;

    const vRaw = value as any;
    if (vRaw === null || vRaw === undefined) return;

    const v =
      typeof vRaw === "number" && Number.isFinite(vRaw)
        ? String(vRaw)
        : String(vRaw ?? "").trim();

    if (!v) return;

    if (!pool.has(key)) pool.set(key, new Set<string>());
    pool.get(key)!.add(v);
  };

  const scan = (items: ProvenItem[]) => {
    for (const it of items ?? []) {
      for (const m of it.evidence?.metrics ?? []) {
        add(m.label, m.value);
        if (m.baselineLabel) add(m.baselineLabel, m.baselineValue);
        if (typeof m.deltaPct === "number") add(`${m.label}.deltaPct`, m.deltaPct);
        if (typeof m.ratio === "number") add(`${m.label}.ratio`, m.ratio);
      }
    }
  };

  scan(result.why);
  scan(result.improve);
  scan(result.continue);

  add("reach_post", result.post.reach);
  add("likes_post", result.post.likes);
  add("comments_post", result.post.comments);
  add("interactions_post", result.post.interactions);
  add("saves_post", result.post.saves);
  add("shares_post", result.post.shares);
  add("published_hour", result.post.publishedHour);
  add("media_type", result.post.mediaType);
  add("caption_length", result.post.caption?.length ?? 0);
  add("has_cta", result.post.hasCTA ? "true" : "false");

  return pool;
}

export function validateEvidenceAgainstPool(
  evidence: Array<{ label: string; value: number | string }>,
  pool: Map<string, Set<string>>
) {
  for (const ev of evidence ?? []) {
    const label = String(ev?.label ?? "").trim();
    const value =
      typeof ev?.value === "number" && Number.isFinite(ev.value)
        ? String(ev.value)
        : String(ev?.value ?? "").trim();

    if (!label || !value) return false;

    const set = pool.get(label);
    if (!set) return false;
    if (!set.has(value)) return false;
  }
  return true;
}

export function pickEvidenceFromPool(
  pool: Map<string, Set<string>>,
  preferredLabels: string[],
  min = 2,
  max = 4
): Array<{ label: string; value: number | string }> {
  const out: Array<{ label: string; value: number | string }> = [];

  for (const lbl of preferredLabels) {
    const set = pool.get(lbl);
    if (!set || set.size === 0) continue;
    const first = Array.from(set)[0];
    out.push({ label: lbl, value: first });
    if (out.length >= max) break;
  }

  if (out.length < min) {
    for (const [lbl, set] of pool.entries()) {
      if (out.some((x) => x.label === lbl)) continue;
      const first = Array.from(set)[0];
      out.push({ label: lbl, value: first });
      if (out.length >= min) break;
    }
  }

  return out.slice(0, max);
}
