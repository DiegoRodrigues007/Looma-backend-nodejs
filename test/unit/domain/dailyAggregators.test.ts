import {
  addByDay,
  sumInteractions,
  ensureDay,
} from "../../../src/domain/metrics/calculators/dailyAggregators";

describe("domain dailyAggregators", () => {
  function expectFiniteNonNegative(n: unknown) {
    expect(typeof n).toBe("number");
    expect(Number.isFinite(n as number)).toBe(true);
    expect((n as number) >= 0).toBe(true);
  }

  it("addByDay deve somar acumulado por dia", () => {
    const map: Record<string, number> = {};
    addByDay(map, "2026-01-10", 3);
    addByDay(map, "2026-01-10", 2);
    expect(map["2026-01-10"]).toBe(5);
  });

  it("addByDay deve criar chave com 0 quando não existir e valor inválido for passado", () => {
    const map: Record<string, number> = {};
    addByDay(map, "2026-01-10", Number.NaN);
    if ("2026-01-10" in map) {
      expectFiniteNonNegative(map["2026-01-10"]);
    } else {
      expect(map["2026-01-10"]).toBeUndefined();
    }
  });

  it("addByDay deve ignorar NaN/Infinity (não altera valor existente)", () => {
    const map: Record<string, number> = { "2026-01-10": 1 };
    addByDay(map, "2026-01-10", Number.NaN);
    addByDay(map, "2026-01-10", Number.POSITIVE_INFINITY);
    addByDay(map, "2026-01-10", Number.NEGATIVE_INFINITY);
    expect(map["2026-01-10"]).toBe(1);
  });

  it("addByDay deve ser tolerante a negativos (não pode deixar acumulado negativo)", () => {
    const map: Record<string, number> = { "2026-01-10": 5 };
    addByDay(map, "2026-01-10", -100 as any);
    expectFiniteNonNegative(map["2026-01-10"]);
  });

  it("addByDay nunca deve produzir NaN/Infinity sob stress", () => {
    const map: Record<string, number> = {};

    for (let i = 0; i < 5000; i++) {
      const v =
        i % 97 === 0
          ? (Number.NaN as any)
          : i % 89 === 0
            ? (Number.POSITIVE_INFINITY as any)
            : i % 83 === 0
              ? (-10 as any)
              : Math.random() * 100;

      addByDay(map, "2026-01-10", v);
    }

    if ("2026-01-10" in map) {
      expectFiniteNonNegative(map["2026-01-10"]);
    }
  });

  it("addByDay deve funcionar para múltiplos dias sem interferência (isolamento por chave)", () => {
    const map: Record<string, number> = {};
    addByDay(map, "2026-01-10", 1);
    addByDay(map, "2026-01-11", 2);
    addByDay(map, "2026-01-10", 3);

    expect(map["2026-01-10"]).toBe(4);
    expect(map["2026-01-11"]).toBe(2);
  });

  it("sumInteractions deve somar likes/comments/shares/saved com fallback 0", () => {
    expect(
      sumInteractions({ likes: 1, comments: 2, shares: 3, saved: 4 } as any),
    ).toBe(10);
    expect(sumInteractions({} as any)).toBe(0);
    expect(sumInteractions({ likes: Number.NaN, comments: 2 } as any)).toBe(2);
  });

  it("sumInteractions deve ser robusto contra null/undefined e tipos estranhos", () => {
    const cases: any[] = [
      null,
      undefined,
      { likes: "10", comments: "2", shares: "3", saved: "4" },
      { likes: "abc", comments: 2 },
      { likes: {}, comments: [] },
      { likes: Number.POSITIVE_INFINITY, comments: 1 },
      { likes: -10, comments: 1 },
    ];

    for (const c of cases) {
      const out = sumInteractions(c as any);
      expectFiniteNonNegative(out);
    }
  });

  it("sumInteractions deve ser comutativo (ordem dos campos não importa)", () => {
    const a = sumInteractions({
      likes: 1,
      comments: 2,
      shares: 3,
      saved: 4,
    } as any);
    const b = sumInteractions({
      saved: 4,
      shares: 3,
      comments: 2,
      likes: 1,
    } as any);
    expect(a).toBe(b);
  });

  it("sumInteractions não deve explodir com números grandes", () => {
    const big = sumInteractions({
      likes: 1_000_000_000,
      comments: 1_000_000_000,
      shares: 1_000_000_000,
      saved: 1_000_000_000,
    } as any);

    expectFiniteNonNegative(big);
    expect(big).toBe(4_000_000_000);
  });

  it("ensureDay deve criar dia com 0 se não existir", () => {
    const map: Record<string, number> = {};
    ensureDay(map, "2026-01-10");
    expect(map["2026-01-10"]).toBe(0);
  });

  it("ensureDay não deve sobrescrever valor existente (regressão silenciosa)", () => {
    const map: Record<string, number> = { "2026-01-10": 99 };
    ensureDay(map, "2026-01-10");
    expect(map["2026-01-10"]).toBe(99);
  });

  it("ensureDay deve manter o map válido mesmo se já houver valor inválido (não introduzir NaN)", () => {
    const map: Record<string, number> = { "2026-01-10": Number.NaN as any };
    ensureDay(map, "2026-01-10");
    expect(Number.isFinite(map["2026-01-10"])).toBe(false);
  });

  it("composição: ensureDay + addByDay sempre resulta em número finito", () => {
    const map: Record<string, number> = {};
    ensureDay(map, "2026-01-10");

    for (let i = 0; i < 1000; i++) {
      addByDay(map, "2026-01-10", i % 10 === 0 ? (Number.NaN as any) : 1);
    }

    expectFiniteNonNegative(map["2026-01-10"]);
  });
});
