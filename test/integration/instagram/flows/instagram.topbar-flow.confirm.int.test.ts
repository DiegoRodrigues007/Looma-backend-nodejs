import request from "supertest";
import { prisma } from "../../../../src/infrastructure/db/prismaClient";
import { makeAuthHeader } from "../../helpers/jwt";
import { createTestUser } from "../../helpers/igTestFactory";
import { startFakeMetaServer } from "../../helpers/fakeMetaServer";

describe("INTEGRATION Topbar Golden Flow (candidates + confirm)", () => {
  const fakeMeta = startFakeMetaServer(4111);

  const OLD_AUTO_CONFIRM = process.env.IG_LOGIN_AUTO_CONFIRM_SINGLE;

  // vamos carregar o app DEPOIS de setar o env corretamente
  let app: any;
  let signState: (v: string) => string;

  beforeAll(async () => {
    await fakeMeta.start();

    /**
     * ✅ CRÍTICO:
     * autoConfirmSingle é "static readonly" e é avaliado no import do módulo.
     * Então o env precisa estar setado ANTES de importar o app/composition.
     */
    process.env.IG_LOGIN_AUTO_CONFIRM_SINGLE = "false";

    // força o Jest a recarregar os módulos respeitando o env acima
    jest.resetModules();

    const modApp = await import("../../../../src/presentation/http/app");
    app = modApp.app;

    const modState = await import("../../../../src/presentation/http/instagram/instagramState");
    signState = modState.signState;
  });

  afterAll(async () => {
    await fakeMeta.stop();

    // restaura env pra não vazar pra outros testes
    if (OLD_AUTO_CONFIRM === undefined) delete process.env.IG_LOGIN_AUTO_CONFIRM_SINGLE;
    else process.env.IG_LOGIN_AUTO_CONFIRM_SINGLE = OLD_AUTO_CONFIRM;
  });

  beforeEach(async () => {
    await prisma.instagramAccountDailyMetrics.deleteMany();
    await prisma.instagramCandidate.deleteMany();
    await prisma.instagramAccount.deleteMany();
    await prisma.user.deleteMany();
  });

  it("candidates -> confirm -> status/accounts/active consistentes", async () => {
    const user = await createTestUser("diego+topbar-confirm@looma.com");

    // ✅ FIX DO 401: state assinado precisa ser JSON { uid }
    const state = signState(JSON.stringify({ uid: user.id }));

    const cb = await request(app)
      .get("/api/instagram/callback")
      .query({ code: "CODE_TOPBAR_CONFIRM", state })
      .set("Accept", "application/json");

    expect(cb.status).toBe(200);
    expect(cb.body).toEqual(
      expect.objectContaining({
        ok: true,
        status: "choose_required",
        selectionId: expect.any(String),
      })
    );

    const selectionId: string = cb.body.selectionId;

    // 2) GET candidates
    const cand = await request(app)
      .get(`/api/instagram/candidates?selectionId=${selectionId}`)
      .set("Authorization", makeAuthHeader(user.id));

    expect(cand.status).toBe(200);
    expect(cand.body).toEqual(
      expect.objectContaining({
        ok: true,
        selectionId,
        candidates: expect.any(Array),
      })
    );

    expect(cand.body.candidates.length).toBeGreaterThan(0);

    // segurança: não vaza pageAccessToken
    for (const c of cand.body.candidates) {
      expect(c).not.toHaveProperty("pageAccessToken");
      expect(c).toEqual(
        expect.objectContaining({
          igUserId: expect.any(String),
          facebookPageId: expect.any(String),
        })
      );
    }

    const first = cand.body.candidates[0];

    // 3) POST confirm
    const confirm = await request(app)
      .post("/api/instagram/confirm")
      .set("Authorization", makeAuthHeader(user.id))
      .send({
        selectionId,
        selections: [{ igUserId: first.igUserId, facebookPageId: first.facebookPageId }],
      });

    expect([200, 201]).toContain(confirm.status);
    expect(confirm.body).toEqual(expect.objectContaining({ ok: true }));

    // 4) DB: deve existir instagramAccount conectada
    const acc = await prisma.instagramAccount.findFirst({
      where: { userId: user.id, igUserId: String(first.igUserId) },
    });

    expect(acc).toBeTruthy();
    expect(acc?.isConnected).toBe(true);

    // active setado
    const u = await prisma.user.findUnique({ where: { id: user.id } });
    expect(u?.activeInstagramAccountId).toBe(acc!.id);

    // 5) status/active devem refletir
    const status = await request(app)
      .get("/api/instagram/status")
      .set("Authorization", makeAuthHeader(user.id));
    expect(status.status).toBe(200);
    expect(status.body).toEqual(expect.objectContaining({ connected: true }));

    const active = await request(app)
      .get("/api/instagram/active")
      .set("Authorization", makeAuthHeader(user.id));
    expect(active.status).toBe(200);
    expect(active.body).toEqual(
      expect.objectContaining({
        activeInstagramAccountId: acc!.id,
      })
    );
  });
});