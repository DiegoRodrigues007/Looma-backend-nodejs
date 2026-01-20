// src/application/insights/PostInsightDataService.ts
import {
  InstagramPostInsightsService,
  IgMediaWithInsights,
} from "../../../infrastructure/instagram/services/InstagramPostInsightsService";

export type BaselineStats = {
  overall: {
    avgReach: number;
    avgLikes: number;
    avgComments: number;
    avgInteractions: number;
    avgSaves: number;
    avgShares: number;
  };

  byHourWindow: Array<{
    label: string;
    fromHour: number;
    toHour: number;
    sample: number;
    avgReach: number;
  }>;

  byMediaType: Array<{
    mediaType: string;
    sample: number;
    avgReach: number;
    avgInteractions: number;
  }>;

  ctaEffect: {
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

  sampleSize: number;
};

export type PostInsightRaw = {
  post: {
    id: string;
    timestamp: string;

    /**
     * Hora local (BR) do post. Isso bate com “Publicado às 03:01”
     * e evita confundir o usuário com UTC.
     */
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

  baseline: BaselineStats;
};

/**
 * ✅ CTA DETECTOR (mais restrito, reduz falso positivo)
 * Regras:
 * - pergunta com "?" na ÚLTIMA linha ou no final
 * - ou verbos de ação claros, perto de "👇" / "comenta" / "salva" etc.
 * - ou padrões de "comenta aqui" / "me diz" / "responde"
 *
 * Obs: ainda é heurística. Para 100% você poderia usar NLP/IA depois,
 * mas isso resolve a maioria dos falsos positivos sem perder recall.
 */
const CTA_ACTION_REGEX =
  /\b(comente|comenta|salve|salva|envie|enviar|manda|mandar|compartilhe|compartilha|responda|responde|vote|clique|me chama|me diz|me diga)\b/i;

function safeNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function avg(values: number[]) {
  const valid = values.filter((v) => Number.isFinite(v));
  if (!valid.length) return 0;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

/** Remove acentos e normaliza espaços */
function norm(s: string) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/#/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * CTA detect: mais preciso (olha últimas linhas e padrões)
 */
function hasCTAFromCaption(rawCaption: string): boolean {
  const caption = String(rawCaption ?? "");
  if (!caption.trim()) return false;

  const lines = caption
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const last = norm(lines[lines.length - 1] ?? "");
  const last2 = norm(lines[lines.length - 2] ?? "");
  const tail = norm(lines.slice(-3).join(" ")); // últimas ~3 linhas (onde CTA costuma estar)

  // pergunta no final (ou na penúltima) costuma ser CTA
  if (/[?]$/.test(last) || /[?]$/.test(last2)) return true;

  // padrões explícitos no "tail"
  if (CTA_ACTION_REGEX.test(tail)) return true;

  // combos muito comuns
  if (/(comenta aqui|comenta embaixo|comenta abaixo|me diz|me diga|responde aqui)/.test(tail)) return true;
  if (/(salva (pra|para)|salve (pra|para)|guarda (pra|para))/.test(tail)) return true;
  if (/(manda|envia) (pra|para)/.test(tail)) return true;

  // emoji indicador e verbo (👇 + ação)
  if (tail.includes("👇") && CTA_ACTION_REGEX.test(tail)) return true;

  return false;
}

/**
 * ✅ Hora local em America/Sao_Paulo
 */
function hourLocalSaoPaulo(iso: string) {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(d);

  const hh = parts.find((p) => p.type === "hour")?.value ?? "0";
  const n = Number(hh);
  return Number.isFinite(n) ? n : 0;
}

/**
 * ✅ Data (YYYY-MM-DD) na TZ de São Paulo
 * Isso evita "cortar" posts errados quando você usa UTC.
 */
function ymdSaoPaulo(d: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);

  const yyyy = parts.find((p) => p.type === "year")?.value ?? "1970";
  const mm = parts.find((p) => p.type === "month")?.value ?? "01";
  const dd = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * ✅ Date "agora" mas normalizado para início do dia (00:00) em São Paulo
 */
function startOfTodaySaoPaulo(): Date {
  // pegamos "agora" e extraímos ymd em SP, depois reconstruímos uma Date UTC estável
  const now = new Date();
  const ymd = ymdSaoPaulo(now);
  // construindo em UTC evita offsets malucos, mas o "dia" é o de SP
  return new Date(`${ymd}T00:00:00.000Z`);
}

function daysAgoSaoPaulo(days: number) {
  const today = startOfTodaySaoPaulo();
  const d = new Date(today);
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

/**
 * ✅ Dedup por id
 */
function dedupById(items: IgMediaWithInsights[]) {
  const map = new Map<string, IgMediaWithInsights>();
  for (const m of items ?? []) map.set(String((m as any).id), m);
  return Array.from(map.values());
}

/**
 * ✅ Remove o post atual do baseline (evita vazamento do mesmo post)
 */
function removeCurrentPost(items: IgMediaWithInsights[], postId: string) {
  const pid = String(postId);
  return (items ?? []).filter((m) => String((m as any).id) !== pid);
}

export class PostInsightDataService {
  constructor(
    private readonly igPostService = new InstagramPostInsightsService()
  ) {}

  async build(params: {
    accessToken: string;
    igUserId: string;
    postId: string;
    baselineDays: number;
  }): Promise<PostInsightRaw> {
    const { accessToken, igUserId, postId } = params;

    // baselineDays com limites
    const baselineDaysInput = Math.min(
      Math.max(Math.floor(Number(params.baselineDays || 30)), 7),
      90
    );

    // 1) Post alvo
    const post = await this.igPostService.fetchPostById({ accessToken, postId });
    if (!post) {
      const err: any = new Error("Post not found");
      err.statusCode = 404;
      throw err;
    }

    const caption = String((post as any).caption ?? "");
    const likes = safeNum((post as any).like_count);
    const comments = safeNum((post as any).comments_count);
    const interactions = likes + comments;

    const reach = safeNum((post as any).reach);
    const saves = safeNum((post as any).saves);
    const shares = safeNum((post as any).shares);

    // ✅ hora local (BR)
    const publishedHour = hourLocalSaoPaulo(String((post as any).timestamp));

    const mediaType = String((post as any).media_type ?? "UNKNOWN");
    const hasCTA = hasCTAFromCaption(caption);

    // 2) Baseline (coleta em camadas para aumentar sample)
    // ✅ usamos datas em SP para filtrar corretamente por "dias"
    const toDate = startOfTodaySaoPaulo(); // 00:00 do dia SP
    const from1 = daysAgoSaoPaulo(baselineDaysInput);

    // Estratégia:
    // - puxa a janela pedida com limit maior (tava 60)
    // - se ainda < 10, tenta janelas maiores (45, 60, 90) com limit maior
    // - dedup + remove post atual
    const desiredMinSample = 10;
    const maxHardDays = 90;

    const fetchWindow = async (from: Date, limit: number) => {
      const res = await this.igPostService.fetchBaselineMedia({
        accessToken,
        igUserId,
        from: ymdSaoPaulo(from),
        to: ymdSaoPaulo(toDate),
        limit,
      });
      return res ?? [];
    };

    let baselineMedia: IgMediaWithInsights[] = [];
    baselineMedia = await fetchWindow(from1, 120);
    baselineMedia = dedupById(removeCurrentPost(baselineMedia, postId));

    // ✅ escalonamento inteligente: se a amostra ainda é pequena, amplia janela
    const fallbackWindows = [45, 60, maxHardDays]
      .filter((d) => d > baselineDaysInput)
      .map((d) => Math.min(d, maxHardDays));

    for (const days of fallbackWindows) {
      if (baselineMedia.length >= desiredMinSample) break;

      const fromX = daysAgoSaoPaulo(days);
      const more = await fetchWindow(fromX, 200);

      baselineMedia = dedupById(
        removeCurrentPost(baselineMedia.concat(more), postId)
      );
    }

    const baseline = this.computeBaseline(baselineMedia);

    return {
      post: {
        id: String((post as any).id),
        timestamp: String((post as any).timestamp),
        publishedHour,
        mediaType,
        caption,
        permalink: (post as any).permalink,

        reach,
        likes,
        comments,
        interactions,
        saves,
        shares,

        hasCTA,
      },
      baseline,
    };
  }

  private computeBaseline(items: IgMediaWithInsights[]): BaselineStats {
    const normalized = (items ?? []).map((m) => {
      const caption = String((m as any).caption ?? "");
      const likes = safeNum((m as any).like_count);
      const comments = safeNum((m as any).comments_count);
      const interactions = likes + comments;

      // Alguns endpoints podem não retornar reach/saves/shares para todos os tipos.
      // safeNum já cai para 0, mas aqui mantemos consistente.
      const reach = safeNum((m as any).reach);
      const saves = safeNum((m as any).saves);
      const shares = safeNum((m as any).shares);

      return {
        id: String((m as any).id),
        ts: String((m as any).timestamp),

        // ✅ hora local BR (consistente com o post)
        hour: hourLocalSaoPaulo(String((m as any).timestamp)),

        mediaType: String((m as any).media_type ?? "UNKNOWN"),
        hasCTA: hasCTAFromCaption(caption),

        reach,
        likes,
        comments,
        interactions,
        saves,
        shares,
      };
    });

    const overall = {
      avgReach: avg(normalized.map((x) => x.reach)),
      avgLikes: avg(normalized.map((x) => x.likes)),
      avgComments: avg(normalized.map((x) => x.comments)),
      avgInteractions: avg(normalized.map((x) => x.interactions)),
      avgSaves: avg(normalized.map((x) => x.saves)),
      avgShares: avg(normalized.map((x) => x.shares)),
    };

    // ✅ janelas de 2 horas (ok)
    const windows = [
      { label: "00:00–02:00", from: 0, to: 2 },
      { label: "02:00–04:00", from: 2, to: 4 },
      { label: "04:00–06:00", from: 4, to: 6 },
      { label: "06:00–08:00", from: 6, to: 8 },
      { label: "08:00–10:00", from: 8, to: 10 },
      { label: "10:00–12:00", from: 10, to: 12 },
      { label: "12:00–14:00", from: 12, to: 14 },
      { label: "14:00–16:00", from: 14, to: 16 },
      { label: "16:00–18:00", from: 16, to: 18 },
      { label: "18:00–20:00", from: 18, to: 20 },
      { label: "20:00–22:00", from: 20, to: 22 },
      { label: "22:00–24:00", from: 22, to: 24 },
    ];

    const byHourWindow = windows.map((w) => {
      const group = normalized.filter((x) => x.hour >= w.from && x.hour < w.to);
      return {
        label: w.label,
        fromHour: w.from,
        toHour: w.to,
        sample: group.length,
        avgReach: avg(group.map((x) => x.reach)),
      };
    });

    // ✅ por tipo de mídia
    const byTypeMap = new Map<string, typeof normalized>();
    for (const x of normalized) {
      const arr = byTypeMap.get(x.mediaType) ?? [];
      arr.push(x);
      byTypeMap.set(x.mediaType, arr);
    }

    const byMediaType = Array.from(byTypeMap.entries()).map(
      ([mediaType, group]) => ({
        mediaType,
        sample: group.length,
        avgReach: avg(group.map((x) => x.reach)),
        avgInteractions: avg(group.map((x) => x.interactions)),
      })
    );

    // ✅ efeito do CTA (com detector melhor)
    const withCTA = normalized.filter((x) => x.hasCTA);
    const withoutCTA = normalized.filter((x) => !x.hasCTA);

    return {
      overall,
      byHourWindow,
      byMediaType,
      ctaEffect: {
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
      },
      sampleSize: normalized.length,
    };
  }
}
