import request from "supertest";
import { app } from "../../../../src/presentation/http/app";
import { prisma } from "../../../../src/infrastructure/db/prismaClient";
import { startFakeMetaServer } from "../../helpers/fakeMetaServer";
import { makeAuthHeader } from "../../helpers/jwt";

describe("INTEGRATION /api/instagram/posts (list)", () => {
  const fakeMeta = startFakeMetaServer(4111);

  beforeAll(async () => {
    await fakeMeta.start();
  });

  afterAll(async () => {
    await fakeMeta.stop();
  });

  it("deve listar posts do DB real (após sync)", async () => {
    const email = "diego+int-posts-list@looma.com";
    const igUserId = "IG_USER_LIST";

    // 🧹 limpeza defensiva
    await prisma.instagramPost.deleteMany({
      where: { instagramAccount: { igUserId } },
    });
    await prisma.instagramAccount.deleteMany({
      where: { igUserId },
    });
    await prisma.user.deleteMany({
      where: { email },
    });

    // 1️⃣ cria user REAL
    const user = await prisma.user.create({
      data: {
        email,
        name: "Test User",
        passwordHash: "test_hash",
      },
    });

    // 2️⃣ cria conta Instagram VÁLIDA PELO SCHEMA
    const ig = await prisma.instagramAccount.create({
      data: {
        userId: user.id,
        igUserId,
        pageAccessToken: "FAKE_TOKEN_OK", // 🔑 obrigatório para sync
        isConnected: true, // ✅ existe no schema
      },
    });

    // 3️⃣ marca essa conta como ativa para o usuário
    await prisma.user.update({
      where: { id: user.id },
      data: {
        activeInstagramAccountId: ig.id,
      },
    });

    // 4️⃣ faz sync primeiro
    const sync = await request(app)
      .post("/api/instagram/posts/sync?limit=20")
      .set("Authorization", makeAuthHeader(user.id))
      .set("x-test-user-id", user.id) // ✅ IMPORTANT: authMiddleware em test força esse userId
      .send({});

    expect(sync.status).toBeGreaterThanOrEqual(200);
    expect(sync.status).toBeLessThan(300);

    // 5️⃣ agora lista
    const res = await request(app)
      .get("/api/instagram/posts?limit=20")
      .set("Authorization", makeAuthHeader(user.id))
      .set("x-test-user-id", user.id); // ✅ IMPORTANT: authMiddleware em test força esse userId

    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);

    // valida retorno
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).toMatch(/post_|IG_USER_LIST/i);

    const posts = res.body?.posts ?? res.body?.data ?? res.body?.items ?? [];

    expect(posts.length).toBeGreaterThan(0);
  });
});