import { Request, Response } from "express";
import {
  WeeklyInsightsService,
  TopContentForInsights,
} from "../../../application/services/insights/WeeklyInsightsService";
import { InstagramTopContentService } from "../../../application/services/instagram/InstagramTopContentService";
import { PostInsightsOrchestratorService } from "../../../application/services/insights/PostInsightsOrchestratorService";

export type IgCreds = {
  igUserId: string;
  accessToken: string;
};

export interface IInstagramAccountCredentialsRepository {

  getConnectedCredsByUserId(params: {
    userId: string;
    instagramAccountId?: string | null;
  }): Promise<IgCreds | null>;
}

export type InstagramPostRef = {
  id: string; 
  igMediaId?: string | null; 
};

export interface IInstagramPostRepository {
  findByIgMediaId(params: {
    userId: string;
    instagramAccountId?: string | null;
    igMediaId: string;
  }): Promise<InstagramPostRef | null>;

  findById(params: {
    userId: string;
    instagramAccountId?: string | null;
    id: string;
  }): Promise<InstagramPostRef | null>;
}

export type PostInsightCached = {
  verdict: any;
  score: any;
  evidence: any;
  why: any;
  improve: any;
  continue: any;
};

export interface IInstagramPostInsightResultRepository {
  findLatest(params: {
    postId: string;
    baselineWindowDays: number;
  }): Promise<PostInsightCached | null>;

  upsert(params: {
    postId: string;
    baselineWindowDays: number;
    verdict: string;
    score: number | null;
    evidence: any;
    why: any;
    improve: any;
    continue: any;
  }): Promise<void>;
}

function getUserIdFromReq(req: Request): string | null {
  const anyReq = req as any;

  return (
    anyReq.userId ||
    anyReq.user?.id ||
    anyReq.user?.userId ||
    anyReq.user?.sub ||
    anyReq.auth?.userId ||
    anyReq.session?.userId ||
    null
  );
}

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

