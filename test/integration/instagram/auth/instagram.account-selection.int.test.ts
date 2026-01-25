import request from "supertest";
import { app } from "../../../../src/presentation/http/app";
import { prisma } from "../../../../src/infrastructure/db/prismaClient";
import { makeAuthHeader } from "../../helpers/jwt";
import { startFakeMetaServer } from "../../helpers/fakeMetaServer";

describe("INTEGRATION Instagram account selection (active account)", () => {
  const fakeMeta = startFakeMetaServer(4111);

  beforeAll(async () => {
    await fakeMeta.start();
  });

  afterAll(async () => {
    await fakeMeta.stop();
  });

  it("deve usar apenas a conta ativa do usuário ao executar ações dependentes (posts sync)", async () => {
    const email = "diego+int-ig-mult@looma.com";

    // 🧹 limpeza defensiva
    await prisma.instagramPost.deleteMany({
      where: { instagramAccount: { igUserId: { in: ["IG_1", "IG_2"] } } } as any,
    });
    await prisma.instagramAccount.deleteMany({
      where: { igUserId: { in: ["IG_1", "IG_2"] } } as any,
    });
    await prisma.user.deleteMany({ where: { email } as any });

    // 1️⃣ cria usuário
    const user = await prisma.user.create({
      data: {
        email,
        name: "Multi IG",
        passwordHash: "hash",
      },
    });

    // 2️⃣ cria duas contas IG conectadas
    const ig1 = await prisma.instagramAccount.create({
      data: {
        userId: user.id,
        igUserId: "IG_1",
        pageAccessToken: "FAKE_TOKEN_OK",
        isConnected: true,
      } as any,
    });

    const ig2 = await prisma.instagramAccount.create({
      data: {
        userId: user.id,
        igUserId: "IG_2",
        pageAccessToken: "FAKE_TOKEN_OK",
        isConnected: true,
      } as any,
    });

    // 3️⃣ define IG_2 como conta ativa
    await prisma.user.update({
      where: { id: user.id },
      data: { activeInstagramAccountId: ig2.id },
    });

    // 4️⃣ executa uma ação que depende da conta ativa (sync)
    const res = await request(app)
      .post("/api/instagram/posts/sync?limit=5")
      .set("Authorization", makeAuthHeader(user.id))
      .set("x-test-user-id", user.id)
      .send({});

    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);

    // 5️⃣ valida que posts foram criados SOMENTE para a conta ativa (IG_2)
    const postsIg2 = await prisma.instagramPost.findMany({
      where: { instagramAccountId: ig2.id },
    });

    const postsIg1 = await prisma.instagramPost.findMany({
      where: { instagramAccountId: ig1.id },
    });

    expect(postsIg2.length).toBeGreaterThan(0);
    expect(postsIg1.length).toBe(0);
  });
});