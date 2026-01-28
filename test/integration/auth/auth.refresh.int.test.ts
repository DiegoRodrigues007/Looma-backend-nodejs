import request from "supertest";
import bcrypt from "bcryptjs";
import { app } from "../../../src/presentation/http/app";
import { prisma } from "../../../src/infrastructure/db/prismaClient";

describe("INTEGRATION /api/auth/refresh", () => {
  let cookie: string[];

  beforeEach(async () => {
    await prisma.user.deleteMany();

    const passwordHash = await bcrypt.hash("12345678", 10);

    await prisma.user.create({
      data: {
        email: "diego+refresh@looma.com",
        name: "Diego Test",
        passwordHash,
      },
    });

    const login = await request(app).post("/api/auth/login").send({
      email: "diego+refresh@looma.com",
      password: "12345678",
    });

    const rawCookie = login.headers["set-cookie"];

    // 🔒 ASSERT + NARROWING REAL (TypeScript + runtime)
    expect(rawCookie).toBeDefined();

    if (Array.isArray(rawCookie)) {
      cookie = rawCookie;
    } else if (typeof rawCookie === "string") {
      cookie = [rawCookie];
    } else {
      throw new Error("Login não retornou cookie de autenticação");
    }
  });

  it("deve gerar novo token ao fazer refresh", async () => {
    const res = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", cookie);

    expect(res.status).toBe(200);

    // refresh deve retornar novo cookie
    expect(res.headers["set-cookie"]).toBeDefined();
  });

  it("deve retornar 401 sem cookie de refresh", async () => {
    const res = await request(app).post("/api/auth/refresh");
    expect(res.status).toBe(401);
  });
});