function parseYmd(ymdStr: string): Date {
  return new Date(`${ymdStr}T00:00:00.000Z`);
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function clampInt(n: number, min: number, max: number, fallback: number) {
  const num = Number(n);
  if (!Number.isFinite(num)) return fallback;
  const v = Math.floor(num);
  return Math.min(Math.max(v, min), max);
}

function pickInsightPayload(data: any) {
  const verdict =
    data?.verdict ?? data?.result?.verdict ?? data?.rules?.verdict ?? null;
  const score = data?.score ?? data?.result?.score ?? data?.rules?.score ?? null;
  const evidence =
    data?.evidence ?? data?.result?.evidence ?? data?.rules?.evidence ?? null;

  const why = data?.why ?? data?.narrated?.why ?? data?.narration?.why ?? null;
  const improve =
    data?.improve ??
    data?.narrated?.improve ??
    data?.narration?.improve ??
    null;
  const continueDoing =
    data?.continue ??
    data?.continueDoing ??
    data?.narrated?.continue ??
    data?.narration?.continue ??
    null;

  return { verdict, score, evidence, why, improve, continueDoing };
}

function normalizeScore(score: any): number | null {
  if (score === null || score === undefined) return null;
  if (typeof score === "number") return Number.isFinite(score) ? score : null;
  const n = Number(score);
  return Number.isFinite(n) ? n : null;
}

function ensureJson(value: any, fallback: any) {
  if (value === null || value === undefined) return fallback;
  return value;
}


type InsightsControllerDeps = {
  weeklyInsightsService: WeeklyInsightsService;

  topContentService: InstagramTopContentService;

  postInsightsService: PostInsightsOrchestratorService;

  credsRepo: IInstagramAccountCredentialsRepository;
  postRepo: IInstagramPostRepository;
  postInsightsRepo: IInstagramPostInsightResultRepository;
};

export class InsightsController {
  private readonly weeklyInsightsService: WeeklyInsightsService;
  private readonly topContentService: InstagramTopContentService;
  private readonly postInsightsService: PostInsightsOrchestratorService;

  private readonly credsRepo: IInstagramAccountCredentialsRepository;
  private readonly postRepo: IInstagramPostRepository;
  private readonly postInsightsRepo: IInstagramPostInsightResultRepository;

  constructor(deps: InsightsControllerDeps) {
    this.weeklyInsightsService = deps.weeklyInsightsService;
    this.topContentService = deps.topContentService;
    this.postInsightsService = deps.postInsightsService;

    this.credsRepo = deps.credsRepo;
    this.postRepo = deps.postRepo;
    this.postInsightsRepo = deps.postInsightsRepo;
  }

  async weeklyInstagramInsights(req: Request, res: Response) {
    try {
      const userId = getUserIdFromReq(req);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const instagramAccountId = String(
        (req.query.instagramAccountId ?? "") as any
      ).trim();
      const accountFilter = instagramAccountId ? instagramAccountId : null;

      const daysRaw = Number(req.query.days ?? 7);
      const days = clampInt(daysRaw, 3, 30, 7);

      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);

      const to = today;
      const fromAll = addDays(to, -(days * 2 - 1));
      const currentFrom = addDays(parseYmd(ymd(fromAll)), days);

      const periodFrom = ymd(currentFrom);
      const periodTo = ymd(to);

      let topContent: TopContentForInsights[] | undefined;

      try {
        const creds = await this.credsRepo.getConnectedCredsByUserId({
          userId: String(userId),
          instagramAccountId: accountFilter,
        });

        if (creds) {
          const top = await this.topContentService.fetchTopContent({
            accessToken: creds.accessToken,
            igUserId: creds.igUserId,
            from: periodFrom,
            to: periodTo,
            limit: 10,
          });

          topContent = top.map((x) => ({
            totalInteractions: Number(x.totalInteractions ?? 0),
            reach:
              x.reach !== undefined && x.reach !== null
                ? Number(x.reach)
                : undefined,
            captionLength: x.captionLength,
            mediaType: x.mediaType,
          }));
        } else {
          topContent = undefined;
        }
      } catch {
        topContent = undefined;
      }

      const data = await this.weeklyInsightsService.generateForUser(
        String(userId),
        "instagram",
        days,
        topContent
      );

      return res.status(200).json(data);
    } catch (err: any) {
      return res.status(500).json({
        message: "Failed to generate weekly insights",
        error: err?.message ?? String(err),
      });
    }
  }

  async instagramPostInsights(req: Request, res: Response) {
    try {
      const userId = getUserIdFromReq(req);
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      const postIdRaw = String(req.query.postId ?? "").trim();
      if (!postIdRaw)
        return res.status(400).json({ message: "postId is required" });

      const instagramAccountId = String(
        (req.query.instagramAccountId ?? "") as any
      ).trim();
      const accountFilter = instagramAccountId ? instagramAccountId : null;

      const baselineDaysRaw = Number(req.query.baselineDays ?? 30);
      const baselineDays = clampInt(baselineDaysRaw, 7, 90, 30);

      const creds = await this.credsRepo.getConnectedCredsByUserId({
        userId: String(userId),
        instagramAccountId: accountFilter,
      });

      if (!creds) {
        return res.status(400).json({
          message: "Instagram not connected or missing access token",
        });
      }

      const postWhere = {
        userId: String(userId),
        instagramAccountId: accountFilter,
      };

      const post =
        (await this.postRepo.findByIgMediaId({
          ...postWhere,
          igMediaId: postIdRaw,
        })) ??
        (await this.postRepo.findById({
          ...postWhere,
          id: postIdRaw,
        }));

      if (!post?.id) {
        const data = await this.postInsightsService.run({
          accessToken: creds.accessToken,
          igUserId: creds.igUserId,
          postId: postIdRaw,
          baselineDays,
        });

        return res.status(200).json({
          ...data,
          meta: {
            ...(data?.meta ?? {}),
            insightsSource: "computed_not_persisted",
            reason: "post_not_found_in_db",
          },
        });
      }

      const cached = await this.postInsightsRepo.findLatest({
        postId: post.id,
        baselineWindowDays: baselineDays,
      });

      if (cached) {
        return res.status(200).json({
          ok: true,
          source: "database",
          postId: post.igMediaId ?? postIdRaw,
          baselineDays,
          verdict: (cached as any).verdict ?? null,
          score: (cached as any).score ?? null,
          evidence: (cached as any).evidence ?? null,
          why: (cached as any).why ?? null,
          improve: (cached as any).improve ?? null,
          continue: (cached as any).continue ?? null,
        });
      }

      const data = await this.postInsightsService.run({
        accessToken: creds.accessToken,
        igUserId: creds.igUserId,
        postId: post.igMediaId ?? postIdRaw,
        baselineDays,
      });

      const picked = pickInsightPayload(data);

      const safeVerdict = String(picked.verdict ?? "stable");
      const safeScore = normalizeScore(picked.score);

      const safeEvidence = ensureJson(picked.evidence, []);
      const safeWhy = ensureJson(picked.why, []);
      const safeImprove = ensureJson(picked.improve, []);
      const safeContinue = ensureJson(picked.continueDoing, []);

      try {
        await this.postInsightsRepo.upsert({
          postId: post.id,
          baselineWindowDays: baselineDays,
          verdict: safeVerdict,
          score: safeScore,
          evidence: safeEvidence,
          why: safeWhy,
          improve: safeImprove,
          continue: safeContinue,
        });
      } catch (e: any) {
        return res.status(200).json({
          ...data,
          meta: {
            ...(data?.meta ?? {}),
            insightsSource: "computed_but_persist_failed",
            persistError: e?.message ?? String(e),
          },
        });
      }

      return res.status(200).json({
        ...data,
        meta: {
          ...(data?.meta ?? {}),
          insightsSource: "computed_and_persisted",
        },
      });
    } catch (err: any) {
      const status = Number(err?.statusCode) || 500;

      return res.status(status).json({
        message: err?.message ?? "Failed to generate post insights",
        code: err?.code,
        details: err?.details,
      });
    }
  }
}
