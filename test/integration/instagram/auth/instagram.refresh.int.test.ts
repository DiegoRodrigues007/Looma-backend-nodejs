import request from "supertest";
import { app } from "../../../../src/presentation/http/app";
import { prisma } from "../../../../src/infrastructure/db/prismaClient";
import { makeAuthHeader } from "../../helpers/jwt";
import { startFakeMetaServer } from "../../helpers/fakeMetaServer";

describe("INTEGRATION /api/instagram/refresh", () => {
  const fakeMeta = startFakeMetaServer(4111);

  beforeAll(async () => {
    await fakeMeta.start();
  });

  afterAll(async () => {
    await fakeMeta.stop();
  });

  it("deve renovar token quando expirado", async () => {
    const email = "diego+int-ig-refresh@looma.com";

    // 🧹 limpeza defensiva
    await prisma.instagramAccount.deleteMany({
      where: { user: { email } } as any,
    });
    await prisma.user.deleteMany({ where: { email } as any });

    // 1️⃣ cria usuário
    const user = await prisma.user.create({
      data: {
        email,
        name: "Refresh User",
        passwordHash: "hash",
      },
    });

    // 2️⃣ cria conta IG com token EXPIRADO
    const ig = await prisma.instagramAccount.create({
      data: {
        userId: user.id,
        igUserId: "IG_REFRESH",
        pageAccessToken: "EXPIRED_TOKEN",
        expiresAt: new Date(Date.now() - 60_000), // ✅ campo correto
        isConnected: true,
      } as any,
    });

    // 3️⃣ marca conta como ativa
    await prisma.user.update({
      where: { id: user.id },
      data: { activeInstagramAccountId: ig.id },
    });

    // 4️⃣ chama endpoint de refresh
    const res = await request(app)
      .post("/api/instagram/refresh")
      .set("Authorization", makeAuthHeader(user.id))
      .set("x-test-user-id", user.id);

    // ✅ refresh OK
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);

    // 5️⃣ valida que token foi atualizado
    const updated = await prisma.instagramAccount.findUnique({
      where: { id: ig.id },
    });

    expect(updated?.pageAccessToken).toBeTruthy();
    expect(updated?.pageAccessToken).not.toBe("EXPIRED_TOKEN");
  });

  it("deve exigir reauth quando refresh falhar", async () => {
    const email = "diego+int-ig-refresh-fail@looma.com";

    // 🧹 limpeza defensiva
    await prisma.instagramAccount.deleteMany({
      where: { user: { email } } as any,
    });
    await prisma.user.deleteMany({ where: { email } as any });

    // cria usuário
    const user = await prisma.user.create({
      data: {
        email,
        name: "Refresh Fail User",
        passwordHash: "hash",
      },
    });

    // cria conta IG com token inválido/irrecuperável
    const ig = await prisma.instagramAccount.create({
      data: {
        userId: user.id,
        igUserId: "IG_REFRESH_FAIL",
        pageAccessToken: "INVALID_TOKEN",
        expiresAt: new Date(Date.now() - 60_000),
        isConnected: true,
      } as any,
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { activeInstagramAccountId: ig.id },
    });

    // força erro do provider (Meta fora do ar)
    const old = process.env.INSTAGRAM_GRAPH_BASE_URL;
    process.env.INSTAGRAM_GRAPH_BASE_URL = "http://127.0.0.1:4999";

    const res = await request(app)
      .post("/api/instagram/refresh")
      .set("Authorization", makeAuthHeader(user.id))
      .set("x-test-user-id", user.id);

    // ❗ comportamento esperado: reauth / erro controlado
    expect([400, 401, 403]).toContain(res.status);

    const bodyStr = JSON.stringify(res.body ?? {});
    expect(bodyStr).toMatch(/reauth|auth|token|refresh/i);

    // restaura env
    process.env.INSTAGRAM_GRAPH_BASE_URL = old;
  });
});