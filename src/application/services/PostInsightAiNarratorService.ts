// src/application/insights/PostInsightAiNarratorService.ts
import { OllamaClient } from "../../infrastructure/ai/OllamaClient";
import { env } from "../../infrastructure/config/env";
import type {
  PostInsightResult,
  ProvenItem,
  EvidenceMetric,
} from "./PostInsightRulesService";

export type NarratedItem = {
  headline: string;
  text: string;
  action: string;
  confidence: "low" | "medium" | "high";
  evidence: Array<{ label: string; value: number | string }>;
};

export type Narrated = {
  why: NarratedItem[];
  improve: NarratedItem[];
  continue: NarratedItem[];
};

/* =========================
   Helpers
========================= */

function clean(s: unknown, max = 520): string {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

function extractNumbers(text: string) {
  return text.match(/\b\d+(\.\d+)?\b/g) ?? [];
}

function hasForbiddenNumbers(text: string, allowed: Set<string>) {
  for (const n of extractNumbers(text)) {
    if (!allowed.has(n)) return true;
  }
  return false;
}

function stripForbiddenNumbers(text: string, allowed: Set<string>) {
  // remove números não permitidos e limpa espaços extras
  const out = String(text ?? "").replace(/\b\d+(\.\d+)?\b/g, (m) =>
    allowed.has(m) ? m : ""
  );
  return clean(out, 520);
}

function safeConfidence(x: any): "low" | "medium" | "high" {
  const c = String(x ?? "").trim().toLowerCase();
  return c === "high" || c === "low" || c === "medium" ? (c as any) : "medium";
}

function confScore(c: ProvenItem["confidence"]) {
  return c === "high" ? 3 : c === "medium" ? 2 : 1;
}

/**
 * Prioridade de keys (mais específicas primeiro)
 */
const KEY_PRIORITY: Record<string, number> = {
  // WHY
  why_no_saves_on_dense_content: 100,
  why_low_engagement_depth: 90,
  why_interactions_vs_average: 80,

  // IMPROVE
  improve_low_engagement_rate: 100,
  improve_no_comments: 90,
  improve_missing_cta: 80,

  // CONTINUE
  continue_reach_generated: 90,
  continue_interactions_generated: 80,
  continue_carousel_format: 70,
};

function itemPriority(key?: string) {
  if (!key) return 0;
  return KEY_PRIORITY[key] ?? 0;
}

function pickBest(items: ProvenItem[] | undefined): ProvenItem | undefined {
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

function pickTop(items: ProvenItem[], n: number) {
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

function compactItem(it: ProvenItem) {
  return {
    key: it.key,
    section: it.section,
    confidence: it.confidence,
    context: it.context ?? {},
    evidence: { metrics: (it.evidence?.metrics ?? []).map(compactMetric) },
  };
}

/**
 * pool: label -> set(values) (tudo string)
 */
function buildEvidencePool(result: PostInsightResult) {
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

  return pool;
}

function validateEvidenceAgainstPool(
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

function pickEvidenceFromPool(
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

function enforceSeparation(item: NarratedItem): NarratedItem {
  const t = clean(item.text, 520);
  let a = clean(item.action, 260);

  if (!a) {
    a =
      "Aplique esse ajuste no próximo post e compare comentários, salvamentos e interações nas primeiras 2 horas.";
  }

  if (t && a && t.toLowerCase() === a.toLowerCase()) {
    a =
      "Faça um teste A/B: uma versão com pergunta direta no final e outra com incentivo explícito de salvamento.";
  }

  return { ...item, text: t, action: a };
}

function buildAllowedNumbers(result: PostInsightResult) {
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

/* =========================
   Smarter deterministic fallback (usa as RULES!)
========================= */

function narrativeFromKey(
  section: "why" | "improve" | "continue",
  key: string,
  result: PostInsightResult
): { headline: string; text: string; action: string } {
  const p = result.post;

  if (section === "why") {
    if (key === "why_no_saves_on_dense_content") {
      return {
        headline: "Por que isso aconteceu",
        text: `A legenda é densa (${p.caption.length} caracteres), mas teve 0 salvamentos. Isso sugere consumo, mas sem um motivo claro para “guardar”.`,
        action:
          "Transforme em checklist explícito: termine com “Salve para consultar depois” e destaque 1 promessa prática (ex.: 3 passos) na primeira/última página.",
      };
    }

    if (key === "why_low_engagement_depth") {
      const er =
        p.reach > 0 ? Number((((p.interactions / p.reach) * 100).toFixed(2))) : 0;
      return {
        headline: "Por que isso aconteceu",
        text: `Alcance ${p.reach} com engajamento proporcional baixo (${er}%). Indica atenção rápida, mas pouca ação (comentar/salvar).`,
        action:
          "Adicione um gancho de resposta simples (A/B) e uma promessa prática que incentive salvar (ex.: “modelo pronto” / “lista para copiar”).",
      };
    }

    if (key === "why_interactions_vs_average") {
      return {
        headline: "Por que isso aconteceu",
        text: `Este post teve ${p.interactions} interações e ficou diferente do padrão do perfil (ver evidências). Isso costuma acontecer quando falta um “pedido” claro no final.`,
        action:
          "Inclua 1 CTA direto no fim: pergunta A/B OU “qual você usa hoje?” (uma linha).",
      };
    }

    return {
      headline: "Por que isso aconteceu",
      text: `Com alcance ${p.reach} e ${p.interactions} interações, a reação foi mais de consumo rápido do que ações profundas (comentários/salvamentos).`,
      action:
        "Reforce o gancho final com uma pergunta simples e incentive o salvamento com uma promessa clara (checklist/roteiro).",
    };
  }

  if (section === "improve") {
    if (key === "improve_no_comments") {
      return {
        headline: "Como melhorar",
        text: "Hoje foram 0 comentários: faltou um gatilho de conversa. Sem pergunta clara, a audiência tende a curtir e sair.",
        action:
          "Use uma pergunta de resposta curta (A/B ou 1 palavra) e peça explicitamente: “Comenta A ou B”.",
      };
    }

    if (key === "improve_missing_cta") {
      return {
        headline: "Como melhorar",
        text: "O post não tem CTA explícito. Sem direção, a audiência consome mas não executa uma ação (comentar/salvar).",
        action:
          "Escolha 1 CTA por post: ou “Comenta X”, ou “Salve para usar depois”. Coloque na última linha e na última página do carrossel.",
      };
    }

    if (key === "improve_low_engagement_rate") {
      return {
        headline: "Como melhorar",
        text: "A taxa de engajamento ficou baixa nas evidências. Isso melhora quando o post entrega valor “utilizável” (checklist, modelo, exemplo).",
        action:
          "Converta para formato prático: 3 bullets + 1 exemplo. Termine com “salve para consultar depois”.",
      };
    }

    return {
      headline: "Como melhorar",
      text: "Aumente ações profundas (comentários/salvamentos) com um CTA e uma promessa mais prática.",
      action:
        "Teste A/B: (1) pergunta direta; (2) incentivo de salvamento com promessa clara. Compare em 2 horas.",
    };
  }

  if (section === "continue") {
    if (key === "continue_carousel_format") {
      return {
        headline: "O que continuar fazendo",
        text: "O carrossel ajuda a organizar a mensagem em passos e segurar atenção.",
        action:
          "Mantenha a estrutura em “passos” e adicione uma última página com resumo + CTA.",
      };
    }

    if (key === "continue_reach_generated") {
      return {
        headline: "O que continuar fazendo",
        text: `O conteúdo gerou alcance (${p.reach}). O tema e clareza estão chamando atenção suficiente para distribuir.`,
        action:
          "Continue no mesmo tema, mas refine o final com CTA único para converter esse alcance em comentários/salvamentos.",
      };
    }

    if (key === "continue_interactions_generated") {
      return {
        headline: "O que continuar fazendo",
        text: `Houve ${p.interactions} interações — sinal de que a mensagem está compreensível e gera reação.`,
        action:
          "Mantenha o estilo e teste um CTA de conversa (A/B) para aumentar comentários sem mudar o conteúdo-base.",
      };
    }

    return {
      headline: "O que continuar fazendo",
      text: `Mantenha o tema e a clareza; isso já está trazendo alcance (${p.reach}).`,
      action: "Ajuste apenas o CTA/última página para gerar mais comentários e salvamentos.",
    };
  }

  return {
    headline: "Insight",
    text: "Resumo baseado nas métricas do post.",
    action: "Faça um pequeno ajuste e compare os resultados.",
  };
}

function smartFallback(result: PostInsightResult): Narrated {
  const pool = buildEvidencePool(result);

  const bestWhy = pickBest(result.why);
  const bestImprove = pickBest(result.improve);
  const bestContinue = pickBest(result.continue);

  const whyKey = bestWhy?.key ?? "why_basic";
  const improveKey = bestImprove?.key ?? "improve_basic";
  const continueKey = bestContinue?.key ?? "continue_basic";

  const whyTpl = narrativeFromKey("why", whyKey, result);
  const improveTpl = narrativeFromKey("improve", improveKey, result);
  const continueTpl = narrativeFromKey("continue", continueKey, result);

  const whyItem: NarratedItem = {
    headline: whyTpl.headline,
    text: clean(whyTpl.text, 520),
    action: clean(whyTpl.action, 260),
    confidence: bestWhy?.confidence ?? "low",
    evidence: pickEvidenceFromPool(
      pool,
      ["interactions_post", "reach_post", "comments_post", "saves_post", "caption_length"],
      2,
      4
    ),
  };

  const improveItem: NarratedItem = {
    headline: improveTpl.headline,
    text: clean(improveTpl.text, 520),
    action: clean(improveTpl.action, 260),
    confidence: bestImprove?.confidence ?? "low",
    evidence: pickEvidenceFromPool(
      pool,
      ["comments_post", "saves_post", "interactions_post", "reach_post", "has_cta"],
      2,
      4
    ),
  };

  const continueItem: NarratedItem = {
    headline: continueTpl.headline,
    text: clean(continueTpl.text, 520),
    action: clean(continueTpl.action, 260),
    confidence: bestContinue?.confidence ?? "low",
    evidence: pickEvidenceFromPool(pool, ["reach_post", "media_type", "published_hour"], 2, 4),
  };

  return {
    why: [enforceSeparation(whyItem)],
    improve: [enforceSeparation(improveItem)],
    continue: [enforceSeparation(continueItem)],
  };
}

/* =========================
   Prompt
========================= */

function buildPrompt(payload: any, allowedLabels: string[], exampleEvidence: any) {
  return `
Responda SOMENTE com JSON válido (sem markdown, sem texto fora do JSON).
Idioma: PT-BR.
Você é um analista de performance de posts (Instagram).

OBJETIVO:
Gerar "Por que", "Como melhorar" e "O que continuar" usando:
- métricas do post (post.*)
- evidências fornecidas (insights.*.evidence.metrics)

INFERÊNCIA CONTROLADA (permitido):
- Boas práticas gerais (CTA, pergunta A/B, incentivo de salvamento, resumo final).
- NÃO invente fatos específicos do contexto se isso não estiver nos dados.

FORMATO EXATO (JSON):
{
  "why": [
    { "headline": "...", "text": "...", "action": "...", "confidence": "low|medium|high", "evidence": [{"label":"...","value":"..."}] }
  ],
  "improve": [
    { "headline": "...", "text": "...", "action": "...", "confidence": "low|medium|high", "evidence": [{"label":"...","value":"..."}] }
  ],
  "continue": [
    { "headline": "...", "text": "...", "action": "...", "confidence": "low|medium|high", "evidence": [{"label":"...","value":"..."}] }
  ]
}

REGRAS CRÍTICAS:
- Retorne 1 item por seção (why/improve/continue).
- Evidence deve ter 2 a 4 pares (label/value) COPIADOS do payload.
- Você só pode usar labels desta lista (copie exatamente): ${allowedLabels.join(", ")}.
- Exemplo de evidence válida: ${JSON.stringify(exampleEvidence)}.
- O "text" deve citar explicitamente 1 ou 2 métricas (número real do payload).
- "text" explica o porquê; "action" é um passo prático DIFERENTE do text.
- Não fale sobre estatística/tamanho de amostra.

DADOS:
${JSON.stringify(payload, null, 2)}
`.trim();
}

/* =========================
   Service (FAST TOOLTIP)
========================= */

export class PostInsightAiNarratorService {
  private readonly enabled = env.ollama.enabled;

  // ✅ defaults agressivos pro tooltip (rápido)
  private readonly timeoutMs = Number(process.env.OLLAMA_REQUEST_TIMEOUT_MS ?? 6500);
  private readonly numPredict = Number(process.env.OLLAMA_NUM_PREDICT ?? 110);

  constructor(private readonly ollama = new OllamaClient()) {}

  async narrate(result: PostInsightResult): Promise<Narrated> {
    // ✅ nunca joga erro pro tooltip
    if (!this.enabled) return smartFallback(result);

    // ✅ NÃO faz warmup aqui (warmup atrasa tooltip)
    // Se você quiser warmup, faça em boot do servidor, não no request.

    const bestWhy = pickBest(result.why);
    const bestImprove = pickBest(result.improve);
    const bestContinue = pickBest(result.continue);

    const payload = {
      post: {
        id: result.post.id,
        mediaType: result.post.mediaType,
        publishedHour: result.post.publishedHour,
        caption: clean(result.post.caption, 420),
        reach: result.post.reach,
        likes: result.post.likes,
        comments: result.post.comments,
        interactions: result.post.interactions,
        saves: result.post.saves,
        shares: result.post.shares,
        hasCTA: result.post.hasCTA,
      },
      baseline: { sampleSize: result.baseline?.sampleSize ?? 0 },
      insights: {
        primary: {
          why: bestWhy ? compactItem(bestWhy) : null,
          improve: bestImprove ? compactItem(bestImprove) : null,
          continue: bestContinue ? compactItem(bestContinue) : null,
        },
        why: pickTop(result.why, 3).map(compactItem),
        improve: pickTop(result.improve, 3).map(compactItem),
        continue: pickTop(result.continue, 3).map(compactItem),
      },
      missingData: result.missingData ?? [],
    };

    const allowedNumbers = buildAllowedNumbers(result);
    const evidencePool = buildEvidencePool(result);

    const allowedLabels = Array.from(evidencePool.keys()).sort();
    const exampleEvidence = pickEvidenceFromPool(
      evidencePool,
      ["interactions_post", "reach_post", "comments_post", "saves_post"],
      2,
      4
    );

    const prompt = buildPrompt(payload, allowedLabels, exampleEvidence);

    let out: any;
    try {
      out = await this.ollama.generateJson<any>({
        prompt,
        timeoutMs: this.timeoutMs,
        options: {
          temperature: 0.2,
          top_p: 0.9,
          num_predict: this.numPredict,
          stop: ["```"],
        },
        // ✅ retry 0: tooltip não pode esperar retry
        retries: 0,
      });
    } catch {
      return smartFallback(result);
    }

    const whyArr = Array.isArray(out?.why) ? out.why : [];
    const improveArr = Array.isArray(out?.improve) ? out.improve : [];
    const continueArr = Array.isArray(out?.continue) ? out.continue : [];

    if (!whyArr.length || !improveArr.length || !continueArr.length) {
      return smartFallback(result);
    }

    const preferredEvidenceBySection: Record<"why" | "improve" | "continue", string[]> = {
      why: ["interactions_post", "reach_post", "comments_post", "saves_post", "caption_length"],
      improve: ["comments_post", "saves_post", "interactions_post", "reach_post", "has_cta"],
      continue: ["reach_post", "media_type", "published_hour", "interactions_post"],
    };

    const mapItem = (
      section: "why" | "improve" | "continue",
      x: any,
      fallbackHeadline: string,
      ruleConfidence?: "low" | "medium" | "high"
    ): NarratedItem => {
      const headline = clean(x?.headline || fallbackHeadline, 80) || fallbackHeadline;

      let text = clean(x?.text, 520);
      let action = clean(x?.action, 260);

      if (!text) text = "Resumo baseado nas métricas do post.";
      if (!action) action = "Faça um ajuste simples no próximo post e compare os resultados.";

      const evidenceRaw = Array.isArray(x?.evidence) ? x.evidence : [];
      let normalizedEvidence = evidenceRaw
        .slice(0, 4)
        .map((ev: any) => {
          const label = String(ev?.label ?? "").trim();
          const valueRaw =
            typeof ev?.value === "number" && Number.isFinite(ev.value)
              ? String(ev.value)
              : String(ev?.value ?? "").trim();
          return { label, value: valueRaw };
        })
        .filter((ev: any) => ev.label && ev.value !== "");

      if (
        normalizedEvidence.length < 2 ||
        !validateEvidenceAgainstPool(normalizedEvidence as any, evidencePool)
      ) {
        normalizedEvidence = pickEvidenceFromPool(
          evidencePool,
          preferredEvidenceBySection[section],
          2,
          4
        ).map((ev) => ({
          label: String(ev.label),
          value: String(ev.value),
        }));
      }

      const merged = `${headline} ${text} ${action}`;
      if (hasForbiddenNumbers(merged, allowedNumbers)) {
        text = stripForbiddenNumbers(text, allowedNumbers);
        action = stripForbiddenNumbers(action, allowedNumbers);
      }

      const aiConf = safeConfidence(x?.confidence);
      const confidence = ruleConfidence ?? aiConf;

      return enforceSeparation({
        headline,
        text,
        action,
        confidence,
        evidence: normalizedEvidence as any,
      });
    };

    try {
      return {
        why: [mapItem("why", whyArr[0], "Por que isso aconteceu", bestWhy?.confidence)],
        improve: [mapItem("improve", improveArr[0], "Como melhorar", bestImprove?.confidence)],
        continue: [
          mapItem("continue", continueArr[0], "O que continuar fazendo", bestContinue?.confidence),
        ],
      };
    } catch {
      return smartFallback(result);
    }
  }
}
