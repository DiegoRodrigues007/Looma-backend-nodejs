import request from "supertest";
import bcrypt from "bcryptjs";
import { app } from "../../../src/presentation/http/app";
import { prisma } from "../../../src/infrastructure/db/prismaClient";

describe("INTEGRATION /api/auth/logout", () => {
  let cookie: string[];

  beforeEach(async () => {
    await prisma.user.deleteMany();

    const passwordHash = await bcrypt.hash("12345678", 10);

    await prisma.user.create({
      data: {
        email: "diego+logout@looma.com",
        name: "Diego Test",
        passwordHash,
      },
    });

    const login = await request(app).post("/api/auth/login").send({
      email: "diego+logout@looma.com",
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

  it("deve encerrar sessão do usuário", async () => {
    const res = await request(app)
      .post("/api/auth/logout")
      .set("Cookie", cookie);

    expect(res.status).toBe(200);

    // tenta acessar /me depois do logout
    const me = await request(app).get("/api/auth/me").set("Cookie", cookie);

    expect(me.status).toBe(401);
  });
});
