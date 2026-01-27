// test/integration/instagram/auth/instagram.refresh.int.test.ts
import request from "supertest";
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

function failWithDump(res: any, label: string): never {
  const payload = {
    label,
    status: res?.status,
    headers: res?.headers,
    body: res?.body,
    text: res?.text,
  };
  throw new Error(`[TEST][HTTP_DUMP]\n${JSON.stringify(payload, null, 2)}`);
}

describe("INTEGRATION /api/instagram/refresh", () => {
  let app: any;

  beforeAll(async () => {
    process.env.NODE_ENV = "test";

    // ✅ logs (opcional)
    process.env.IG_DEBUG_LOGS = "1";
    process.env.IG_DEBUG_LOGS_LEVEL = "debug";

    // ✅ ENV MÍNIMA pra composition NÃO criar provider undefined
    process.env.INSTAGRAM_CLIENT_ID =
      process.env.INSTAGRAM_CLIENT_ID ?? "FAKE_APP_ID";
    process.env.INSTAGRAM_CLIENT_SECRET =
      process.env.INSTAGRAM_CLIENT_SECRET ?? "FAKE_APP_SECRET";
    process.env.INSTAGRAM_REDIRECT_URI =
      process.env.INSTAGRAM_REDIRECT_URI ?? "http://localhost/ig/callback";

    // ✅ garante fake server antes de importar app
    process.env.INSTAGRAM_GRAPH_BASE_URL =
      process.env.INSTAGRAM_GRAPH_BASE_URL ?? "http://127.0.0.1:4111";
    process.env.INSTAGRAM_TOKEN_URL =
      process.env.INSTAGRAM_TOKEN_URL ??
      "http://127.0.0.1:4111/v21.0/oauth/access_token";

    jest.resetModules();
    const mod = await import("../../../../src/presentation/http/app");
    app = mod.app;
  });

  it("deve renovar token quando expirado", async () => {
    const email = "diego+int-ig-refresh@looma.com";

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

    const user = await prisma.user.create({
      data: { email, name: "Refresh User", passwordHash: "hash" },
    });

    const ig = await prisma.instagramAccount.create({
      data: {
        userId: user.id,
        igUserId: "IG_REFRESH",
        accessToken: "FAKE_TOKEN_OK",
        pageAccessToken: "FAKE_TOKEN_OK",
        expiresAt: new Date(Date.now() - 60_000),
        isConnected: true,
      } as any,
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { activeInstagramAccountId: ig.id },
    });

    const res = await request(app)
      .post("/api/instagram/refresh")
      .set("Authorization", makeAuthHeader(user.id))
      .set("x-test-user-id", user.id)
      .set("x-user-id", user.id)
      .set("Accept", "application/json")
      .send({});

    if (res.status >= 300) failWithDump(res, "refresh-expired");

    const updated = await prisma.instagramAccount.findUnique({
      where: { id: ig.id },
    });

    expect(updated?.accessToken).toBeTruthy();
  });

  it("deve exigir reauth quando refresh falhar", async () => {
    const email = "diego+int-ig-refresh-fail@looma.com";

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

    const user = await prisma.user.create({
      data: { email, name: "Refresh Fail User", passwordHash: "hash" },
    });

    const ig = await prisma.instagramAccount.create({
      data: {
        userId: user.id,
        igUserId: "IG_REFRESH_FAIL",
        accessToken: "INVALID_LONG_TOKEN",
        pageAccessToken: "INVALID_TOKEN",
        expiresAt: new Date(Date.now() - 60_000),
        isConnected: true,
      } as any,
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { activeInstagramAccountId: ig.id },
    });

    const res = await request(app)
      .post("/api/instagram/refresh")
      .set("Authorization", makeAuthHeader(user.id))
      .set("x-test-user-id", user.id)
      .set("x-user-id", user.id)
      .set("Accept", "application/json")
      .send({});

    if (![400, 401, 403, 502].includes(res.status)) {
      failWithDump(res, "refresh-fail-unexpected-status");
    }
  });
});