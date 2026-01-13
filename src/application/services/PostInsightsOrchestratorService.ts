// src/application/insights/PostInsightsOrchestratorService.ts
import { PostInsightDataService } from "./PostInsightDataService";
import { PostInsightRulesService } from "./PostInsightRulesService";
import { PostInsightAiNarratorService } from "./PostInsightAiNarratorService";
import type { Narrated } from "./PostInsightAiNarratorService";

/**
 * ✅ Objetivo do Orchestrator (tooltip):
 * - NÃO estourar timeout no frontend
 * - Sempre retornar `narrated` (mesmo sem IA)
 * - Cachear por postId + baselineDays (evita chamar IA toda hora)
 */
export class PostInsightsOrchestratorService {
  private static readonly cache = new Map<
    string,
    { expiresAt: number; value: any }
  >();

  private readonly aiTimeoutMs = Number(
    process.env.INSIGHTS_AI_TIMEOUT_MS ?? 6500
  );

  private readonly cacheTtlMs = Number(
    process.env.INSIGHTS_AI_CACHE_TTL_MS ?? 10 * 60 * 1000 // 10min
  );

  constructor(
    private readonly data = new PostInsightDataService(),
    private readonly rules = new PostInsightRulesService(),
    private readonly narrator = new PostInsightAiNarratorService()
  ) {}

  private cacheKey(params: {
    igUserId: string;
    postId: string;
    baselineDays: number;
  }) {
    return `${params.igUserId}:${params.postId}:baseline=${params.baselineDays}`;
  }

  private getCache(key: string) {
    const hit = PostInsightsOrchestratorService.cache.get(key);
    if (!hit) return null;
    if (Date.now() > hit.expiresAt) {
      PostInsightsOrchestratorService.cache.delete(key);
      return null;
    }
    return hit.value;
  }

  private setCache(key: string, value: any) {
    PostInsightsOrchestratorService.cache.set(key, {
      expiresAt: Date.now() + this.cacheTtlMs,
      value,
    });
  }

  private async withTimeout<T>(p: Promise<T>, timeoutMs: number): Promise<T> {
    let t: any;
    const timeout = new Promise<T>((_, rej) => {
      t = setTimeout(() => {
        rej(Object.assign(new Error("AI_TIMEOUT"), { code: "AI_TIMEOUT" }));
      }, timeoutMs);
    });

    try {
      return await Promise.race([p, timeout]);
    } finally {
      clearTimeout(t);
    }
  }

  async run(params: {
    accessToken: string;
    igUserId: string;
    postId: string;
    baselineDays: number;
  }) {
    const key = this.cacheKey(params);

    // ✅ cache primeiro (mais rápido que tudo)
    const cached = this.getCache(key);
    if (cached) return cached;

    // ✅ 1) pega dados + rules (determinístico)
    const raw = await this.data.build(params);
    const result = this.rules.build(raw);

    // ✅ 2) tenta IA com hard-timeout
    //    se falhar/timeout -> retorna fallback (sem aiError pro frontend)
    let narrated: Narrated | null = null;

    try {
      narrated = await this.withTimeout(
        this.narrator.narrate(result),
        this.aiTimeoutMs
      );
    } catch (e: any) {
      // ✅ log (sem derrubar UI)
      console.warn("[INSIGHTS][AI SKIPPED]", {
        code: e?.code ?? "UNKNOWN",
        message: e?.message ?? "AI failed/timeout",
        postId: params.postId,
        baselineDays: params.baselineDays,
      });
      narrated = null;
    }


    const response = {
      ...result,
      narrated: narrated ?? {
        why: [],
        improve: [],
        continue: [],
      },
    };

    this.setCache(key, response);

    return response;
  }
}
