// test/unit/instagram/SyncInstagramRecentPostsUseCase.test.ts
import axios from "axios";
import { prisma } from "../../../src/infrastructure/db/prismaClient";
import { SyncInstagramRecentPostsUseCase } from "../../../src/application/use-cases/instagram/SyncInstagramRecentPostsUseCase";

type AxiosMock = {
  get: jest.Mock;
  post: jest.Mock;
  create: jest.Mock;
  isAxiosError?: (e: any) => boolean;
};

const ax = axios as unknown as AxiosMock;

function makeAxiosError(params: {
  status?: number;
  data?: any;
  message?: string;
  code?: string;
}) {
  const err: any = new Error(params.message ?? "Request failed");
  err.isAxiosError = true;
  if (params.code) err.code = params.code;

  if (params.status) {
    err.response = { status: params.status, data: params.data };
  }
  return err;
}

function makeMedia(n: number) {
  // timestamps diferentes pra simular feed real
  return Array.from({ length: n }).map((_, i) => {
    const day = String(30 - (i % 20)).padStart(2, "0");
    return {
      id: `M${i + 1}`,
      caption: `c${i + 1}`,
      media_type: i % 3 === 0 ? "VIDEO" : "IMAGE",
      media_url: `https://cdn/x/${i + 1}.${i % 3 === 0 ? "mp4" : "jpg"}`,
      thumbnail_url: i % 3 === 0 ? `https://cdn/x/${i + 1}-thumb.jpg` : undefined,
      permalink: `https://ig/p/${i + 1}`,
      timestamp: `2026-01-${day}T10:00:00+0000`,
    };
  });
}

function resetAllMocks() {
  ax.get?.mockReset?.();
  ax.post?.mockReset?.();

  (prisma.user.findUnique as jest.Mock)?.mockReset?.();
  (prisma.instagramAccount.findFirst as jest.Mock)?.mockReset?.();
  (prisma.instagramPost.upsert as jest.Mock)?.mockReset?.();
  (prisma.instagramPost.deleteMany as jest.Mock)?.mockReset?.();
}

function seedHappyPathAccount(overrides?: Partial<any>) {
  (prisma.user.findUnique as jest.Mock).mockResolvedValue({
    activeInstagramAccountId: "ACC_1",
  });

  (prisma.instagramAccount.findFirst as jest.Mock).mockResolvedValue({
    id: "ACC_1",
    userId: "USER_1",
    isConnected: true,
    igUserId: "IG_1",
    pageAccessToken: "PAGE_TOKEN",
    grantedScopes:
      "instagram_basic instagram_manage_insights pages_show_list pages_read_engagement pages_read_user_content",
    ...overrides,
  });
}

