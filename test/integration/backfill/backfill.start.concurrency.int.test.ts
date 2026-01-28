import request from "supertest";
import { app } from "../../../src/presentation/http/app";
import { prisma } from "../../../src/infrastructure/db/prismaClient";
import { makeAuthHeader } from "../../integration/helpers/jwt";
import { freezeTime, unfreezeTime } from "../../integration/helpers/metricsTestUtils";
import { createTestUser, createConnectedInstagramAccount } from "../../integration/helpers/igTestFactory";

describe("INTEGRATION POST /api/instagram/backfill/start (concurrency)", () => {
  jest.setTimeout(20000);

  beforeAll(() => {
    freezeTime("2026-01-10T12:00:00.000Z");
  });

  afterAll(() => {
    unfreezeTime();
  });

  beforeEach(async () => {
    await prisma.instagramBackfillJob.deleteMany();
    await prisma.instagramAccount.deleteMany();
    await prisma.user.deleteMany();
  });

  it("concorrência: duas chamadas simultâneas devem retornar o mesmo job (idempotente)", async () => {
    const user = await createTestUser("diego+backfill-concurrent@looma.com");

    const igAccount = await createConnectedInstagramAccount({
      userId: user.id,
      igUserId: "IG_BACKFILL_RACE",
      isConnected: true,
      pageAccessToken: "FAKE_PAGE_ACCESS_TOKEN_OK",
      // se o seu backfill/start exigir facebookPageId, descomenta:
      // facebookPageId: "FB_PAGE_1",
    });

    // garante conta ativa
    await prisma.user.update({
      where: { id: user.id },
      data: { activeInstagramAccountId: igAccount.id },
    });

    const body = {
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-10T00:00:00.000Z",
    };

    const [r1, r2] = await Promise.all([
      request(app)
        .post("/api/instagram/backfill/start")
        .set("Authorization", makeAuthHeader(user.id))
        .set("x-test-user-id", user.id)
        .send(body),

      request(app)
        .post("/api/instagram/backfill/start")
        .set("Authorization", makeAuthHeader(user.id))
        .set("x-test-user-id", user.id)
        .send(body),
    ]);

    // ambos devem responder sucesso
    expect([r1.status, r2.status].every((s) => s >= 200 && s < 300)).toBe(true);

    expect(r1.body?.ok).toBe(true);
    expect(r2.body?.ok).toBe(true);

    expect(r1.body?.jobId).toBeTruthy();
    expect(r2.body?.jobId).toBeTruthy();

    // ✅ idempotência real: mesmo job
    expect(r1.body.jobId).toBe(r2.body.jobId);

    // ✅ no banco só pode existir UM job para esse dedupeKey
    const jobs = await prisma.instagramBackfillJob.findMany({
      where: {
        instagramAccountId: igAccount.id,
      },
      orderBy: { createdAt: "desc" },
    });

    expect(jobs.length).toBe(1);

    expect(jobs[0]).toEqual(
      expect.objectContaining({
        instagramAccountId: igAccount.id,
        status: expect.any(String),
        dedupeKey: expect.any(String),
      })
    );
  });
});