import request from "supertest";
import { app } from "../../../../src/presentation/http/app";
import { prisma } from "../../../../src/infrastructure/db/prismaClient";
import { startFakeMetaServer } from "../../helpers/fakeMetaServer";

describe("INTEGRATION /api/instagram/callback", () => {
  const fakeMeta = startFakeMetaServer(4111);

  beforeAll(async () => {
    await fakeMeta.start();
  });

  afterAll(async () => {
    await fakeMeta.stop();
  });

  it("deve concluir login IG (code → short → long token) e salvar conta (redirect 302)", async () => {
    const email = "diego+int-ig-callback@looma.com";

    // 🧹 limpeza defensiva
    await prisma.instagramAccount.deleteMany({
      where: { user: { email } } as any,
    });
    await prisma.user.deleteMany({ where: { email } as any });

    // cria usuário
    const user = await prisma.user.create({
      data: {
        email,
        name: "IG Callback User",
        passwordHash: "hash",
      },
    });

    // chama callback OAuth
    const res = await request(app)
      .get("/api/instagram/callback")
      .query({
        code: "FAKE_CODE_OK",
        state: JSON.stringify({ userId: user.id }),
      });

    // ✅ OAuth correto = redirect
    expect(res.status).toBe(302);
    expect(res.headers.location).toBeTruthy();

    // ✅ valida efeito colateral REAL: conta salva no banco
    const accounts = await prisma.instagramAccount.findMany({
      where: { userId: user.id },
    });

    expect(accounts.length).toBeGreaterThan(0);
    expect(accounts[0].isConnected).toBe(true);
    expect(accounts[0].pageAccessToken).toBeTruthy();
  });

  it("deve redirecionar com erro quando code é inválido (redirect 302)", async () => {
    const res = await request(app)
      .get("/api/instagram/callback")
      .query({
        code: "INVALID_CODE",
        state: JSON.stringify({ userId: "invalid-user" }),
      });

    // ❗ Mesmo erro OAuth = redirect (UX decide o erro)
    expect(res.status).toBe(302);
    expect(res.headers.location).toBeTruthy();

    // opcional: garante que NÃO criou conta
    const accounts = await prisma.instagramAccount.findMany({
      where: { igUserId: "INVALID_CODE" } as any,
    });

    expect(accounts.length).toBe(0);
  });
});