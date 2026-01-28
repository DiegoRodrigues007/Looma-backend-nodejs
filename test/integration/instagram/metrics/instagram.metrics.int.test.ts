import request from "supertest";
import { app } from "../../../../src/presentation/http/app";
import { prisma } from "../../../../src/infrastructure/db/prismaClient";
import { makeAuthHeader } from "../../helpers/jwt";

describe("INTEGRATION /api/instagram/metrics", () => {
  it("deve exigir autenticação", async () => {
    const res = await request(app).get("/api/instagram/metrics?from=2026-01-01&to=2026-01-02");
    expect(res.status).toBe(401);
  });

  it("deve validar range (400) quando faltar from/to", async () => {
    const user = await prisma.user.create({
      data: {
        email: "diego+ig-metrics@looma.com",
        name: "IG Metrics",
        passwordHash: "hash",
      },
    });

    const res = await request(app)
      .get("/api/instagram/metrics?from=2026-01-01") // faltou to
      .set("Authorization", makeAuthHeader(user.id))
      .set("x-test-user-id", user.id);

    expect(res.status).toBe(400);
  });

  it("deve validar range (400) quando from > to", async () => {
    const user = await prisma.user.create({
      data: {
        email: "diego+ig-metrics2@looma.com",
        name: "IG Metrics2",
        passwordHash: "hash",
      },
    });

    const res = await request(app)
      .get("/api/instagram/metrics?from=2026-01-10&to=2026-01-01")
      .set("Authorization", makeAuthHeader(user.id))
      .set("x-test-user-id", user.id);

    expect(res.status).toBe(400);
  });
});