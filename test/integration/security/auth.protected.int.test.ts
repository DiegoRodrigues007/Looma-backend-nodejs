import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../../../src/presentation/http/app";
import { prisma } from "../../../src/infrastructure/db/prismaClient";
import { makeAuthHeader } from "../helpers/jwt";

describe("SECURITY /api/auth/me", () => {
  beforeAll(() => {
    // 🔐 força verificação REAL do JWT em ambiente de teste
    process.env.AUTH_VERIFY_IN_TEST = "true";
  });

  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  function invalidToken(overrides?: Partial<jwt.SignOptions>) {
    return jwt.sign(
      { sub: "fake-user-id" },
      "WRONG_SECRET",
      {
        issuer: "wrong-issuer",
        audience: "wrong-audience",
        ...(overrides ?? {}),
      }
    );
  }

  it.each([
    { name: "sem token", header: undefined, expected: 401 },
    { name: "token malformado", header: "Bearer", expected: 401 },
    { name: "token lixo", header: "Bearer abc", expected: 401 },
    {
      name: "token assinado com secret errado",
      header: `Bearer ${invalidToken()}`,
      expected: 401,
    },
  ])("→ $name", async ({ header, expected }) => {
    const req = request(app).get("/api/auth/me");
    if (header) req.set("Authorization", header);

    const res = await req;
    expect(res.status).toBe(expected);
  });

  it("200 com token válido", async () => {
    // 👤 usuário válido (contrato COMPLETO do Prisma)
    const user = await prisma.user.create({
      data: {
        email: "secure+me@looma.com",
        name: "Security Auth User",
        passwordHash: "TEST_PASSWORD_HASH",
      },
    });

    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", makeAuthHeader(user.id));

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        id: user.id,
        email: user.email,
      })
    );
  });
});