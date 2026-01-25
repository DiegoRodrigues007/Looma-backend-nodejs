import request from "supertest";
import { app } from "../../../src/presentation/http/app";
import { prisma } from "../../../src/infrastructure/db/prismaClient";
import { makeAuthHeader } from "../helpers/jwt";
import { createActiveBusinessInstagramAccount } from "../helpers/createActiveBusinessInstagramAccount";

describe("INTEGRATION /api/instagram/backfill/start (reuse active job)", () => {
  it("deve reaproveitar um job queued/running existente (não criar duplicado)", async () => {
    const email = "diego+int-backfill-reuse@looma.com";
    const igUserId = "IG_USER_BF_REUSE";

    // limpeza defensiva
    await prisma.instagramBackfillJob.deleteMany({
      where: { instagramAccount: { igUserId } } as any,
    });
    await prisma.instagramAccount.deleteMany({ where: { igUserId } as any });
    await prisma.user.deleteMany({ where: { email } as any });

    // cria user + conta IG ativa/conectada
    const { user, ig } = await createActiveBusinessInstagramAccount({
      prisma,
      email,
      igUserId,
    });

    // cria um job "queued" manualmente (simula job ativo)
    const existing = await prisma.instagramBackfillJob.create({
      data: {
        userId: user.id,
        instagramAccountId: ig.id,
        status: "queued",
        from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        to: new Date(),
        dedupeKey: `${ig.id}:manual:${Date.now()}`,
      } as any,
    });

    // chama start -> deve retornar o mesmo job
    const res = await request(app)
      .post("/api/instagram/backfill/start")
      .set("Authorization", makeAuthHeader(user.id))
      .set("x-test-user-id", user.id)
      .send({});

    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);

    expect(res.body?.jobId).toBe(existing.id);
    expect(String(res.body?.status)).toMatch(/queued|running/i);

    // garante que NÃO criou outro job ativo
    const jobs = await prisma.instagramBackfillJob.findMany({
      where: {
        userId: user.id,
        instagramAccountId: ig.id,
        status: { in: ["queued", "running"] },
      } as any,
      orderBy: { createdAt: "desc" } as any,
    });

    expect(jobs.length).toBe(1);
    expect(jobs[0].id).toBe(existing.id);
  });
});