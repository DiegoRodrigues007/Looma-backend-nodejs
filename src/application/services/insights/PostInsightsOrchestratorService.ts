import { PostInsightDataService } from "./PostInsightDataService";
import { PostInsightRulesService } from "../../../domain/insights/PostInsightRules";
import type { PostInsightResult } from "../../../domain/insights/PostInsightRules";

import type { IAiNarrator } from "../../ports/ai/IAiNarrator";
import type { Narrated } from "../../../shared/types/Narrated";

import type { IPostInsightsProvider } from "../../ports/insights/IPostInsightsProvider";
import type { IPostInsightResultRepository } from "../../ports/insights/IPostInsightResultRepository";

import { InstagramPostInsightsProvider } from "../../../infrastructure/instagram/providers/InstagramPostInsightsProvider";
import { OllamaPostInsightAiNarrator } from "../../../infrastructure/ai/OllamaPostInsightAiNarrator";

type OrchestratorDeps = {
  provider?: IPostInsightsProvider;
  data?: PostInsightDataService;

  rules?: PostInsightRulesService;

  narrator?: IAiNarrator<PostInsightResult, Narrated>;

  resultsRepo?: IPostInsightResultRepository;
};

export class PostInsightsOrchestratorService {
  private static readonly cache = new Map<string, { expiresAt: number; value: any }>();

  private readonly aiTimeoutMs = Number(process.env.INSIGHTS_AI_TIMEOUT_MS ?? 6500);

  private readonly cacheTtlMs = Number(
    process.env.INSIGHTS_AI_CACHE_TTL_MS ?? 10 * 60 * 1000
  );

  private readonly data: PostInsightDataService;
  private readonly rules: PostInsightRulesService;
  private readonly narrator: IAiNarrator<PostInsightResult, Narrated>;
  private readonly resultsRepo?: IPostInsightResultRepository;

  constructor(deps: OrchestratorDeps = {}) {
    const provider = deps.provider ?? new InstagramPostInsightsProvider();

    this.data = deps.data ?? new PostInsightDataService(provider);
    this.rules = deps.rules ?? new PostInsightRulesService();
    this.narrator = deps.narrator ?? new OllamaPostInsightAiNarrator();
    this.resultsRepo = deps.resultsRepo;
  }

  private cacheKey(params: { igUserId: string; postId: string; baselineDays: number }) {
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

  private async persistResultSafe(params: {
    userId: string;
    instagramAccountId?: string | null;
    igUserId: string;
    postId: string;
    postDbId?: string | null;
    baselineDays: number;
    result: any;
  }) {
    if (!this.resultsRepo) return;

    try {
      await this.resultsRepo.upsertResult({
        userId: String(params.userId),
        instagramAccountId: params.instagramAccountId ?? null,
        igUserId: String(params.igUserId),
        postId: String(params.postId),
        postDbId: params.postDbId ?? null,
        baselineDays: params.baselineDays,
        payloadJson: params.result,
      });
    } catch (e: any) {
      console.warn("[INSIGHTS][PERSIST_SKIPPED]", {
        message: e?.message ?? String(e),
        code: e?.code,
      });
    }
  }

  async run(params: {
    accessToken: string;
    igUserId: string;
    postId: string;
    baselineDays: number;

    userId?: string;
    instagramAccountId?: string | null;
    postDbId?: string | null;
    persist?: boolean;
  }) {
    const key = this.cacheKey({
      igUserId: params.igUserId,
      postId: params.postId,
      baselineDays: params.baselineDays,
    });

    const cached = this.getCache(key);
    if (cached) return cached;

    const raw = await this.data.build({
      accessToken: params.accessToken,
      igUserId: params.igUserId,
      postId: params.postId,
      baselineDays: params.baselineDays,
    });

    const result = this.rules.build(raw);

    let narrated: Narrated | null = null;
    try {
      narrated = await this.withTimeout(this.narrator.narrate(result), this.aiTimeoutMs);
    } catch (e: any) {
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
      narrated: narrated ?? { why: [], improve: [], continue: [] },
    };

    this.setCache(key, response);

    if (params.persist && params.userId) {
      await this.persistResultSafe({
        userId: String(params.userId),
        instagramAccountId: params.instagramAccountId ?? null,
        igUserId: params.igUserId,
        postId: params.postId,
        postDbId: params.postDbId ?? null,
        baselineDays: params.baselineDays,
        result: response,
      });
    }

    return response;
  }
}
