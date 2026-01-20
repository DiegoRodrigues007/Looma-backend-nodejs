// src/application/insights/PostInsightsOrchestratorService.ts
import { PostInsightDataService } from "./PostInsightDataService";
import { PostInsightRulesService } from "./PostInsightRulesService";
import { PostInsightAiNarratorService } from "./PostInsightAiNarratorService";
import type { Narrated } from "./PostInsightAiNarratorService";

import { prisma } from "../../../infrastructure/db/prismaClient";

/**
 * ✅ Objetivo do Orchestrator (tooltip):
 * - NÃO estourar timeout no frontend
 * - Sempre retornar `narrated` (mesmo sem IA)
 * - Cachear por postId + baselineDays (evita chamar IA toda hora)
 * - (NOVO) opcionalmente persistir resultado no banco (para backfill)
 */
export class PostInsightsOrchestratorService {
  private static readonly cache = new Map<string, { expiresAt: number; value: any }>();

  private readonly aiTimeoutMs = Number(process.env.INSIGHTS_AI_TIMEOUT_MS ?? 6500);

  private readonly cacheTtlMs = Number(
    process.env.INSIGHTS_AI_CACHE_TTL_MS ?? 10 * 60 * 1000 // 10min
  );

  constructor(
    private readonly data = new PostInsightDataService(),
    private readonly rules = new PostInsightRulesService(),
    private readonly narrator = new PostInsightAiNarratorService()
  ) {}

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

  /**
   * ✅ Persiste o resultado no banco (não pode quebrar o fluxo)
   *
   * Observação: Ajuste os campos conforme o seu schema real.
   */
  private async persistResultSafe(params: {
    userId: string;
    instagramAccountId?: string | null;
    igUserId: string;
    postId: string; // igMediaId (Graph)
    postDbId?: string | null; // InstagramPost.id (DB)
    baselineDays: number;
    result: any;
  }) {
    try {
      const {
        userId,
        instagramAccountId,
        igUserId,
        postId,
        postDbId,
        baselineDays,
        result,
      } = params;

      // ✅ 1) escolhe uma "chave" consistente
      // Preferência: postDbId + baselineDays (melhor)
      // Fallback: igUserId + postId + baselineDays
      const unique = {
        // ajuste para o seu unique real
        // ex: postId_baselineDays: { postId: postDbId!, baselineDays }
        // ou igUserId_postId_baselineDays: { igUserId, postId, baselineDays }
      } as any;

      // ✅ Tenta detectar qual unique existe (sem quebrar types)
      // A estratégia aqui é "melhor esforço": você vai ajustar depois com o seu schema.
      if (postDbId) {
        unique.postId_baselineDays = { postId: postDbId, baselineDays };
      } else {
        unique.igUserId_postId_baselineDays = { igUserId, postId, baselineDays };
      }

      // @ts-ignore
      await prisma.instagramPostInsightResults.upsert({
        where: unique,
        update: {
          userId: String(userId),
          instagramAccountId: instagramAccountId ?? null,
          igUserId: String(igUserId),
          postId: String(postId),
          baselineDays,
          payloadJson: result, // ✅ salva tudo (rules + narrated)
          updatedAt: new Date(),
        },
        create: {
          userId: String(userId),
          instagramAccountId: instagramAccountId ?? null,
          igUserId: String(igUserId),
          postId: String(postId),
          baselineDays,
          postDbId: postDbId ?? null, // se existir no seu schema
          payloadJson: result,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    } catch (e: any) {
      // ✅ não derruba tooltip/backfill por causa de persistência
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

    // ✅ NOVO: pra backfill salvar no banco
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

    // ✅ cache primeiro (mais rápido que tudo)
    const cached = this.getCache(key);
    if (cached) return cached;

    // ✅ 1) pega dados + rules (determinístico)
    const raw = await this.data.build({
      accessToken: params.accessToken,
      igUserId: params.igUserId,
      postId: params.postId,
      baselineDays: params.baselineDays,
    });

    const result = this.rules.build(raw);

    // ✅ 2) tenta IA com hard-timeout
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
      narrated: narrated ?? {
        why: [],
        improve: [],
        continue: [],
      },
    };

    // ✅ 3) cache em memória
    this.setCache(key, response);

    // ✅ 4) (NOVO) persistência opcional (para backfill)
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
