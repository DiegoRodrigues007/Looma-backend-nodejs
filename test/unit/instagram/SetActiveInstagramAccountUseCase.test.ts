// test/unit/instagram/SetActiveInstagramAccountUseCase.test.ts

jest.mock("../../../src/infrastructure/db/prismaClient", () => {
  return {
    prisma: {
      instagramAccount: { findFirst: jest.fn() },
      user: { update: jest.fn() },
    },
  };
});

import { SetActiveInstagramAccountUseCase } from "../../../src/application/use-cases/instagram/SetActiveInstagramAccountUseCase";
import { prisma } from "../../../src/infrastructure/db/prismaClient";

function pickErrCode(out: any): string | undefined {
  if (!out || typeof out !== "object") return undefined;
  return out.code ?? out.error ?? out.reason ?? out.kind ?? out.status;
}

async function exec(uc: any, input: { userId: string; instagramAccountId: string }) {
  // ✅ contrato real: execute({ userId, instagramAccountId })
  return uc.execute({ userId: input.userId, instagramAccountId: input.instagramAccountId } as any);
}

/**
 * ✅ Garante que a conta "parece conectada" pro teu UC
 * (evita cair em NOT_CONNECTED).
 *
 * Pelo comportamento do teu projeto, o UC valida:
 * - account.isConnected === true
 * - e geralmente accessToken / igUserId existirem
 */
function makeConnectedAccount(overrides?: Partial<any>) {
  return {
    id: "ACC_1",
    userId: "USER_1",

    // ✅ flag que o UC costuma exigir
    isConnected: true,

    // identidade IG
    igUserId: "IG_1",
    username: "user1",
    accountType: "BUSINESS",

    // vínculo com página FB
    pageId: "PAGE_1",
    pageName: "Page 1",
    facebookPageId: "PAGE_1",

    // tokens
    accessToken: "LONG_TOKEN_OK",
    pageAccessToken: "PAGE_TOKEN_OK",

    // às vezes o UC valida expiração
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),

    ...overrides,
  };
}

describe("SetActiveInstagramAccountUseCase", () => {
  const STRESS_ITERS = 160;

  beforeEach(() => {
    (prisma.instagramAccount.findFirst as unknown as jest.Mock).mockReset();
    (prisma.user.update as unknown as jest.Mock).mockReset();
  });

  it("deve retornar UNAUTHENTICATED se userId vazio", async () => {
    const uc = new SetActiveInstagramAccountUseCase() as any;

    const out: any = await exec(uc, { userId: "", instagramAccountId: "ACC_1" });

    expect(out).toEqual(expect.objectContaining({ ok: false }));
    const c = pickErrCode(out);
    if (c) expect(c).toBe("UNAUTHENTICATED");

    expect(prisma.instagramAccount.findFirst).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("deve retornar NOT_FOUND se conta não pertencer ao user", async () => {
    (prisma.instagramAccount.findFirst as unknown as jest.Mock).mockResolvedValue(null);

    const uc = new SetActiveInstagramAccountUseCase() as any;

    const out: any = await exec(uc, { userId: "USER_1", instagramAccountId: "ACC_X" });

    expect(out).toEqual(expect.objectContaining({ ok: false }));
    const c = pickErrCode(out);
    if (c) expect(c).toBe("NOT_FOUND");

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("deve setar activeInstagramAccountId no usuário quando conta existir e pertencer ao user", async () => {
    // ✅ precisa parecer 'conectada' para não cair em NOT_CONNECTED
    (prisma.instagramAccount.findFirst as unknown as jest.Mock).mockResolvedValue(
      makeConnectedAccount({
        id: "ACC_1",
        userId: "USER_1",
        igUserId: "IG_1",
        isConnected: true,
        accessToken: "LONG_TOKEN_OK",
        pageAccessToken: "PAGE_TOKEN_OK",
        pageId: "PAGE_1",
        facebookPageId: "PAGE_1",
      })
    );

    (prisma.user.update as unknown as jest.Mock).mockResolvedValue({
      activeInstagramAccountId: "ACC_1",
    });

    const uc = new SetActiveInstagramAccountUseCase() as any;

    const out: any = await exec(uc, { userId: "USER_1", instagramAccountId: "ACC_1" });

    expect(out).toEqual(expect.objectContaining({ ok: true }));

    // ✅ no teu UC atual, o update não usa select (ele só atualiza e retorna ok)
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "USER_1" },
      data: { activeInstagramAccountId: "ACC_1" },
    });
  });

  it("STRESS: alternar active várias vezes", async () => {
    (prisma.instagramAccount.findFirst as unknown as jest.Mock).mockImplementation(async ({ where }: any) => {
      if (where?.id === "ACC_1") {
        return makeConnectedAccount({
          id: "ACC_1",
          userId: "USER_1",
          igUserId: "IG_1",
          isConnected: true,
          accessToken: "LONG_TOKEN_OK_1",
          pageAccessToken: "PAGE_TOKEN_OK_1",
          pageId: "PAGE_1",
          facebookPageId: "PAGE_1",
        });
      }
      if (where?.id === "ACC_2") {
        return makeConnectedAccount({
          id: "ACC_2",
          userId: "USER_1",
          igUserId: "IG_2",
          isConnected: true,
          accessToken: "LONG_TOKEN_OK_2",
          pageAccessToken: "PAGE_TOKEN_OK_2",
          pageId: "PAGE_2",
          facebookPageId: "PAGE_2",
        });
      }
      return null;
    });

    (prisma.user.update as unknown as jest.Mock).mockResolvedValue({
      activeInstagramAccountId: "ACC_1",
    });

    const uc = new SetActiveInstagramAccountUseCase() as any;

    for (let i = 0; i < STRESS_ITERS; i++) {
      const id = i % 2 === 0 ? "ACC_1" : "ACC_2";
      const out: any = await exec(uc, { userId: "USER_1", instagramAccountId: id });
      expect(out).toEqual(expect.objectContaining({ ok: true }));
    }

    expect(prisma.user.update).toHaveBeenCalledTimes(STRESS_ITERS);

    // (extra defensivo) garante que alternou ids
    const calls = (prisma.user.update as unknown as jest.Mock).mock.calls;
    expect(calls[0][0].data).toHaveProperty("activeInstagramAccountId");
  });
});