import request from "supertest";
import { app } from "../../../../src/presentation/http/app";
import { prisma } from "../../../../src/infrastructure/db/prismaClient";
import { makeAuthHeader } from "../../helpers/jwt";

describe("INTEGRATION /api/instagram/start", () => {
  it("deve exigir autenticação", async () => {
    const res = await request(app).get("/api/instagram/start");
    expect(res.status).toBe(401);
  });

  it("deve retornar { ok: true, url } quando redirect=false (default)", async () => {
    const user = await prisma.user.create({
      data: {
        email: "diego+ig-start@looma.com",
        name: "IG Start",
        passwordHash: "hash",
      },
    });

    const res = await request(app)
      .get("/api/instagram/start")
      .set("Authorization", makeAuthHeader(user.id))
      .set("x-test-user-id", user.id);

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        ok: true,
        url: expect.any(String),
      })
    );

    expect(res.body.url).toContain("http"); // contrato mínimo
  });

  it("deve responder 302 com Location quando redirect=true", async () => {
    const user = await prisma.user.create({
      data: {
        email: "diego+ig-start-redirect@looma.com",
        name: "IG Start Redirect",
        passwordHash: "hash",
      },
    });

    const res = await request(app)
      .get("/api/instagram/start?redirect=true")
      .set("Authorization", makeAuthHeader(user.id))
      .set("x-test-user-id", user.id);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBeTruthy();
  });
});