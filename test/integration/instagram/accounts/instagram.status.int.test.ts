import request from "supertest";
import { app } from "../../../../src/presentation/http/app";
import { prisma } from "../../../../src/infrastructure/db/prismaClient";
import { makeAuthHeader } from "../../helpers/jwt";

describe("INTEGRATION /api/instagram/status", () => {
  it("deve exigir autenticação", async () => {
    const res = await request(app).get("/api/instagram/status");
    expect(res.status).toBe(401);
  });

  it("deve retornar connected=false quando usuário não tem contas", async () => {
    const user = await prisma.user.create({
      data: {
        email: "diego+ig-status-empty@looma.com",
        name: "IG Status Empty",
        passwordHash: "hash",
      },
    });

    const res = await request(app)
      .get("/api/instagram/status")
      .set("Authorization", makeAuthHeader(user.id))
      .set("x-test-user-id", user.id);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        ok: true,
        connected: false,
        totalAccounts: 0,
        activeInstagramAccountId: null,
        account: null,
      })
    );
  });

  it("deve retornar connected=true e definir active automaticamente se não existir", async () => {
    const user = await prisma.user.create({
      data: {
        email: "diego+ig-status@looma.com",
        name: "IG Status",
        passwordHash: "hash",
      },
    });

    const acc = await prisma.instagramAccount.create({
      data: {
        userId: user.id,
        igUserId: "IG_STATUS_1",
        pageAccessToken: "FAKE_PAGE_ACCESS_TOKEN_OK",
        isConnected: true,
      } as any,
    });

    const res = await request(app)
      .get("/api/instagram/status")
      .set("Authorization", makeAuthHeader(user.id))
      .set("x-test-user-id", user.id);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        ok: true,
        connected: true,
        totalAccounts: 1,
        activeInstagramAccountId: acc.id,
        account: expect.objectContaining({
          id: acc.id,
          igUserId: "IG_STATUS_1",
          isConnected: true,
        }),
      })
    );

    // efeito no banco: activeInstagramAccountId setado
    const reloaded = await prisma.user.findUnique({
      where: { id: user.id },
      select: { activeInstagramAccountId: true },
    });

    expect(reloaded?.activeInstagramAccountId).toBe(acc.id);
  });
});