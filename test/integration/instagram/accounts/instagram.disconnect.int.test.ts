import request from "supertest";
import { app } from "../../../../src/presentation/http/app";
import { prisma } from "../../../../src/infrastructure/db/prismaClient";
import { makeAuthHeader } from "../../helpers/jwt";

describe("INTEGRATION /api/instagram/disconnect", () => {
  it("deve exigir autenticação", async () => {
    const res = await request(app).post("/api/instagram/disconnect").send({});
    expect(res.status).toBe(401);
  });

  it("deve desconectar a conta ativa (204) e limpar campos sensíveis", async () => {
    const user = await prisma.user.create({
      data: {
        email: "diego+ig-disconnect@looma.com",
        name: "IG Disconnect",
        passwordHash: "hash",
      },
    });

    const acc = await prisma.instagramAccount.create({
      data: {
        userId: user.id,
        igUserId: "IG_DISC_1",
        isConnected: true,
        accessToken: "TOKEN",
        pageAccessToken: "PAGE_TOKEN",
        facebookPageId: "PAGE_1",
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      } as any,
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { activeInstagramAccountId: acc.id },
    });

    const res = await request(app)
      .post("/api/instagram/disconnect")
      .set("Authorization", makeAuthHeader(user.id))
      .set("x-test-user-id", user.id)
      .send({});

    expect([204, 200]).toContain(res.status);

    const updated = await prisma.instagramAccount.findUnique({
      where: { id: acc.id },
    });

    expect(updated?.isConnected).toBe(false);
    expect(updated?.accessToken).toBeNull();
    expect(updated?.pageAccessToken).toBeNull();
    expect(updated?.expiresAt).toBeNull();
    expect(updated?.facebookPageId).toBeNull();

    const userReload = await prisma.user.findUnique({
      where: { id: user.id },
      select: { activeInstagramAccountId: true },
    });

    expect(userReload?.activeInstagramAccountId).toBeNull();
  });

  it("deve retornar 404 se instagramAccountId não for do usuário", async () => {
    const u1 = await prisma.user.create({
      data: { email: "diego+u1@looma.com", name: "U1", passwordHash: "hash" },
    });

    const u2 = await prisma.user.create({
      data: { email: "diego+u2@looma.com", name: "U2", passwordHash: "hash" },
    });

    const accOther = await prisma.instagramAccount.create({
      data: {
        userId: u2.id,
        igUserId: "IG_OTHER",
        pageAccessToken: "FAKE_PAGE_ACCESS_TOKEN_OK",
        isConnected: true,
      } as any,
    });

    const res = await request(app)
      .post("/api/instagram/disconnect")
      .set("Authorization", makeAuthHeader(u1.id))
      .set("x-test-user-id", u1.id)
      .send({ instagramAccountId: accOther.id });

    expect(res.status).toBe(404);
  });
});