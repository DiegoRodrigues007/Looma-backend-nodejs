import request from "supertest";
import { app } from "../../../../src/presentation/http/app";
import { prisma } from "../../../../src/infrastructure/db/prismaClient";
import { makeAuthHeader } from "../../helpers/jwt";
import { createTestUser, createConnectedInstagramAccount } from "../../helpers/igTestFactory";

// mock do orchestrator (instanciado dentro do controller)
import { PostInsightsOrchestratorService } from "../../../../src/application/services/insights/PostInsightsOrchestratorService";

describe("INTEGRATION GET /api/metrics/instagram/insights/post", () => {
  beforeEach(async () => {
    jest.restoreAllMocks();

    await prisma.instagramPostInsightResult.deleteMany();
    await prisma.instagramPost.deleteMany();
    await prisma.instagramAccount.deleteMany();
    await prisma.user.deleteMany();
  });

  it("401 se não autenticado", async () => {
    const res = await request(app).get("/api/metrics/instagram/insights/post?postId=123");
    expect(res.status).toBe(401);
  });

  it("400 se postId ausente", async () => {
    const user = await createTestUser("diego+postins-400@looma.com");
    await createConnectedInstagramAccount({ userId: user.id, igUserId: "IG_1" });

    const res = await request(app)
      .get("/api/metrics/instagram/insights/post")
      .set("Authorization", makeAuthHeader(user.id));

    expect(res.status).toBe(400);
  });

  it("400 se IG não conectado", async () => {
    const user = await createTestUser("diego+postins-no-ig@looma.com");

    const res = await request(app)
      .get("/api/metrics/instagram/insights/post?postId=IG_MEDIA_1")
      .set("Authorization", makeAuthHeader(user.id));

    expect(res.status).toBe(400);
    expect(res.body).toEqual(
      expect.objectContaining({
        message: expect.stringMatching(/not connected/i),
      })
    );
  });

  it("200 e source=database quando já existe cache (DB-first)", async () => {
    const user = await createTestUser("diego+postins-db@looma.com");
    const acc = await createConnectedInstagramAccount({ userId: user.id, igUserId: "IG_1" });

    const post = await prisma.instagramPost.create({
      data: {
        userId: user.id,
        instagramAccountId: acc.id,
        igMediaId: "IG_MEDIA_123",
        publishedAt: new Date("2026-01-01T00:00:00.000Z"),
        likeCount: 10,
        commentsCount: 2,
      } as any,
    });

    await prisma.instagramPostInsightResult.create({
      data: {
        postId: post.id,
        baselineWindowDays: 30,
        verdict: "up",
        score: 0.82,
        evidence: [{ k: "reach", v: 123 }],
        why: ["Aumentou alcance"],
        improve: ["Teste horários"],
        continue: ["Continue com reels"],
      } as any,
    });

    const res = await request(app)
      .get("/api/metrics/instagram/insights/post?postId=IG_MEDIA_123&baselineDays=30")
      .set("Authorization", makeAuthHeader(user.id));

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        ok: true,
        source: "database",
        postId: "IG_MEDIA_123",
        baselineDays: 30,
        verdict: expect.anything(),
        evidence: expect.anything(),
      })
    );
  });

  it("200 computed_not_persisted quando post não existe no DB (mas calcula via orchestrator)", async () => {
    const user = await createTestUser("diego+postins-compute@looma.com");
    await createConnectedInstagramAccount({ userId: user.id, igUserId: "IG_1" });

    const runSpy = jest
      .spyOn(PostInsightsOrchestratorService.prototype as any, "run")
      .mockResolvedValue({
        ok: true,
        verdict: "stable",
        score: 0.5,
        evidence: [{ metric: "reach", value: 100 }],
        why: ["Motivo X"],
        improve: ["Melhoria Y"],
        continue: ["Continue Z"],
        meta: { any: "thing" },
      });

    const res = await request(app)
      .get("/api/metrics/instagram/insights/post?postId=IG_MEDIA_MISSING&baselineDays=30")
      .set("Authorization", makeAuthHeader(user.id));

    expect(res.status).toBe(200);
    expect(runSpy).toHaveBeenCalled();

    expect(res.body).toEqual(
      expect.objectContaining({
        ok: true,
        meta: expect.objectContaining({
          insightsSource: "computed_not_persisted",
          reason: "post_not_found_in_db",
        }),
      })
    );
  });
});