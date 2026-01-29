// test/unit/instagram/InstagramIgLoginAuthService.test.ts
import { InstagramIgLoginAuthService } from "../../../src/infrastructure/instagram/services/InstagramIgLoginAuthService";

type Client = {
  exchangeCodeForShortToken: jest.Mock;
  exchangeShortForLong: jest.Mock;
  getGrantedPermissions: jest.Mock; // ✅ no código real retorna Set<string>
  getCandidates: jest.Mock;         // ✅ no código real retorna array (não axios {data:[]})
  buildLoginUrl: jest.Mock;
};

function makeClient(overrides?: Partial<Client>): Client {
  return {
    exchangeCodeForShortToken: jest.fn(),
    exchangeShortForLong: jest.fn(),
    getGrantedPermissions: jest.fn(),
    getCandidates: jest.fn(),
    // ✅ teu service passa 2 args: (state, forceReRequest)
    buildLoginUrl: jest.fn().mockReturnValue("https://login.meta/authorize"),
    ...overrides,
  };
}

function pickAccessToken(v: any): string {
  return v?.access_token ?? v?.accessToken ?? v?.token ?? v?.data?.access_token ?? v?.data?.accessToken;
}

const REQUIRED_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_read_user_content",
  "instagram_basic",
  "instagram_manage_insights",
] as const;

