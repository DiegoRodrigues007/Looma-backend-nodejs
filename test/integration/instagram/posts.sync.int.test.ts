import request from "supertest";
import { app } from "../../../src/presentation/http/app";
import { prisma } from "../../../src/infrastructure/db/prismaClient";

import { startFakeMetaServer } from "../helpers/fakeMetaServer";
import { makeAuthHeader } from "../helpers/jwt";
import { createActiveBusinessInstagramAccount } from "../helpers/createActiveBusinessInstagramAccount";

describe("INTEGRATION /api/instagram/posts/sync", () => {
  const fakeMeta = startFakeMetaServer(4111);

  beforeAll(async () => {
    await fakeMeta.start();
  });

  afterAll(async () => {
    await fakeMeta.stop();
  });

  it("deve sincronizar posts e persistir no Postgres real", async () => {
    const email = "diego+int-posts-sync@looma.com";
    const igUserId = "IG_USER_1"; // precisa bater com o fakeMetaServer

    // ✅ cria user + conta IG conectada e ativa (helper centralizado)
    const { user, ig } = await createActiveBusinessInstagramAccount({
      prisma,
      email,
      igUserId,
    });

    // 1️⃣ chama endpoint REAL (JWT com user.id)
    const res = await request(app)
      .post("/api/instagram/posts/sync?limit=20")
      .set("Authorization", makeAuthHeader(user.id))
      .set("x-test-user-id", user.id) // ✅ IMPORTANT: authMiddleware em test força esse userId
      .send({});

    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);

    // 2️⃣ valida persistência REAL no banco
    const posts = await prisma.instagramPost.findMany({
      where: { instagramAccountId: ig.id },
      orderBy: { publishedAt: "desc" },
    });

    expect(posts.length).toBeGreaterThanOrEqual(2);

    // ✅ no schema o ID do post do Instagram é igMediaId
    const idsStr = JSON.stringify(posts.map((p) => p.igMediaId));
    expect(idsStr).toMatch(/post_IG_USER_1_1/);
    expect(idsStr).toMatch(/post_IG_USER_1_2/);
  });
});