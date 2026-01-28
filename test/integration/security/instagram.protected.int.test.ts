import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../../../src/presentation/http/app";
import { prisma } from "../../../src/infrastructure/db/prismaClient";
import { makeAuthHeader } from "../helpers/jwt";

describe("SECURITY /api/instagram", () => {
  beforeAll(() => {
    // 🔐 força verificação REAL do JWT em testes
    process.env.AUTH_VERIFY_IN_TEST = "true";
  });

  beforeEach(async () => {
    await prisma.instagramAccount.deleteMany();
    await prisma.user.deleteMany();
  });

  const endpoints = [
    "/api/instagram/status",
    "/api/instagram/accounts",
    "/api/instagram/active",
  ];

  function invalidToken() {
    return jwt.sign({ sub: "x" }, "BAD_SECRET");
  }

  it.each(endpoints)("401 sem token → %s", async (url) => {
    const res = await request(app).get(url);
    expect(res.status).toBe(401);
  });

  it.each(endpoints)("401/403 token inválido → %s", async (url) => {
    const res = await request(app)
      .get(url)
      .set("Authorization", `Bearer ${invalidToken()}`);

    expect([401, 403]).toContain(res.status);
  });

  it.each(endpoints)("200 token válido → %s", async (url) => {
    // 👤 usuário válido (contrato COMPLETO do Prisma)
    const user = await prisma.user.create({
      data: {
        email: "secure+ig@looma.com",
        name: "Security Instagram User",
        passwordHash: "TEST_PASSWORD_HASH",
      },
    });

    const res = await request(app)
      .get(url)
      .set("Authorization", makeAuthHeader(user.id));

    expect(res.status).toBe(200);
  });

  it("401 no disconnect sem token", async () => {
    const res = await request(app).post("/api/instagram/disconnect");
    expect(res.status).toBe(401);
  });
});