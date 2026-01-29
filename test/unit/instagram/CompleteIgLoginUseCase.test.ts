// test/unit/instagram/CompleteIgLoginUseCase.test.ts
import { CompleteIgLoginUseCase } from "../../../src/application/use-cases/instagram/CompleteIgLoginUseCase";

type AuthSvc = {
  exchangeCodeForShortToken: jest.Mock;
  exchangeShortForLong: jest.Mock;
  resolveMeOrReauth: jest.Mock;
};

type TokenStore = {
  // ✅ no teu projeto o TokenStore mudou: agora é saveOrUpdate (não saveOrUpdateAccount)
  saveOrUpdate: jest.Mock;
  getByUserId?: jest.Mock;
};

function makeAuth(overrides?: Partial<AuthSvc>): AuthSvc {
  return {
    exchangeCodeForShortToken: jest.fn(),
    exchangeShortForLong: jest.fn(),
    resolveMeOrReauth: jest.fn(),
    ...overrides,
  };
}

function makeTokenStore(overrides?: Partial<TokenStore>): TokenStore {
  return {
    getByUserId: jest.fn().mockResolvedValue(null),
    saveOrUpdate: jest.fn(),
    ...overrides,
  };
}

function isReauth(out: any): boolean {
  if (!out || typeof out !== "object") return false;
  return out.status === "reauth_required" || out.code === "REAUTH_REQUIRED";
}

/**
 * ✅ Contrato real (do teu use-case):
 * execute(code, state, userId)
 */
async function exec(uc: any, input: { code: string; userId: string; state?: string }) {
  return uc.execute(input.code, input.state ?? "STATE_X", input.userId);
}

