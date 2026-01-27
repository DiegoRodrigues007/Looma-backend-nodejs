import request from "supertest";
import { app } from "../../../../src/presentation/http/app";
import { prisma } from "../../../../src/infrastructure/db/prismaClient";
import { makeAuthHeader } from "../../helpers/jwt";

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

describe("INTEGRATION Instagram permissions (missing scopes)", () => {
  /**
   * ✅ IMPORTANTE:
   * - NÃO subir fake server aqui.
   * - NÃO setar INSTAGRAM_GRAPH_BASE_URL aqui.
   *
   * Isso já é responsabilidade do `test/jest.setup.integration.ts`,
   * para garantir que a env esteja setada ANTES de importar o `app`.
   */

  it("deve exigir reauth quando scopes obrigatórios estão faltando", async () => {
    const email = "diego+int-ig-scopes@looma.com";

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

    // 1️⃣ cria usuário
    const user = await prisma.user.create({
      data: {
        email,
        name: "Scopes User",
        passwordHash: "hash",
      },
    });

    // 2️⃣ cria conta IG com scopes INSUFICIENTES
    const ig = await prisma.instagramAccount.create({
      data: {
        userId: user.id,
        igUserId: "IG_SCOPES",
        pageAccessToken: "FAKE_TOKEN_OK",
        grantedScopes: "instagram_basic", // ❌ faltam scopes críticos
        isConnected: true,
      } as any,
    });

    // 3️⃣ marca conta como ativa
    await prisma.user.update({
      where: { id: user.id },
      data: { activeInstagramAccountId: ig.id },
    });

    // 4️⃣ executa ação que depende de permissões completas
    const res = await request(app)
      .post("/api/instagram/posts/sync?limit=5")
      .set("Authorization", makeAuthHeader(user.id))
      .set("x-test-user-id", user.id)
      .send({});

    // ❗ comportamento esperado:
    // - erro controlado
    // - backend sinaliza necessidade de reauth
    expect([400, 401, 403]).toContain(res.status);

    const bodyStr = JSON.stringify(res.body ?? {});
    expect(bodyStr).toMatch(/reauth|permiss|scope|auth/i);
  });
});