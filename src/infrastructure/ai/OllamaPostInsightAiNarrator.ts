import { OllamaClient } from "./OllamaClient";
import { env } from "../config/env";

import type { IAiNarrator } from "../../application/ports/ai/IAiNarrator";
import type { Narrated, NarratedItem } from "../../shared/types/Narrated";

import type { PostInsightResult } from "../../domain/insights/PostInsightRules";

import { fallbackNarrator } from "../../domain/insights/narration/fallbackNarrator";
import { pickBest, pickTop, compactItem } from "../../domain/insights/narration/rulesPicking";
import {
  buildEvidencePool,
  pickEvidenceFromPool,
  validateEvidenceAgainstPool,
} from "../../domain/insights/narration/evidencePool";
import { buildAllowedNumbers } from "../../domain/insights/narration/allowedNumbers";
import {
  clean,
  safeConfidence,
  hasForbiddenNumbers,
  stripForbiddenNumbers,
} from "../../domain/insights/narration/textGuards";

export class OllamaPostInsightAiNarrator
  implements IAiNarrator<PostInsightResult, Narrated>
{
  private readonly enabled = env.ollama.enabled;

  private readonly timeoutMs = Number(process.env.OLLAMA_REQUEST_TIMEOUT_MS ?? 6500);
  private readonly numPredict = Number(process.env.OLLAMA_NUM_PREDICT ?? 110);

  constructor(private readonly ollama = new OllamaClient()) {}

  async narrate(result: PostInsightResult): Promise<Narrated> {
    if (!this.enabled) return fallbackNarrator(result) as any;

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
        retries: 0,
      });
    } catch {
      return fallbackNarrator(result) as any;
    }

    const whyArr = Array.isArray(out?.why) ? out.why : [];
    const improveArr = Array.isArray(out?.improve) ? out.improve : [];
    const continueArr = Array.isArray(out?.continue) ? out.continue : [];

    if (!whyArr.length || !improveArr.length || !continueArr.length) {
      return fallbackNarrator(result) as any;
    }

    const preferredEvidenceBySection: Record<
      "why" | "improve" | "continue",
      string[]
    > = {
      why: ["interactions_post", "reach_post", "comments_post", "saves_post", "caption_length"],
      improve: ["comments_post", "saves_post", "interactions_post", "reach_post", "has_cta"],
      continue: ["reach_post", "media_type", "published_hour", "interactions_post"],
    };

    const enforceSeparation = (item: NarratedItem): NarratedItem => {
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
          mapItem(
            "continue",
            continueArr[0],
            "O que continuar fazendo",
            bestContinue?.confidence
          ),
        ],
      };
    } catch {
      return fallbackNarrator(result) as any;
    }
  }
}

function buildPrompt(payload: any, allowedLabels: string[], exampleEvidence: any) {
  return `
Responda SOMENTE com JSON válido (sem markdown, sem texto fora do JSON).
Idioma: PT-BR.
Você é um analista de performance de posts (Instagram).

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

DADOS:
${JSON.stringify(payload, null, 2)}
`.trim();
}
