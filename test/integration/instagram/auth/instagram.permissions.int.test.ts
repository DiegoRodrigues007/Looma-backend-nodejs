import request from "supertest";
import { app } from "../../../../src/presentation/http/app";
import { prisma } from "../../../../src/infrastructure/db/prismaClient";
import { makeAuthHeader } from "../../helpers/jwt";
import { startFakeMetaServer } from "../../helpers/fakeMetaServer";

describe("INTEGRATION Instagram permissions (missing scopes)", () => {
  const fakeMeta = startFakeMetaServer(4111);

  beforeAll(async () => {
    await fakeMeta.start();
  });

  afterAll(async () => {
    await fakeMeta.stop();
  });

  it("deve exigir reauth quando scopes obrigatórios estão faltando", async () => {
    const email = "diego+int-ig-scopes@looma.com";

    // 🧹 limpeza defensiva
    await prisma.instagramPost.deleteMany({
      where: { instagramAccount: { igUserId: "IG_SCOPES" } } as any,
    });
    await prisma.instagramAccount.deleteMany({
      where: { igUserId: "IG_SCOPES" } as any,
    });
    await prisma.user.deleteMany({ where: { email } as any });

    // 1️⃣ cria usuário
    const user = await prisma.user.create({
      data: {
        email,
        name: "Scopes User",
        passwordHash: "hash",
      },
    });

    // 2️⃣ cria conta IG com scopes INSUFICIENTES
    const ig = await prisma.instagramAccount.create({
      data: {
        userId: user.id,
        igUserId: "IG_SCOPES",
        pageAccessToken: "FAKE_TOKEN_OK",
        grantedScopes: "instagram_basic", // ❌ faltam scopes críticos
        isConnected: true,
      } as any,
    });

    // 3️⃣ marca conta como ativa
    await prisma.user.update({
      where: { id: user.id },
      data: { activeInstagramAccountId: ig.id },
    });

    // 4️⃣ executa ação que depende de permissões completas
    const res = await request(app)
      .post("/api/instagram/posts/sync?limit=5")
      .set("Authorization", makeAuthHeader(user.id))
      .set("x-test-user-id", user.id)
      .send({});

    // ❗ comportamento esperado:
    // - erro controlado
    // - backend sinaliza necessidade de reauth
    expect([400, 401, 403]).toContain(res.status);

    const bodyStr = JSON.stringify(res.body ?? {});
    expect(bodyStr).toMatch(/reauth|permiss|scope|auth/i);
  });
});