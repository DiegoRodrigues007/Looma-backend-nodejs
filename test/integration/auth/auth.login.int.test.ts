import request from "supertest";
import bcrypt from "bcryptjs";
import { app } from "../../../src/presentation/http/app";
import { prisma } from "../../../src/infrastructure/db/prismaClient";

describe("INTEGRATION /api/auth/login", () => {
  beforeEach(async () => {
    await prisma.user.deleteMany();

    const passwordHash = await bcrypt.hash("12345678", 10);

    await prisma.user.create({
      data: {
        email: "diego+login@looma.com",
        name: "Diego Test",
        passwordHash,
      },
    });
  });

  it("deve autenticar usuário com credenciais válidas", async () => {
    const res = await request(app).post("/api/auth/login").send({
      email: "diego+login@looma.com",
      password: "12345678",
    });

    expect(res.status).toBe(200);

    // token/cookie
    expect(res.headers["set-cookie"]).toBeDefined();

    // ✅ contrato mínimo (sua API retorna accessToken/expiresUtc/refreshToken)
    expect(res.body).toEqual(
      expect.objectContaining({
        accessToken: expect.any(String),
        expiresUtc: expect.any(String),
        refreshToken: expect.any(String),
      })
    );
  });

  it("deve retornar 401 com senha incorreta", async () => {
    const res = await request(app).post("/api/auth/login").send({
      email: "diego+login@looma.com",
      password: "senha_errada",
    });

    // ✅ com o controller ajustado, credenciais inválidas = 401
    expect(res.status).toBe(401);
  });

  it("deve retornar 401 para usuário inexistente", async () => {
    const res = await request(app).post("/api/auth/login").send({
      email: "naoexiste@looma.com",
      password: "12345678",
    });

    // ✅ com o controller ajustado, credenciais inválidas = 401
    expect(res.status).toBe(401);
  });
});