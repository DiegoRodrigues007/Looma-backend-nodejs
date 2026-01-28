import request from "supertest";
import { app } from "../../../../src/presentation/http/app";
import { prisma } from "../../../../src/infrastructure/db/prismaClient";
import { makeAuthHeader } from "../../helpers/jwt";

describe("INTEGRATION /api/instagram/active", () => {
  it("deve exigir autenticação", async () => {
    const res = await request(app).get("/api/instagram/active");
    expect(res.status).toBe(401);
  });

  it("deve retornar account=null se não houver contas conectadas", async () => {
    const user = await prisma.user.create({
      data: {
        email: "diego+ig-active-empty@looma.com",
        name: "IG Active Empty",
        passwordHash: "hash",
      },
    });

    const res = await request(app)
      .get("/api/instagram/active")
      .set("Authorization", makeAuthHeader(user.id))
      .set("x-test-user-id", user.id);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        ok: true,
        activeInstagramAccountId: null,
        account: null,
      })
    );
  });

  it("deve selecionar automaticamente a conta conectada mais recente quando active for null", async () => {
    const user = await prisma.user.create({
      data: {
        email: "diego+ig-active@looma.com",
        name: "IG Active",
        passwordHash: "hash",
      },
    });

    const acc = await prisma.instagramAccount.create({
      data: {
        userId: user.id,
        igUserId: "IG_ACTIVE_1",
        pageAccessToken: "FAKE_PAGE_ACCESS_TOKEN_OK",
        isConnected: true,
      } as any,
    });

    const res = await request(app)
      .get("/api/instagram/active")
      .set("Authorization", makeAuthHeader(user.id))
      .set("x-test-user-id", user.id);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        ok: true,
        activeInstagramAccountId: acc.id,
        account: expect.objectContaining({
          id: acc.id,
          igUserId: "IG_ACTIVE_1",
          isConnected: true,
        }),
      })
    );

    const reloaded = await prisma.user.findUnique({
      where: { id: user.id },
      select: { activeInstagramAccountId: true },
    });
    expect(reloaded?.activeInstagramAccountId).toBe(acc.id);
  });

  it("POST /active deve definir a conta ativa (fallback do router) e retornar isActive", async () => {
    const user = await prisma.user.create({
      data: {
        email: "diego+ig-active-post@looma.com",
        name: "IG Active Post",
        passwordHash: "hash",
      },
    });

    const a1 = await prisma.instagramAccount.create({
      data: {
        userId: user.id,
        igUserId: "IG_ACTIVE_A1",
        pageAccessToken: "FAKE_PAGE_ACCESS_TOKEN_OK",
        isConnected: true,
      } as any,
    });

    const a2 = await prisma.instagramAccount.create({
      data: {
        userId: user.id,
        igUserId: "IG_ACTIVE_A2",
        pageAccessToken: "FAKE_PAGE_ACCESS_TOKEN_OK",
        isConnected: true,
      } as any,
    });

    const res = await request(app)
      .post("/api/instagram/active")
      .set("Authorization", makeAuthHeader(user.id))
      .set("x-test-user-id", user.id)
      .send({ instagramAccountId: a2.id });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        ok: true,
        activeInstagramAccountId: a2.id,
        account: expect.objectContaining({
          id: a2.id,
          igUserId: "IG_ACTIVE_A2",
        }),
      })
    );

    const reloaded = await prisma.user.findUnique({
      where: { id: user.id },
      select: { activeInstagramAccountId: true },
    });
    expect(reloaded?.activeInstagramAccountId).toBe(a2.id);

    // sanity: a1 não virou ativo
    expect(reloaded?.activeInstagramAccountId).not.toBe(a1.id);
  });
});