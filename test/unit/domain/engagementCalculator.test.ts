import { calculateEngagementRate } from "../../../src/domain/metrics/calculators/engagementRate";
import { normalizePercent } from "../../../src/domain/metrics/calculators/normalizePercent";
import { compareEngagement } from "../../../src/domain/metrics/calculators/compareEngagement";

describe("domain engagement calculators", () => {
  function expectFinite(n: unknown) {
    expect(typeof n).toBe("number");
    expect(Number.isFinite(n as number)).toBe(true);
  }

  function expectFiniteNonNegative(n: unknown) {
    expectFinite(n);
    expect((n as number) >= 0).toBe(true);
  }

  function expectTrend(trend: unknown) {
    expect(["up", "down", "flat", "same", "neutral"]).toContain(String(trend));
  }

  it("calculateEngagementRate: (interactions/reach)*100", () => {
    expect(
      calculateEngagementRate({ reach: 200, totalInteractions: 20 } as any),
    ).toBe(10);
  });

  it("calculateEngagementRate deve retornar 0 se reach<=0 ou inválido", () => {
    expect(
      calculateEngagementRate({ reach: 0, totalInteractions: 10 } as any),
    ).toBe(0);
    expect(
      calculateEngagementRate({ reach: -1, totalInteractions: 10 } as any),
    ).toBe(0);
    expect(
      calculateEngagementRate({
        reach: Number.NaN,
        totalInteractions: 10,
      } as any),
    ).toBe(0);
    expect(
      calculateEngagementRate({
        reach: Number.POSITIVE_INFINITY,
        totalInteractions: 10,
      } as any),
    ).toBe(0);
  });

  it("calculateEngagementRate deve retornar 0 se interactions inválido", () => {
    expect(
      calculateEngagementRate({
        reach: 100,
        totalInteractions: Number.NaN,
      } as any),
    ).toBe(0);
    expect(
      calculateEngagementRate({
        reach: 100,
        totalInteractions: Number.POSITIVE_INFINITY,
      } as any),
    ).toBe(0);
    expect(
      calculateEngagementRate({ reach: 100, totalInteractions: -10 } as any),
    ).toBe(0);
  });

  it("calculateEngagementRate nunca deve retornar NaN/Infinity (invariantes)", () => {
    const cases: Array<{ reach: any; totalInteractions: any }> = [
      { reach: 100, totalInteractions: 10 },
      { reach: 0, totalInteractions: 10 },
      { reach: -10, totalInteractions: 10 },
      { reach: Number.NaN, totalInteractions: 10 },
      { reach: 10, totalInteractions: Number.NaN },
      { reach: Number.POSITIVE_INFINITY, totalInteractions: 10 },
      { reach: 10, totalInteractions: Number.POSITIVE_INFINITY },
      { reach: "100", totalInteractions: "10" },
      { reach: "abc", totalInteractions: "10" },
      { reach: 100, totalInteractions: "banana" },
      { reach: null, totalInteractions: 10 },
      { reach: undefined, totalInteractions: 10 },
    ];

    for (const c of cases) {
      const out = calculateEngagementRate(c as any);
      expectFiniteNonNegative(out);
    }
  });

  it("calculateEngagementRate deve ser determinístico (mesma entrada => mesmo output)", () => {
    const input = { reach: 321, totalInteractions: 123 } as any;
    const a = calculateEngagementRate(input);
    const b = calculateEngagementRate(input);
    expect(a).toBe(b);
  });

  it("normalizePercent: 0..1 vira 0..100, e inválido vira 0", () => {
    expect(normalizePercent(0.23)).toBe(23);
    expect(normalizePercent(23)).toBe(23);
    expect(normalizePercent(Number.NaN)).toBe(0);
  });

  it("normalizePercent deve lidar com strings/undefined/null sem NaN", () => {
    const cases: any[] = [
      0,
      0.1,
      1,
      0.999,
      23,
      100,
      -1,
      -0.2,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      "0.25",
      "25",
      "25,5",
      "banana",
      "",
      "   ",
      null,
      undefined,
      {},
      [],
    ];

    for (const v of cases) {
      const out = normalizePercent(v as any);
      expectFiniteNonNegative(out);
    }
  });

  it("normalizePercent deve manter idempotência: normalize(normalize(x)) = normalize(x)", () => {
    const samples: any[] = [
      0.23,
      23,
      0,
      1,
      100,
      "0.23",
      "23",
      Number.NaN,
      -10,
      "25,5",
    ];

    for (const s of samples) {
      const a = normalizePercent(s as any);
      const b = normalizePercent(a as any);
      expect(b).toBe(a);
    }
  });

  it("compareEngagement deve gerar deltaLabel em pp e trend correto", () => {
    const up = compareEngagement(12.5, 10);
    expect(up.trend).toBe("up");
    expect(up.delta).toBeCloseTo(2.5, 6);
    expect(String(up.deltaLabel)).toContain("pp");

    const down = compareEngagement(8, 10);
    expect(down.trend).toBe("down");
  });

  it("compareEngagement: invariantes (delta finito, label sempre string, trend válido)", () => {
    const cases: Array<{ curr: any; prev: any }> = [
      { curr: 10, prev: 10 },
      { curr: 12.5, prev: 10 },
      { curr: 8, prev: 10 },
      { curr: 0, prev: 10 },
      { curr: 10, prev: 0 },
      { curr: Number.NaN, prev: 10 },
      { curr: 10, prev: Number.NaN },
      { curr: Number.POSITIVE_INFINITY, prev: 10 },
      { curr: 10, prev: Number.POSITIVE_INFINITY },
      { curr: -10, prev: 10 },
      { curr: "12,5", prev: "10" },
      { curr: "banana", prev: 10 },
      { curr: 10, prev: "banana" },
      { curr: null, prev: 10 },
      { curr: undefined, prev: 10 },
    ];

    for (const c of cases) {
      const out = compareEngagement(c.curr as any, c.prev as any);

      expectFinite(out.delta);
      expect(typeof out.deltaLabel).toBe("string");
      expectTrend(out.trend);

      expect(Number.isNaN(out.delta)).toBe(false);
    }
  });

  it("compareEngagement: quando curr === prev, trend deve ser flat/same/neutral (não up/down)", () => {
    const out = compareEngagement(10, 10);
    expectTrend(out.trend);
    expect(["up", "down"]).not.toContain(String(out.trend));
    expect(out.delta).toBeCloseTo(0, 10);
  });

  it("stress: 10k pares aleatórios não podem gerar NaN/Infinity", () => {
    for (let i = 0; i < 10000; i++) {
      const prev = Math.random() * 200 - 50;
      const curr = Math.random() * 200 - 50;

      const rate = calculateEngagementRate({
        reach: Math.random() > 0.1 ? Math.random() * 100000 : 0,
        totalInteractions: Math.random() > 0.1 ? Math.random() * 100000 : -10,
      } as any);

      const norm = normalizePercent(
        Math.random() > 0.2 ? Math.random() : Number.NaN,
      );
      const cmp = compareEngagement(curr, prev);

      expectFiniteNonNegative(rate);
      expectFiniteNonNegative(norm);

      expectFinite(cmp.delta);
      expect(Number.isNaN(cmp.delta)).toBe(false);
      expect(typeof cmp.deltaLabel).toBe("string");
      expectTrend(cmp.trend);
    }
  });
});