describe("UNIT SyncInstagramRecentPostsUseCase (robusto)", () => {
  beforeEach(() => {
    resetAllMocks();

    // garante padrão e não vaza estado entre testes
    process.env.INSTAGRAM_GRAPH_BASE_URL = "http://fake-graph/v21.0/";

    // defaults “seguros”
    (prisma.instagramPost.upsert as jest.Mock).mockResolvedValue({});
    (prisma.instagramPost.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });
  });

  it("faz fetch + upsert + deleteOldBeyondLimit e clamp de limit (<=50)", async () => {
    seedHappyPathAccount();

    ax.get.mockResolvedValue({
      data: {
        data: [
          {
            id: "M1",
            caption: "c1",
            media_type: "IMAGE",
            media_url: "https://x/m1.jpg",
            permalink: "https://ig/p/1",
            timestamp: "2026-01-20T12:00:00+0000",
          },
          {
            id: "M2",
            caption: "c2",
            media_type: "VIDEO",
            media_url: "https://x/m2.mp4",
            thumbnail_url: "https://x/m2-thumb.jpg",
            permalink: "https://ig/p/2",
            timestamp: "2026-01-19T10:00:00+0000",
          },
        ],
      },
    });

    (prisma.instagramPost.deleteMany as jest.Mock).mockResolvedValue({ count: 7 });

    const uc = new SyncInstagramRecentPostsUseCase();

    const out = await uc.execute({
      userId: "USER_1",
      limit: 999, // testa clamp
      deleteOldBeyondLimit: true,
    });

    expect(out).toEqual(
      expect.objectContaining({
        ok: true,
        instagramAccountIdUsed: "ACC_1",
        fetched: 2,
        upserted: 2,
        deletedOld: 7,
      })
    );

    const [url, cfg] = ax.get.mock.calls[0];
    expect(url).toBe("http://fake-graph/v21.0/IG_1/media");
    expect(cfg?.params?.access_token).toBe("PAGE_TOKEN");
    expect(cfg?.params?.fields).toContain("id,caption,media_type");
    expect(Number(cfg?.params?.limit)).toBe(50);

    expect(prisma.instagramPost.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.instagramPost.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: "USER_1",
        instagramAccountId: "ACC_1",
        igMediaId: { notIn: ["M1", "M2"] },
      },
    });

    const upsertCallM2 = (prisma.instagramPost.upsert as jest.Mock).mock.calls[1][0];
    expect(upsertCallM2.create.thumb).toBe("https://x/m2-thumb.jpg");
  });

  it("STRESS: 120 itens retornados -> request limit=50 e processa tudo que veio (contrato atual)", async () => {
    seedHappyPathAccount();

    const media120 = makeMedia(120);

    ax.get.mockResolvedValueOnce({
      data: { data: media120 },
    });

    const uc = new SyncInstagramRecentPostsUseCase();

    const out = await uc.execute({
      userId: "USER_1",
      limit: 999, // clamp (só no request)
      deleteOldBeyondLimit: true,
    });

    expect(out.ok).toBe(true);

    // ✅ teu código hoje processa tudo que a Meta devolver (mesmo que peça limit=50)
    expect(out.fetched).toBe(120);
    expect(out.upserted).toBe(120);

    const [url, cfg] = ax.get.mock.calls[0];
    expect(url).toBe("http://fake-graph/v21.0/IG_1/media");
    expect(Number(cfg?.params?.limit)).toBe(50);

    expect(prisma.instagramPost.upsert).toHaveBeenCalledTimes(120);

    // deleteOldBeyondLimit: notIn deve ter todos ids processados (120) e sem duplicados
    const deleteArgs = (prisma.instagramPost.deleteMany as jest.Mock).mock.calls[0][0];
    const notIn: string[] = deleteArgs?.where?.igMediaId?.notIn ?? [];

    expect(Array.isArray(notIn)).toBe(true);
    expect(notIn.length).toBe(120);
    expect(new Set(notIn).size).toBe(120);
  });

  it("robustez: se INSTAGRAM_GRAPH_BASE_URL vier sem barra final, ainda monta URL correta", async () => {
    process.env.INSTAGRAM_GRAPH_BASE_URL = "http://fake-graph/v21.0"; // sem "/"
    seedHappyPathAccount();

    ax.get.mockResolvedValueOnce({ data: { data: [] } });

    const uc = new SyncInstagramRecentPostsUseCase();
    await uc.execute({ userId: "USER_1", limit: 10 });

    const [url] = ax.get.mock.calls[0];
    expect(url).toBe("http://fake-graph/v21.0/IG_1/media");
  });

  it("robustez: resposta malformada (sem data.data) => fetched=0, upsert=0, e não chama deleteMany", async () => {
    seedHappyPathAccount();

    ax.get.mockResolvedValueOnce({ data: { foo: "bar" } });

    const uc = new SyncInstagramRecentPostsUseCase();
    const out = await uc.execute({ userId: "USER_1", limit: 10, deleteOldBeyondLimit: true });

    expect(out).toEqual(
      expect.objectContaining({
        ok: true,
        fetched: 0,
        upserted: 0,
      })
    );

    expect(prisma.instagramPost.upsert).not.toHaveBeenCalled();

    // ✅ contrato atual: se não tem ids, ele não roda cleanup
    expect(prisma.instagramPost.deleteMany).not.toHaveBeenCalled();
  });

  it("reauth required quando grantedScopes não tem os mínimos", async () => {
    seedHappyPathAccount({
      grantedScopes: "instagram_basic pages_show_list", // faltando vários
    });

    const uc = new SyncInstagramRecentPostsUseCase();

    await expect(uc.execute({ userId: "USER_1", limit: 10 })).rejects.toThrow(
      /reauth required: missing scopes/i
    );

    expect(ax.get).not.toHaveBeenCalled();
  });

  it("se não houver conta conectada (account=null) => erro explícito e não chama axios", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ activeInstagramAccountId: null });
    (prisma.instagramAccount.findFirst as jest.Mock).mockResolvedValue(null);

    const uc = new SyncInstagramRecentPostsUseCase();

    // ✅ mensagem real do teu código hoje
    await expect(uc.execute({ userId: "USER_1" })).rejects.toThrow(/Conta do Instagram não encontrada/i);
    expect(ax.get).not.toHaveBeenCalled();
  });

  it("provider down (rede) => mensagem começa com 'provider down:'", async () => {
    seedHappyPathAccount();

    ax.get.mockRejectedValueOnce(makeAxiosError({ code: "ETIMEDOUT", message: "timeout" }));

    const uc = new SyncInstagramRecentPostsUseCase();

    await expect(uc.execute({ userId: "USER_1" })).rejects.toThrow(/^provider down:/i);
  });

  it("Meta auth error (ex.: code 190 / OAuthException) => reauth required", async () => {
    seedHappyPathAccount();

    ax.get.mockRejectedValueOnce(
      makeAxiosError({
        status: 400,
        data: { error: { message: "Invalid OAuth access token.", type: "OAuthException", code: 190 } },
      })
    );

    const uc = new SyncInstagramRecentPostsUseCase();

    await expect(uc.execute({ userId: "USER_1" })).rejects.toThrow(/reauth required/i);
  });

  it("Meta auth error alternativo (code 10 / 200/400) => reauth required", async () => {
    seedHappyPathAccount();

    ax.get.mockRejectedValueOnce(
      makeAxiosError({
        status: 400,
        data: { error: { message: "Permissions error", type: "OAuthException", code: 10 } },
      })
    );

    const uc = new SyncInstagramRecentPostsUseCase();
    await expect(uc.execute({ userId: "USER_1" })).rejects.toThrow(/reauth required/i);
  });

  it("rate limit 429 => expõe a mensagem da Meta (não vira provider down)", async () => {
    seedHappyPathAccount();

    ax.get.mockRejectedValueOnce(
      makeAxiosError({
        status: 429,
        data: { error: { message: "(#4) Application request limit reached" } },
      })
    );

    const uc = new SyncInstagramRecentPostsUseCase();

    await expect(uc.execute({ userId: "USER_1" })).rejects.toThrow(
      /Application request limit reached/i
    );
  });

  it("falha no upsert no meio (ex.: Prisma) => aborta e não chama deleteMany", async () => {
    seedHappyPathAccount();

    ax.get.mockResolvedValueOnce({
      data: {
        data: [
          {
            id: "M1",
            caption: "c1",
            media_type: "IMAGE",
            media_url: "https://x/m1.jpg",
            timestamp: "2026-01-20T10:00:00+0000",
          },
          {
            id: "M2",
            caption: "c2",
            media_type: "IMAGE",
            media_url: "https://x/m2.jpg",
            timestamp: "2026-01-19T10:00:00+0000",
          },
          {
            id: "M3",
            caption: "c3",
            media_type: "IMAGE",
            media_url: "https://x/m3.jpg",
            timestamp: "2026-01-18T10:00:00+0000",
          },
        ],
      },
    });

    (prisma.instagramPost.upsert as jest.Mock)
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("Prisma explode"));

    const uc = new SyncInstagramRecentPostsUseCase();

    await expect(
      uc.execute({ userId: "USER_1", limit: 10, deleteOldBeyondLimit: true })
    ).rejects.toThrow(/Prisma explode/i);

    expect(prisma.instagramPost.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.instagramPost.deleteMany).not.toHaveBeenCalled();
  });
});
