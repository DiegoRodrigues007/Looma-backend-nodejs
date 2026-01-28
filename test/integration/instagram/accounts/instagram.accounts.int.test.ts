import request from "supertest";
import { app } from "../../../../src/presentation/http/app";
import { prisma } from "../../../../src/infrastructure/db/prismaClient";
import { makeAuthHeader } from "../../helpers/jwt";
import { expectAccountsResponse, expectAccountItem } from "../../helpers/contract";

describe("INTEGRATION /api/instagram/accounts", () => {
  beforeEach(async () => {
    // limpeza forte por FK (ordem)
    await prisma.instagramBackfillJob.deleteMany().catch(() => {});
    await prisma.instagramAccount.deleteMany();
    await prisma.user.deleteMany();
  });

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

    // ✅ asserts de contrato (shape)
    expectAccountsResponse(res.body);

    // ✅ asserts funcionais (conteúdo)
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

    // ✅ asserts de contrato (shape)
    expectAccountsResponse(res.body);
    expect(res.body.accounts.length).toBe(2);
    res.body.accounts.forEach((acc: any) => expectAccountItem(acc));

    // ✅ asserts funcionais (conteúdo)
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

  it("não deve permitir user A setar como ativa uma conta do user B (404)", async () => {
    const userA = await prisma.user.create({
      data: {
        email: "diego+ig-accounts-userA@looma.com",
        name: "IG Accounts UserA",
        passwordHash: "hash",
      } as any,
    });

    const userB = await prisma.user.create({
      data: {
        email: "diego+ig-accounts-userB@looma.com",
        name: "IG Accounts UserB",
        passwordHash: "hash",
      } as any,
    });

    const accB = await prisma.instagramAccount.create({
      data: {
        userId: userB.id,
        igUserId: "IG_OTHER_USER",
        pageAccessToken: "FAKE_PAGE_ACCESS_TOKEN_OK",
        isConnected: true,
      } as any,
    });

    // ✅ tenta setar como ativa a conta do userB usando auth do userA
    const res = await request(app)
      .post("/api/instagram/active")
      .set("Authorization", makeAuthHeader(userA.id))
      .set("x-test-user-id", userA.id)
      .send({ instagramAccountId: accB.id });

    expect(res.status).toBe(404);

    // ✅ contrato mínimo do erro público (sem exigir campos extras)
    expect(res.body).toEqual(expect.objectContaining({ ok: false }));
    expect(res.body?.ok).toBe(false);

    // ✅ garante que userA NÃO ficou com active setado
    const reloadedA = await prisma.user.findUnique({
      where: { id: userA.id },
      select: { activeInstagramAccountId: true },
    });

    expect(reloadedA?.activeInstagramAccountId).toBeNull();
  });
});