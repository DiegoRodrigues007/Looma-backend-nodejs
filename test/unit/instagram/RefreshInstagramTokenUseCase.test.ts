// test/unit/instagram/RefreshInstagramTokenUseCase.test.ts

jest.mock("../../../src/infrastructure/db/prismaClient", () => {
  return {
    prisma: {
      user: { findUnique: jest.fn() },
      instagramAccount: {
        // ✅ o UC usa findFirst (não findUnique)
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    },
  };
});

import { RefreshInstagramTokenUseCase } from "../../../src/application/use-cases/instagram/RefreshInstagramTokenUseCase";
import { prisma } from "../../../src/infrastructure/db/prismaClient";

type AuthSvc = {
  refreshLongToken?: jest.Mock;
  refreshLong?: jest.Mock;
};

function makeAuth(overrides?: Partial<AuthSvc>): AuthSvc {
  return {
    refreshLongToken: jest.fn(),
    refreshLong: jest.fn(),
    ...overrides,
  };
}

function pickErrCode(out: any): string | undefined {
  if (!out || typeof out !== "object") return undefined;
  return out.code ?? out.error ?? out.reason ?? out.kind ?? out.status;
}

function pickRefreshed(out: any): boolean | undefined {
  if (!out || typeof out !== "object") return undefined;
  return out.refreshed ?? out.didRefresh;
}

/**
 * ✅ O UC valida:
 * - acc.isConnected === true
 * - acc.accessToken (long token) existir
 * E lê apenas os campos do select do use-case.
 */
function makeConnectedAccount(overrides?: Partial<any>) {
  return {
    id: "ACC_1",
    igUserId: "IG_1",
    accessToken: "LONG_TOKEN",
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    isConnected: true,
    pageAccessToken: "PAGE_TOKEN_1",
    ...overrides,
  };
}

describe("RefreshInstagramTokenUseCase", () => {
  const STRESS_ITERS = 140;

  beforeEach(() => {
    (prisma.user.findUnique as unknown as jest.Mock).mockReset();
    (prisma.instagramAccount.findFirst as unknown as jest.Mock).mockReset();
    (prisma.instagramAccount.update as unknown as jest.Mock).mockReset();
  });

  it("UNAUTHENTICATED quando userId vazio", async () => {
    const uc = new RefreshInstagramTokenUseCase(prisma as any, makeAuth() as any);

    const out: any = await uc.execute({ userId: "" } as any);

    expect(out).toEqual(expect.objectContaining({ ok: false }));
    const c = pickErrCode(out);
    if (c) expect(c).toBe("UNAUTHENTICATED");
  });

  it("NOT_FOUND quando user não tem activeInstagramAccountId", async () => {
    (prisma.user.findUnique as unknown as jest.Mock).mockResolvedValue({
      activeInstagramAccountId: null,
    });

    const uc = new RefreshInstagramTokenUseCase(prisma as any, makeAuth() as any);

    const out: any = await uc.execute({ userId: "USER_1" } as any);

    expect(out).toEqual(expect.objectContaining({ ok: false }));
    const c = pickErrCode(out);
    if (c) expect(c).toBe("NOT_FOUND");
  });

  it("deve pular refresh quando não está perto de expirar e force=false", async () => {
    (prisma.user.findUnique as unknown as jest.Mock).mockResolvedValue({
      activeInstagramAccountId: "ACC_1",
    });

    // ✅ devolve conta com os campos do select do UC (evita NOT_CONNECTED)
    (prisma.instagramAccount.findFirst as unknown as jest.Mock).mockResolvedValue(
      makeConnectedAccount({
        accessToken: "LONG_TOKEN",
        isConnected: true,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
        pageAccessToken: "PAGE_TOKEN_1",
      })
    );

    const auth = makeAuth();
    const uc = new RefreshInstagramTokenUseCase(prisma as any, auth as any);

    const out: any = await uc.execute({
      userId: "USER_1",
      refreshIfExpiresBeforeMinutes: 60,
      force: false,
    } as any);

    expect(out).toEqual(expect.objectContaining({ ok: true }));

    const refreshed = pickRefreshed(out);
    if (typeof refreshed === "boolean") expect(refreshed).toBe(false);

    expect(prisma.instagramAccount.update).not.toHaveBeenCalled();
    expect(auth.refreshLongToken).not.toHaveBeenCalled();
    expect(auth.refreshLong).not.toHaveBeenCalled();
  });

  it("deve fazer refresh quando force=true e persistir novo token", async () => {
    (prisma.user.findUnique as unknown as jest.Mock).mockResolvedValue({
      activeInstagramAccountId: "ACC_1",
    });

    (prisma.instagramAccount.findFirst as unknown as jest.Mock).mockResolvedValue(
      makeConnectedAccount({
        accessToken: "LONG_TOKEN_OLD",
        isConnected: true,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 min (não importa, force=true)
        pageAccessToken: "PAGE_TOKEN_1", // não deve ser sobrescrito (não é vazio/INVALID/EXPIRED)
      })
    );

    const auth = makeAuth({
      // ✅ o UC usa refreshLongToken OU refreshLong
      refreshLongToken: jest.fn().mockResolvedValue({
        accessToken: "LONG_TOKEN_NEW",
        expiresIn: 60 * 24 * 60, // segundos
      }),
    });

    (prisma.instagramAccount.update as unknown as jest.Mock).mockResolvedValue({
      id: "ACC_1",
      accessToken: "LONG_TOKEN_NEW",
    });

    const uc = new RefreshInstagramTokenUseCase(prisma as any, auth as any);

    const out: any = await uc.execute({ userId: "USER_1", force: true } as any);

    expect(out).toEqual(expect.objectContaining({ ok: true }));

    const refreshed = pickRefreshed(out);
    if (typeof refreshed === "boolean") expect(refreshed).toBe(true);

    expect(auth.refreshLongToken).toHaveBeenCalledTimes(1);
    expect(prisma.instagramAccount.update).toHaveBeenCalledTimes(1);

    // ✅ garante que atualiza accessToken (pageAccessToken pode permanecer o mesmo)
    expect(prisma.instagramAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ACC_1" },
        data: expect.objectContaining({
          accessToken: "LONG_TOKEN_NEW",
        }),
      })
    );
  });

  it("STRESS: force refresh em loop", async () => {
    (prisma.user.findUnique as unknown as jest.Mock).mockResolvedValue({
      activeInstagramAccountId: "ACC_1",
    });

    (prisma.instagramAccount.findFirst as unknown as jest.Mock).mockResolvedValue(
      makeConnectedAccount({
        accessToken: "LONG_TOKEN_OLD",
        isConnected: true,
        expiresAt: new Date(Date.now() + 1 * 60 * 1000),
        pageAccessToken: "PAGE_TOKEN_1",
      })
    );

    const auth = makeAuth({
      refreshLongToken: jest.fn().mockResolvedValue({
        access_token: "LONG_TOKEN_NEW", // ✅ também é aceito no normalize
        expires_in: 60 * 24 * 60,
      }),
    });

    (prisma.instagramAccount.update as unknown as jest.Mock).mockResolvedValue({ id: "ACC_1" });

    const uc = new RefreshInstagramTokenUseCase(prisma as any, auth as any);

    for (let i = 0; i < STRESS_ITERS; i++) {
      const out: any = await uc.execute({ userId: "USER_1", force: true } as any);
      expect(out).toEqual(expect.objectContaining({ ok: true }));
    }

    expect(auth.refreshLongToken).toHaveBeenCalledTimes(STRESS_ITERS);
    expect(prisma.instagramAccount.update).toHaveBeenCalledTimes(STRESS_ITERS);
  });
});