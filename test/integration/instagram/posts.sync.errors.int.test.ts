import request from "supertest";
import { app } from "../../../src/presentation/http/app";
import { prisma } from "../../../src/infrastructure/db/prismaClient";
import { makeAuthHeader } from "../helpers/jwt";

describe("INTEGRATION /api/instagram/posts/sync (errors)", () => {
  it("deve retornar 401 quando não envia Authorization", async () => {
    const res = await request(app).post("/api/instagram/posts/sync?limit=20");
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).toMatch(/Token não informado|Não autenticado/i);
  });

  it("deve retornar 404 quando usuário não tem conta IG conectada", async () => {
    const email = "diego+int-sync-no-account@looma.com";

    // limpa
    await prisma.user.deleteMany({ where: { email } as any });

    // cria user SEM instagramAccount
    const user = await prisma.user.create({
      data: { email, name: "User No IG", passwordHash: "hash" },
    });

    const res = await request(app)
      .post("/api/instagram/posts/sync?limit=20")
      .set("Authorization", makeAuthHeader(user.id))
      .set("x-test-user-id", user.id)
      .send({});

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).toMatch(/Conta do Instagram não encontrada/i);
  });

  it("deve retornar 502 quando o provider (Meta) está fora do ar", async () => {
    // força base URL para um porto que NÃO tem fakeMetaServer rodando
    const old = process.env.INSTAGRAM_GRAPH_BASE_URL;
    process.env.INSTAGRAM_GRAPH_BASE_URL = "http://127.0.0.1:4999";

    const email = "diego+int-sync-provider-down@looma.com";
    const igUserId = "IG_USER_PROVIDER_DOWN";

    // limpeza
    await prisma.instagramPost.deleteMany({
      where: { instagramAccount: { igUserId } } as any,
    });
    await prisma.instagramAccount.deleteMany({ where: { igUserId } as any });
    await prisma.user.deleteMany({ where: { email } as any });

    // cria user + conta IG conectada (com token fake)
    const user = await prisma.user.create({
      data: { email, name: "User Provider Down", passwordHash: "hash" },
    });

    const ig = await prisma.instagramAccount.create({
      data: {
        userId: user.id,
        igUserId,
        pageAccessToken: "FAKE_TOKEN_OK",
        isConnected: true,
      } as any,
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { activeInstagramAccountId: ig.id },
    });

    const res = await request(app)
      .post("/api/instagram/posts/sync?limit=20")
      .set("Authorization", makeAuthHeader(user.id))
      .set("x-test-user-id", user.id)
      .send({});

    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).toMatch(/Falha ao consultar a Meta/i);

    // restaura env
    process.env.INSTAGRAM_GRAPH_BASE_URL = old;
  });
});