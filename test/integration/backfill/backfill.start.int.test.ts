import request from "supertest";
import { app } from "../../../src/presentation/http/app";
import { prisma } from "../../../src/infrastructure/db/prismaClient";
import { makeAuthHeader } from "../helpers/jwt";
import { createActiveBusinessInstagramAccount } from "../helpers/createActiveBusinessInstagramAccount";

describe("INTEGRATION /api/instagram/backfill/start", () => {
  it("deve criar job no Postgres real", async () => {
    const email = "diego+int-backfill-start@looma.com";
    const igUserId = "IG_USER_BF";

    // 🧹 limpeza defensiva (evita conflito se rodar mais de uma vez)
    await prisma.instagramBackfillJob.deleteMany({
      where: { instagramAccount: { igUserId } } as any,
    });
    await prisma.instagramAccount.deleteMany({
      where: { igUserId } as any,
    });
    await prisma.user.deleteMany({
      where: { email } as any,
    });

    // ✅ cria user + conta IG ativa (helper centralizado)
    const { user, ig } = await createActiveBusinessInstagramAccount({
      prisma,
      email,
      igUserId,
    });

    // 1️⃣ chama endpoint REAL com JWT CORRETO
    const res = await request(app)
      .post("/api/instagram/backfill/start")
      .set("Authorization", makeAuthHeader(user.id)) // ✅ sub = user.id
      .set("x-test-user-id", user.id) // ✅ IMPORTANT: authMiddleware em test força esse userId
      .send({});

    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);

    // 2️⃣ valida job criado no DB
    const job = await prisma.instagramBackfillJob.findFirst({
      where: { instagramAccountId: ig.id } as any,
      orderBy: { createdAt: "desc" } as any,
    });

    expect(job).toBeTruthy();
    expect(job?.instagramAccountId).toBe(ig.id);
    expect(job?.userId).toBe(user.id);

    const status = String(job?.status ?? "");
    expect(status).toMatch(/queued|running|done|failed|completed/i);
  });
});