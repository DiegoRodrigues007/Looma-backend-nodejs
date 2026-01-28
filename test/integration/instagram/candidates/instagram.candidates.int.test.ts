import request from "supertest";
import { app } from "../../../../src/presentation/http/app";
import { prisma } from "../../../../src/infrastructure/db/prismaClient";
import { makeAuthHeader } from "../../helpers/jwt";

describe("INTEGRATION /api/instagram/candidates", () => {
  it("deve exigir autenticação", async () => {
    const res = await request(app).get("/api/instagram/candidates");
    expect(res.status).toBe(401);
  });

  it("deve retornar lista de candidatos e NÃO expor pageAccessToken", async () => {
    const user = await prisma.user.create({
      data: {
        email: "diego+ig-cand@looma.com",
        name: "IG Cand",
        passwordHash: "hash",
      },
    });

    const selectionId = "SEL_1";

    await prisma.instagramCandidate.createMany({
      data: [
        {
          userId: user.id,
          selectionId,
          igUserId: "IG_USER_1",
          username: "fake_ig_user",
          accountType: "BUSINESS",
          facebookPageId: "PAGE_1",
          facebookPageName: "Fake Page",
          pageAccessToken: "SUPER_SECRET_DO_NOT_LEAK",
          source: "graph",
        },
      ],
    });

    const res = await request(app)
      .get(`/api/instagram/candidates?selectionId=${selectionId}`)
      .set("Authorization", makeAuthHeader(user.id))
      .set("x-test-user-id", user.id);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        ok: true,
        selectionId,
        total: 1,
        candidates: expect.any(Array),
      })
    );

    const c = res.body.candidates[0];
    expect(c).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        selectionId,
        igUserId: "IG_USER_1",
        facebookPageId: "PAGE_1",
      })
    );

    // 🔒 segurança: não pode vazar token
    expect(c).not.toHaveProperty("pageAccessToken");
  });

  it("quando selectionId não for enviado, deve usar o último selectionId do usuário", async () => {
    const user = await prisma.user.create({
      data: {
        email: "diego+ig-cand-last@looma.com",
        name: "IG Cand Last",
        passwordHash: "hash",
      },
    });

    await prisma.instagramCandidate.createMany({
      data: [
        {
          userId: user.id,
          selectionId: "SEL_OLD",
          igUserId: "IG_OLD",
          facebookPageId: "PAGE_OLD",
          pageAccessToken: "SECRET",
          source: "graph",
        },
        {
          userId: user.id,
          selectionId: "SEL_NEW",
          igUserId: "IG_NEW",
          facebookPageId: "PAGE_NEW",
          pageAccessToken: "SECRET",
          source: "graph",
        },
      ],
    });

    const res = await request(app)
      .get("/api/instagram/candidates")
      .set("Authorization", makeAuthHeader(user.id))
      .set("x-test-user-id", user.id);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.selectionId).toBeTruthy();
    expect(res.body.total).toBeGreaterThan(0);
  });
});