import request from "supertest";
import { app } from "../../../src/presentation/http/app";
import { prisma } from "../../../src/infrastructure/db/prismaClient";

describe("INTEGRATION /api/auth/register", () => {
  beforeEach(async () => {
    await prisma.user.deleteMany();
  });

  it("deve registrar um novo usuário com sucesso", async () => {
    const res = await request(app).post("/api/auth/register").send({
      email: "diego+register@looma.com",
      name: "Diego Register",
      password: "12345678",
    });

    expect(res.status).toBe(201);

    expect(res.body).toEqual(
      expect.objectContaining({
        accessToken: expect.any(String),
        expiresUtc: expect.any(String),
        refreshToken: expect.any(String),
      })
    );

    expect(res.body).not.toHaveProperty("password");
    expect(res.body).not.toHaveProperty("passwordHash");

    const user = await prisma.user.findUnique({
      where: { email: "diego+register@looma.com" },
    });

    expect(user).toBeTruthy();
    expect(user?.passwordHash).toBeTruthy();
    expect(user?.name).toBeTruthy();
  });

  it("deve falhar ao tentar registrar email duplicado", async () => {
    await prisma.user.create({
      data: {
        email: "diego+dup@looma.com",
        name: "Diego Dup",
        passwordHash: "HASH_FAKE",
      } as any,
    });

    const res = await request(app).post("/api/auth/register").send({
      email: "diego+dup@looma.com",
      name: "Diego Dup Again",
      password: "12345678",
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});