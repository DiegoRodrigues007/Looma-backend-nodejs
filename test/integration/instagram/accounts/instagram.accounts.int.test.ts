import request from "supertest";
import { app } from "../../../../src/presentation/http/app";
import { prisma } from "../../../../src/infrastructure/db/prismaClient";
import { makeAuthHeader } from "../../helpers/jwt";

describe("INTEGRATION /api/instagram/accounts", () => {
  it("deve exigir autenticação", async () => {
    const res = await request(app).get("/api/instagram/accounts");
    expect(res.status).toBe(401);
  });

  it("deve retornar lista vazia quando não houver contas conectadas", async () => {
    const user = await prisma.user.create({
      data: {
        email: "diego+ig-accounts-empty@looma.com",
        name: "IG Accounts Empty",
        passwordHash: "hash",
      },
    });

    const res = await request(app)
      .get("/api/instagram/accounts")
      .set("Authorization", makeAuthHeader(user.id))
      .set("x-test-user-id", user.id);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        ok: true,
        activeInstagramAccountId: null,
        total: 0,
        accounts: [],
      })
    );
  });

  it("deve listar contas conectadas e marcar isActive corretamente (e setar active se necessário)", async () => {
    const user = await prisma.user.create({
      data: {
        email: "diego+ig-accounts@looma.com",
        name: "IG Accounts",
        passwordHash: "hash",
      },
    });

    const a1 = await prisma.instagramAccount.create({
      data: {
        userId: user.id,
        igUserId: "IG_ACC_1",
        pageAccessToken: "FAKE_PAGE_ACCESS_TOKEN_OK",
        isConnected: true,
      } as any,
    });

    const a2 = await prisma.instagramAccount.create({
      data: {
        userId: user.id,
        igUserId: "IG_ACC_2",
        pageAccessToken: "FAKE_PAGE_ACCESS_TOKEN_OK",
        isConnected: true,
      } as any,
    });

    const res = await request(app)
      .get("/api/instagram/accounts")
      .set("Authorization", makeAuthHeader(user.id))
      .set("x-test-user-id", user.id);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.total).toBe(2);
    expect(Array.isArray(res.body.accounts)).toBe(true);

    // active deve ter sido setado automaticamente (primeiro updatedAt desc)
    expect(res.body.activeInstagramAccountId).toBeTruthy();

    const active = res.body.accounts.find((x: any) => x.isActive === true);
    expect(active).toBeTruthy();
    expect(active.id).toBe(res.body.activeInstagramAccountId);

    // sanity: existem as duas contas
    const ids = res.body.accounts.map((x: any) => x.id);
    expect(ids).toEqual(expect.arrayContaining([a1.id, a2.id]));
  });
});