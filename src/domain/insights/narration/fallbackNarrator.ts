import type { PostInsightResult } from "../PostInsightRules";
import type { Narrated, NarratedItem } from "../../../shared/types/narration/types";

import { clean } from "./textGuards";
import { pickBest } from "./rulesPicking";
import { buildEvidencePool, pickEvidenceFromPool } from "./evidencePool";

function enforceSeparation(item: NarratedItem): NarratedItem {
  const t = clean(item.text, 520);
  let a = clean(item.action, 260);

  if (!a) {
    a = "Aplique esse ajuste no próximo post e compare comentários, salvamentos e interações nas primeiras 2 horas.";
  }

  if (t && a && t.toLowerCase() === a.toLowerCase()) {
    a = "Faça um teste A/B: uma versão com pergunta direta no final e outra com incentivo explícito de salvamento.";
  }

  return { ...item, text: t, action: a };
}

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
        action: "Inclua 1 CTA direto no fim: pergunta A/B OU “qual você usa hoje?” (uma linha).",
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
        action: "Use uma pergunta de resposta curta (A/B ou 1 palavra) e peça explicitamente: “Comenta A ou B”.",
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
        action: "Mantenha a estrutura em “passos” e adicione uma última página com resumo + CTA.",
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

export function fallbackNarrator(result: PostInsightResult): Narrated {
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
    evidence: pickEvidenceFromPool(
      pool,
      ["reach_post", "media_type", "published_hour"],
      2,
      4
    ),
  };

  return {
    why: [enforceSeparation(whyItem)],
    improve: [enforceSeparation(improveItem)],
    continue: [enforceSeparation(continueItem)],
  };
}