describe("InstagramIgLoginAuthService", () => {
  const STRESS_ITERS = 150;

  it("buildLoginUrl: deve delegar pro client", () => {
    const client = makeClient();
    const svc = new InstagramIgLoginAuthService(client as any);

    const url = svc.buildLoginUrl("STATE_X");

    expect(client.buildLoginUrl).toHaveBeenCalledWith("STATE_X", false);
    expect(url).toBe("https://login.meta/authorize");
  });

  it('exchangeCodeForShortToken: com code vazio retorna undefined (no teu service ele ainda delega pro client)', async () => {
    const client = makeClient({
      exchangeCodeForShortToken: jest.fn().mockResolvedValue(undefined),
    });

    const svc = new InstagramIgLoginAuthService(client as any);

    const out = await svc.exchangeCodeForShortToken("");

    expect(out).toBeUndefined();

    // ✅ pelo comportamento do service: ele delega mesmo com ""
    expect(client.exchangeCodeForShortToken).toHaveBeenCalledTimes(1);
    expect(client.exchangeCodeForShortToken).toHaveBeenCalledWith("");
  });

  it("exchangeCodeForShortToken -> exchangeShortForLong: fluxo ok", async () => {
    const client = makeClient({
      // ✅ aceita retorno estilo axios também
      exchangeCodeForShortToken: jest.fn().mockResolvedValue({ data: { access_token: "SHORT" } }),
      exchangeShortForLong: jest.fn().mockResolvedValue({ data: { access_token: "LONG", expires_in: 60 * 24 * 60 } }),
    });

    const svc = new InstagramIgLoginAuthService(client as any);

    const short: any = await svc.exchangeCodeForShortToken("CODE_123");
    const shortToken = pickAccessToken(short);
    expect(shortToken).toBe("SHORT");

    const long: any = await svc.exchangeShortForLong(shortToken);
    const longToken = pickAccessToken(long);
    expect(longToken).toBe("LONG");

    expect(client.exchangeCodeForShortToken).toHaveBeenCalledWith("CODE_123");
    expect(client.exchangeShortForLong).toHaveBeenCalledWith("SHORT");
  });

  it("resolveCandidatesOrReauth: deve retornar reauth_required quando não tiver longToken", async () => {
    const client = makeClient();
    const svc = new InstagramIgLoginAuthService(client as any);

    const out: any = await svc.resolveCandidatesOrReauth(undefined as any);

    expect(out).toEqual(expect.objectContaining({ status: "reauth_required" }));
    expect(out).toHaveProperty("loginUrl");
    expect(out).toHaveProperty("missingPermissions");

    expect(client.getGrantedPermissions).not.toHaveBeenCalled();
    expect(client.getCandidates).not.toHaveBeenCalled();
  });

  it("resolveCandidatesOrReauth: deve exigir permissões mínimas (missingPermissions)", async () => {
    const client = makeClient({
      /**
       * ✅ IMPORTANTÍSSIMO:
       * No código real, o service verifica granted.has("scope")
       * então o client deve devolver Set<string>.
       */
      getGrantedPermissions: jest.fn().mockResolvedValue(new Set(["instagram_basic"])), // faltando várias
      getCandidates: jest.fn(),
    });

    const svc = new InstagramIgLoginAuthService(client as any);

    const out: any = await svc.resolveCandidatesOrReauth("LONG_TOKEN");

    expect(out).toEqual(expect.objectContaining({ status: "reauth_required" }));
    expect(out).toHaveProperty("missingPermissions");
    expect(Array.isArray(out.missingPermissions)).toBe(true);
    expect(out.missingPermissions.length).toBeGreaterThan(0);

    // (opcional) garante que realmente faltou algo do conjunto exigido
    for (const p of REQUIRED_SCOPES) {
      // como só tinha instagram_basic, é esperado que pelo menos 1 falte
      if (p !== "instagram_basic") {
        expect(out.missingPermissions).toContain(p);
        break;
      }
    }

    expect(client.getCandidates).not.toHaveBeenCalled();
    expect(client.getGrantedPermissions).toHaveBeenCalledWith("LONG_TOKEN");
  });

  it("resolveCandidatesOrReauth: com permissões ok deve retornar candidates", async () => {
    const client = makeClient({
      // ✅ o service usa granted.has(), então tem que ser Set
      getGrantedPermissions: jest.fn().mockResolvedValue(
        new Set([
          "instagram_basic",
          "pages_show_list",
          "pages_read_engagement",
          "pages_read_user_content",
          "instagram_manage_insights",
          // extras comuns (não atrapalham)
          "business_management",
          "pages_manage_metadata",
        ])
      ),

      // ✅ no service: candidates = await client.getCandidates(token)
      // e ele devolve { status:"ok", candidates } SEM normalizar.
      // Então aqui tem que ser array direto.
      getCandidates: jest.fn().mockResolvedValue([
        {
          pageId: "PAGE_1",
          pageName: "Page 1",
          igUserId: "IG_1",
          igUsername: "user1",
          pageAccessToken: "PAGE_TOKEN_1",
        },
      ]),
    });

    const svc = new InstagramIgLoginAuthService(client as any);

    const out: any = await svc.resolveCandidatesOrReauth("LONG_TOKEN");

    expect(out).toHaveProperty("candidates");
    expect(Array.isArray(out.candidates)).toBe(true);
    expect(out.candidates).toHaveLength(1);

    // o service retorna status ok quando passou pelas permissões
    expect(out).toEqual(expect.objectContaining({ status: "ok" }));

    expect(client.getGrantedPermissions).toHaveBeenCalledWith("LONG_TOKEN");
    expect(client.getCandidates).toHaveBeenCalledWith("LONG_TOKEN");
  });

  it("STRESS: resolveCandidatesOrReauth não pode vazar estado entre chamadas", async () => {
    const client = makeClient({
      getGrantedPermissions: jest.fn().mockResolvedValue(
        new Set([
          "instagram_basic",
          "pages_show_list",
          "pages_read_engagement",
          "pages_read_user_content",
          "instagram_manage_insights",
          "business_management",
          "pages_manage_metadata",
        ])
      ),
      getCandidates: jest.fn().mockResolvedValue([
        {
          pageId: "PAGE_1",
          pageName: "Page 1",
          igUserId: "IG_1",
          igUsername: "user1",
          pageAccessToken: "PAGE_TOKEN_1",
        },
      ]),
    });

    const svc = new InstagramIgLoginAuthService(client as any);

    for (let i = 0; i < STRESS_ITERS; i++) {
      const out: any = await svc.resolveCandidatesOrReauth("LONG_TOKEN");

      expect(out).toHaveProperty("candidates");
      expect(Array.isArray(out.candidates)).toBe(true);
      expect(out.candidates[0].igUserId).toBe("IG_1");
      expect(out.status).toBe("ok");
    }

    expect(client.getGrantedPermissions).toHaveBeenCalledTimes(STRESS_ITERS);
    expect(client.getCandidates).toHaveBeenCalledTimes(STRESS_ITERS);
  });
});