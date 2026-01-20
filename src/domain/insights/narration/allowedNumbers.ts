import type { PostInsightResult, ProvenItem } from "../PostInsightRules";
import { extractNumbers } from "./textGuards";

export function buildAllowedNumbers(result: PostInsightResult) {
  const allowed = new Set<string>();
  const p = result.post;

  const pushNum = (v: any) => {
    if (typeof v === "number" && Number.isFinite(v)) allowed.add(String(v));
    if (typeof v === "string") extractNumbers(v).forEach((x) => allowed.add(x));
  };

  [
    p.reach,
    p.likes,
    p.comments,
    p.interactions,
    p.saves,
    p.shares,
    p.publishedHour,
    result.baseline?.sampleSize,
    p.caption?.length ?? 0,
  ].forEach(pushNum);

  const scan = (items: ProvenItem[]) => {
    for (const it of items ?? []) {
      for (const m of it.evidence?.metrics ?? []) {
        [m.value, m.baselineValue, m.deltaPct, m.ratio].forEach(pushNum);
      }
    }
  };

  scan(result.why);
  scan(result.improve);
  scan(result.continue);

  if (p.reach > 0) {
    const er = (p.interactions / p.reach) * 100;
    pushNum(Number(er.toFixed(2)));
    pushNum(Number(er.toFixed(1)));
    pushNum(Number(er.toFixed(0)));
  }

  return allowed;
}
