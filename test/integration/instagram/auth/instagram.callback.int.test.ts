import request from "supertest";
import { app } from "../../../../src/presentation/http/app";
import { prisma } from "../../../../src/infrastructure/db/prismaClient";

// ✅ IMPORTANTE: o callback espera "state" ASSINADO e com { uid: ... }
import { signState } from "../../../../src/presentation/http/instagram/instagramState";

async function safeDeleteMany(model: any, args: any) {
  if (model && typeof model.deleteMany === "function") {
    return model.deleteMany(args);
  }
  throw new Error(
    `Prisma model não tem deleteMany (prisma está mockado no teste de integração?). Model keys: ${Object.keys(
      model ?? {}
    ).join(", ")}`
  );
}

describe("INTEGRATION /api/instagram/callback", () => {
  /**
   * ✅ IMPORTANTE:
   * - NÃO subir fake server aqui.
   * - NÃO setar INSTAGRAM_GRAPH_BASE_URL aqui.
   *
   * Isso já é responsabilidade do `test/jest.setup.integration.ts`,
   * para garantir que a env esteja setada ANTES de importar o `app`
   * (evita o client congelar `https://graph.facebook.com/...`).
   */

  it("deve concluir login IG (code → short → long token) e salvar conta (redirect 302)", async () => {
    const email = "diego+int-ig-callback@looma.com";

    // 🧹 limpeza defensiva (ordem: dependentes -> pai)
    await safeDeleteMany(prisma.instagramBackfillJob as any, {
      where: { user: { email } } as any,
    }).catch(() => undefined);

    await safeDeleteMany(prisma.instagramPost as any, {
      where: { user: { email } } as any,
    }).catch(() => undefined);

    await safeDeleteMany(prisma.instagramAccount as any, {
      where: { user: { email } } as any,
    }).catch(() => undefined);

    await safeDeleteMany(prisma.user as any, { where: { email } as any }).catch(
      () => undefined
    );

    // cria usuário
    const user = await prisma.user.create({
      data: {
        email,
        name: "IG Callback User",
        passwordHash: "hash",
      },
    });

    // ✅ state precisa ser assinado e usar "uid"
    const state = signState(JSON.stringify({ uid: user.id }));

    // chama callback OAuth
    const res = await request(app)
      .get("/api/instagram/callback")
      // ✅ opcional, mas deixa o teste igual ao fluxo real: controller também tenta ler uid do cookie
      .set("Cookie", [`ig_login_uid=${user.id}`])
      .query({
        code: "FAKE_CODE_OK",
        state,
      });

    // ✅ OAuth correto = redirect
    expect(res.status).toBe(302);
    expect(res.headers.location).toBeTruthy();

    // ✅ valida efeito colateral REAL: conta salva no banco
    const accounts = await prisma.instagramAccount.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" as any },
    });

    expect(accounts.length).toBeGreaterThan(0);
    expect(accounts[0].isConnected).toBe(true);
    expect(accounts[0].pageAccessToken).toBeTruthy();
  });

  it("deve redirecionar com erro quando code é inválido (redirect 302)", async () => {
    // ✅ mantém o formato esperado (state assinado com uid),
    // mas usa um uid inválido só pra cair no fluxo de erro
    const state = signState(JSON.stringify({ uid: "invalid-user" }));

    const res = await request(app)
      .get("/api/instagram/callback")
      .set("Cookie", [`ig_login_uid=invalid-user`])
      .query({
        code: "INVALID_CODE",
        state,
      });

    // ❗ Mesmo erro OAuth = redirect (UX decide o erro)
    expect(res.status).toBe(302);
    expect(res.headers.location).toBeTruthy();

    const accounts = await prisma.instagramAccount.findMany({
      where: { igUserId: "INVALID_CODE" } as any,
    });

    expect(accounts.length).toBe(0);
  });
});