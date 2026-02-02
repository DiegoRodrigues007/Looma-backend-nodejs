import { PostInsightDataService } from "./PostInsightDataService";
import { PostInsightRulesService } from "../../../domain/insights/PostInsightRules";
import type { PostInsightResult } from "../../../domain/insights/PostInsightRules";

import type { IAiNarrator } from "../../interfaces/ai/IAiNarrator";
import type { Narrated } from "../../../shared/types/Narrated";

import type { IPostInsightsProvider } from "../../interfaces/insights/IPostInsightsProvider";
import type { IPostInsightResultRepository } from "../../../application/interfaces/insights/IPostInsightResultRepository";

type OrchestratorConfig = {
  aiTimeoutMs: number;
  cacheTtlMs: number;
};

type OrchestratorDeps = {
  provider: IPostInsightsProvider;
  narrator: IAiNarrator<PostInsightResult, Narrated>;
  data?: PostInsightDataService;
  rules?: PostInsightRulesService;
  resultsRepo?: IPostInsightResultRepository;
  config?: Partial<OrchestratorConfig>;
};

export class PostInsightsOrchestratorService {
  private static readonly cache = new Map<string, { expiresAt: number; value: any }>();

  private readonly config: OrchestratorConfig;

  private readonly data: PostInsightDataService;
  private readonly rules: PostInsightRulesService;
  private readonly narrator: IAiNarrator<PostInsightResult, Narrated>;
  private readonly resultsRepo?: IPostInsightResultRepository;

  constructor(deps: OrchestratorDeps) {
    if (!deps?.provider) throw new Error("PostInsightsOrchestratorService: provider is required");
    if (!deps?.narrator) throw new Error("PostInsightsOrchestratorService: narrator is required");

    this.config = {
      aiTimeoutMs: 6500,
      cacheTtlMs: 10 * 60 * 1000,
      ...deps.config,
    };

    this.narrator = deps.narrator;
    this.resultsRepo = deps.resultsRepo;

    this.data = deps.data ?? new PostInsightDataService(deps.provider);
    this.rules = deps.rules ?? new PostInsightRulesService();
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
      expiresAt: Date.now() + this.config.cacheTtlMs,
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
      narrated = await this.withTimeout(
        this.narrator.narrate(result),
        this.config.aiTimeoutMs
      );
    } catch (e: any) {
      console.warn("[INSIGHTS][AI_SKIPPED]", {
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
