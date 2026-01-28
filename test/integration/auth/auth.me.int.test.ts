import request from "supertest";
import bcrypt from "bcryptjs";
import { app } from "../../../src/presentation/http/app";
import { prisma } from "../../../src/infrastructure/db/prismaClient";

describe("INTEGRATION /api/auth/me", () => {
  let accessToken: string;

  beforeEach(async () => {
    await prisma.user.deleteMany();

    const passwordHash = await bcrypt.hash("12345678", 10);

    await prisma.user.create({
      data: {
        email: "diego+me@looma.com",
        name: "Diego Test",
        passwordHash,
      } as any,
    });

    const login = await request(app).post("/api/auth/login").send({
      email: "diego+me@looma.com",
      password: "12345678",
    });

    expect(login.status).toBe(200);
    expect(login.body?.accessToken).toBeDefined();

    accessToken = login.body.accessToken;
  });

  it("deve retornar dados do usuário autenticado", async () => {
    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${accessToken}`);

    expect(res.status).toBe(200);

    expect(res.body).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        email: "diego+me@looma.com",
      })
    );
  });

  it("deve retornar 401 sem autenticação", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });
});