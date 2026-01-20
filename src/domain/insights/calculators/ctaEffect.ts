export type CtaEffectStats = {
  withCTA: {
    sample: number;
    avgComments: number;
    avgSaves: number;
    avgInteractions: number;
  };
  withoutCTA: {
    sample: number;
    avgComments: number;
    avgSaves: number;
    avgInteractions: number;
  };
};

function avg(values: number[]): number {
  const valid = values.filter((v) => Number.isFinite(v));
  if (!valid.length) return 0;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

const CTA_ACTION_REGEX =
  /\b(comente|comenta|salve|salva|envie|enviar|manda|mandar|compartilhe|compartilha|responda|responde|vote|clique|me chama|me diz|me diga)\b/i;

function norm(s: string) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/#/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function hasCTAFromCaption(rawCaption: string): boolean {
  const caption = String(rawCaption ?? "");
  if (!caption.trim()) return false;

  const lines = caption
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const last = norm(lines[lines.length - 1] ?? "");
  const last2 = norm(lines[lines.length - 2] ?? "");
  const tail = norm(lines.slice(-3).join(" ")); 

  if (/[?]$/.test(last) || /[?]$/.test(last2)) return true;

  if (CTA_ACTION_REGEX.test(tail)) return true;

  if (/(comenta aqui|comenta embaixo|comenta abaixo|me diz|me diga|responde aqui)/.test(tail)) return true;
  if (/(salva (pra|para)|salve (pra|para)|guarda (pra|para))/.test(tail)) return true;
  if (/(manda|envia) (pra|para)/.test(tail)) return true;

  if (tail.includes("👇") && CTA_ACTION_REGEX.test(tail)) return true;

  return false;
}

export type CtaEffectInputItem = {
  hasCTA: boolean;
  comments: number;
  saves: number;
  interactions: number;
};

export function computeCtaEffect(items: CtaEffectInputItem[]): CtaEffectStats {
  const withCTA = (items ?? []).filter(((x) => x.hasCTA));
  const withoutCTA = (items ?? []).filter((x) => !x.hasCTA);

  return {
    withCTA: {
      sample: withCTA.length,
      avgComments: avg(withCTA.map((x) => x.comments)),
      avgSaves: avg(withCTA.map((x) => x.saves)),
      avgInteractions: avg(withCTA.map((x) => x.interactions)),
    },
    withoutCTA: {
      sample: withoutCTA.length,
      avgComments: avg(withoutCTA.map((x) => x.comments)),
      avgSaves: avg(withoutCTA.map((x) => x.saves)),
      avgInteractions: avg(withoutCTA.map((x) => x.interactions)),
    },
  };
}