describe("CompleteIgLoginUseCase", () => {
  const STRESS_ITERS = 120;

  it("REAUTH_REQUIRED: quando auth pedir reauth não deve salvar nada", async () => {
    const auth = makeAuth({
      exchangeCodeForShortToken: jest.fn().mockResolvedValue({ shortToken: "SHORT" }),
      exchangeShortForLong: jest.fn().mockResolvedValue({
        longToken: "LONG",
        expiresAt: new Date(Date.now() + 60 * 24 * 60 * 1000),
      }),
      resolveMeOrReauth: jest.fn().mockResolvedValue({
        status: "reauth_required",
        loginUrl: "https://meta/login",
        missingPermissions: ["pages_show_list"],
      }),
    });

    const tokenStore = makeTokenStore();
    const uc = new CompleteIgLoginUseCase(auth as any, tokenStore as any);

    const out: any = await exec(uc as any, { code: "CODE_X", userId: "USER_1", state: "STATE_X" });

    expect(isReauth(out)).toBe(true);
    expect(out).toHaveProperty("loginUrl");
    expect(out).toHaveProperty("missingPermissions");
    expect(Array.isArray(out.missingPermissions)).toBe(true);

    expect(tokenStore.saveOrUpdate).not.toHaveBeenCalled();
  });

  it("NO_CANDIDATES: quando candidates vier vazio (o UC dá throw)", async () => {
    const auth = makeAuth({
      exchangeCodeForShortToken: jest.fn().mockResolvedValue({ shortToken: "SHORT" }),
      exchangeShortForLong: jest.fn().mockResolvedValue({
        longToken: "LONG",
        expiresAt: new Date(Date.now() + 60 * 24 * 60 * 1000),
      }),
      resolveMeOrReauth: jest.fn().mockResolvedValue({
        status: "ok",
        candidates: [],
      }),
    });

    const tokenStore = makeTokenStore();
    const uc = new CompleteIgLoginUseCase(auth as any, tokenStore as any);

    await expect(exec(uc as any, { code: "CODE_X", userId: "USER_1" })).rejects.toThrow(
      /Nenhuma conta do Instagram foi encontrada/i
    );

    expect(tokenStore.saveOrUpdate).not.toHaveBeenCalled();
  });

  it("AUTO-CONFIRM: 1 candidate válido salva e retorna sucesso", async () => {
    const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 1000);

    const auth = makeAuth({
      exchangeCodeForShortToken: jest.fn().mockResolvedValue({ shortToken: "SHORT" }),
      exchangeShortForLong: jest.fn().mockResolvedValue({ longToken: "LONG", expiresAt }),
      resolveMeOrReauth: jest.fn().mockResolvedValue({
        status: "ok",
        candidates: [
          {
            facebookPageId: "PAGE_1",
            facebookPageName: "Page 1",
            igUserId: "IG_1",
            username: "user1",
            accountType: "BUSINESS",
            pageAccessToken: "PAGE_TOKEN_1",
            source: "instagram_business_account",
          },
        ],
      }),
    });

    const tokenStore = makeTokenStore({
      saveOrUpdate: jest.fn().mockResolvedValue(undefined),
    });

    const uc = new CompleteIgLoginUseCase(auth as any, tokenStore as any);

    const out: any = await exec(uc as any, { code: "CODE_X", userId: "USER_1" });

    expect(out).toEqual(expect.any(Object));
    expect(out).toEqual(expect.objectContaining({ status: "ok" }));

    expect(tokenStore.saveOrUpdate).toHaveBeenCalledTimes(1);

    const payload = tokenStore.saveOrUpdate.mock.calls[0][0];

    expect(payload).toEqual(
      expect.objectContaining({
        userId: "USER_1",
        igUserId: "IG_1",
        facebookPageId: "PAGE_1",
        pageAccessToken: "PAGE_TOKEN_1",
        accessToken: "LONG",
        isConnected: true,
      })
    );

    if (payload && typeof payload === "object" && "expiresAt" in payload) {
      expect(payload.expiresAt).toBeInstanceOf(Date);
    }
  });

  it("INVALID_CANDIDATE: rejeita candidate sem pageAccessToken (o UC dá throw)", async () => {
    const auth = makeAuth({
      exchangeCodeForShortToken: jest.fn().mockResolvedValue({ shortToken: "SHORT" }),
      exchangeShortForLong: jest.fn().mockResolvedValue({
        longToken: "LONG",
        expiresAt: new Date(Date.now() + 60 * 24 * 60 * 1000),
      }),
      resolveMeOrReauth: jest.fn().mockResolvedValue({
        status: "ok",
        candidates: [
          {
            facebookPageId: "PAGE_1",
            facebookPageName: "Page 1",
            igUserId: "IG_1",
            username: "user1",
            accountType: "BUSINESS",
            pageAccessToken: "", // inválido -> normalizeCandidateForDb dá throw
            source: "instagram_business_account",
          },
        ],
      }),
    });

    const tokenStore = makeTokenStore();
    const uc = new CompleteIgLoginUseCase(auth as any, tokenStore as any);

    await expect(exec(uc as any, { code: "CODE_X", userId: "USER_1" })).rejects.toThrow(
      /pageAccessToken vazio no candidate/i
    );

    expect(tokenStore.saveOrUpdate).not.toHaveBeenCalled();
  });

  it("STRESS: múltiplas execuções não vazam estado (1 save por execução)", async () => {
    const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 1000);

    const auth = makeAuth({
      exchangeCodeForShortToken: jest.fn().mockResolvedValue({ shortToken: "SHORT" }),
      exchangeShortForLong: jest.fn().mockResolvedValue({ longToken: "LONG", expiresAt }),
      resolveMeOrReauth: jest.fn().mockResolvedValue({
        status: "ok",
        candidates: [
          {
            facebookPageId: "PAGE_1",
            facebookPageName: "Page 1",
            igUserId: "IG_1",
            username: "user1",
            accountType: "BUSINESS",
            pageAccessToken: "PAGE_TOKEN_1",
            source: "instagram_business_account",
          },
        ],
      }),
    });

    const tokenStore = makeTokenStore({
      saveOrUpdate: jest.fn().mockResolvedValue(undefined),
    });

    const uc = new CompleteIgLoginUseCase(auth as any, tokenStore as any);

    for (let i = 0; i < STRESS_ITERS; i++) {
      const out: any = await exec(uc as any, { code: "CODE_X", userId: "USER_1" });
      expect(out).toEqual(expect.objectContaining({ status: "ok" }));
    }

    expect(tokenStore.saveOrUpdate).toHaveBeenCalledTimes(STRESS_ITERS);
  });
});