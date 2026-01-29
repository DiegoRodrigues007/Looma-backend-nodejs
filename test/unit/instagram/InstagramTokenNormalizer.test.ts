import { normalizeInstagramToken } from "../../../src/application/instagram/InstagramTokenNormalizer";

describe("InstagramTokenNormalizer (robusto)", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // helper: valida que o normalizer sempre retorna Date válida
  function expectValidDate(d: any) {
    expect(d).toBeInstanceOf(Date);
    expect(Number.isNaN(d.getTime())).toBe(false);
  }

  it("normaliza accessToken simples (string)", () => {
    const out = normalizeInstagramToken("token-123");

    expect(out.accessToken).toBe("token-123");
    expectValidDate(out.expiresAt);
  });

  it("prioriza expiresAt quando fornecido (Date)", () => {
    const date = new Date("2026-02-01T00:00:00.000Z");

    const out = normalizeInstagramToken({
      accessToken: "token",
      expiresAt: date,
    });

    expect(out.expiresAt?.getTime()).toBe(date.getTime());
  });

  it("prioriza expiresAt mesmo quando expiresIn também vem (precedência)", () => {
    const date = new Date("2026-02-01T00:00:00.000Z");

    const out = normalizeInstagramToken({
      accessToken: "token",
      expiresAt: date,
      expiresIn: 3600, // deveria ser ignorado
    } as any);

    expect(out.expiresAt?.getTime()).toBe(date.getTime());
  });

  it("calcula expiresAt corretamente a partir de expiresIn (segundos)", () => {
    const out = normalizeInstagramToken({
      accessToken: "token",
      expiresIn: 3600,
    });

    expect(out.expiresAt?.toISOString()).toBe("2026-01-01T01:00:00.000Z");
  });

  it("aceita expiresIn como string numérica", () => {
    const out = normalizeInstagramToken({
      accessToken: "token",
      expiresIn: "1800",
    } as any);

    expect(out.expiresAt?.toISOString()).toBe("2026-01-01T00:30:00.000Z");
  });

  it("aceita expires_in (snake_case)", () => {
    const out = normalizeInstagramToken({
      access_token: "token",
      expires_in: 1800,
    } as any);

    expect(out.accessToken).toBe("token");
    expect(out.expiresAt?.toISOString()).toBe("2026-01-01T00:30:00.000Z");
  });

  it("aceita payload da Meta com campos extras sem quebrar", () => {
    const out = normalizeInstagramToken({
      access_token: "meta-token",
      expires_in: 5183944,
      token_type: "bearer",
      some_extra_field: "x",
    } as any);

    expect(out.accessToken).toBe("meta-token");
    expectValidDate(out.expiresAt);
  });

  it("fallback seguro quando nenhuma expiração é informada", () => {
    const out = normalizeInstagramToken({
      accessToken: "token",
    });

    expectValidDate(out.expiresAt);
    // deve ser no futuro (não pode ser <= agora)
    expect(out.expiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("expiresIn = 0 não pode gerar data inválida (deve ser agora ou fallback futuro)", () => {
    const out = normalizeInstagramToken({
      accessToken: "token",
      expiresIn: 0,
    } as any);

    expectValidDate(out.expiresAt);
  });

  it("expiresIn negativo não deve quebrar (fallback seguro)", () => {
    const out = normalizeInstagramToken({
      accessToken: "token",
      expiresIn: -100,
    } as any);

    expectValidDate(out.expiresAt);
  });

  it("expiresIn float deve funcionar (arredonda/usa como número)", () => {
    const out = normalizeInstagramToken({
      accessToken: "token",
      expiresIn: 1.5,
    } as any);

    expectValidDate(out.expiresAt);
    expect(out.expiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("nunca retorna expiresAt inválido quando expiresIn é lixo", () => {
    const out = normalizeInstagramToken({
      accessToken: "token",
      expiresIn: "abc",
    } as any);

    expectValidDate(out.expiresAt);
  });

  it("nunca retorna expiresAt inválido quando expiresIn é NaN/Infinity", () => {
    const out1 = normalizeInstagramToken({
      accessToken: "token",
      expiresIn: NaN,
    } as any);

    const out2 = normalizeInstagramToken({
      accessToken: "token",
      expiresIn: Infinity,
    } as any);

    expectValidDate(out1.expiresAt);
    expectValidDate(out2.expiresAt);
  });

  it("aceita expiresAt como string ISO (se tua função suportar), senão faz fallback seguro", () => {
    const out = normalizeInstagramToken({
      accessToken: "token",
      expiresAt: "2026-02-01T00:00:00.000Z",
    } as any);

    expectValidDate(out.expiresAt);
  });

  it("expiresAt inválido deve cair em fallback seguro", () => {
    const out = normalizeInstagramToken({
      accessToken: "token",
      expiresAt: "data-maluca",
    } as any);

    expectValidDate(out.expiresAt);
    expect(out.expiresAt!.getTime()).toBeGreaterThanOrEqual(Date.now());
  });

  it("determinístico com tempo congelado (anti-flake)", () => {
    const out = normalizeInstagramToken({
      accessToken: "token",
      expiresIn: 60,
    });

    expect(out.expiresAt?.toISOString()).toBe("2026-01-01T00:01:00.000Z");
  });

  it("não altera accessToken quando vier como access_token", () => {
    const out = normalizeInstagramToken({
      access_token: "snake-token",
      expires_in: 60,
    } as any);

    expect(out.accessToken).toBe("snake-token");
  });
});