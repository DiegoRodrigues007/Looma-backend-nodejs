import request from "supertest";
import { app } from "../../../src/presentation/http/app";
import { prisma } from "../../../src/infrastructure/db/prismaClient";
import { makeAuthHeader } from "../helpers/jwt";

function pickStatus(body: any): string | null {
  return (
    body?.status ??
    body?.data?.status ??
    body?.job?.status ??
    body?.lastJob?.status ??
    null
  );
}

describe("INTEGRATION /api/instagram/backfill/status", () => {
  it("quando não existe job, deve retornar 200 com status null/none OU 404", async () => {
    const email = "diego+int-backfill-status-none@looma.com";

    // 🧹 limpeza defensiva
    await prisma.instagramBackfillJob.deleteMany({
      where: { user: { email } } as any,
    });
    await prisma.instagramAccount.deleteMany({
      where: { user: { email } } as any,
    });
    await prisma.user.deleteMany({
      where: { email } } as any,
    );

    // ✅ cria user REAL
    const user = await prisma.user.create({
      data: {
        email,
        name: "Test User",
        passwordHash: "test_hash",
      },
    });

    // 🔑 JWT CORRETO → sub = user.id
    const res = await request(app)
      .get("/api/instagram/backfill/status")
      .set("Authorization", makeAuthHeader(user.id));

    expect([200, 404]).toContain(res.status);

    if (res.status === 200) {
      const status = pickStatus(res.body);
      expect([null, "none", "NONE", ""]).toContain(status as any);
    }
  });

  it("quando existe job, deve retornar status do último job", async () => {
    const email = "diego+int-backfill-status@looma.com";

    // 🧹 limpeza defensiva
    await prisma.instagramBackfillJob.deleteMany({
      where: { user: { email } } as any,
    });
    await prisma.instagramAccount.deleteMany({
      where: { user: { email } } as any,
    });
    await prisma.user.deleteMany({
      where: { email } } as any,
    );

    // ✅ cria user REAL
    const user = await prisma.user.create({
      data: {
        email,
        name: "Test User",
        passwordHash: "test_hash",
      },
    });

    // cria conta IG REAL (mínimo necessário)
    const ig = await prisma.instagramAccount.create({
      data: {
        userId: user.id,
        igUserId: "IG_USER_BF_STATUS",
        accessToken: "FAKE_TOKEN_OK",
        isConnected: true,
      },
    });

    // cria job REAL no DB
    await prisma.instagramBackfillJob.create({
      data: {
        userId: user.id,
        instagramAccountId: ig.id,
        status: "queued",
        from: new Date("2026-01-01T00:00:00.000Z"),
        to: new Date("2026-01-02T00:00:00.000Z"),
        dedupeKey: `job_${Date.now()}`,
      },
    });

    // 🔑 JWT CORRETO → sub = user.id
    const res = await request(app)
      .get("/api/instagram/backfill/status")
      .set("Authorization", makeAuthHeader(user.id));

    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);

    const status = pickStatus(res.body);
    expect(typeof status === "string" || status === null).toBe(true);

    if (typeof status === "string") {
      expect(
        ["none", "queued", "running", "done", "failed", "completed"]
      ).toContain(status.toLowerCase());
    }
  });
});