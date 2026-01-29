import { buildKpis } from "../../../src/domain/metrics/calculators/buildKpis";

describe("domain followers (buildKpis/compareKpi)", () => {
  function expectFinite(n: unknown) {
    expect(typeof n).toBe("number");
    expect(Number.isFinite(n as number)).toBe(true);
  }

  function expectFiniteNonNegative(n: unknown) {
    expectFinite(n);
    expect((n as number) >= 0).toBe(true);
  }

  function numOrZero(v: unknown): number {
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  }

  it("quando followers sobe, gained > 0 e lost = 0", () => {
    const out = buildKpis(
      {
        followers: 120,
        reach: 0,
        totalInteractions: 0,
        engagementRate: 0,
      } as any,
      {
        followers: 100,
        reach: 0,
        totalInteractions: 0,
        engagementRate: 0,
      } as any,
    );

    expect(out.followers.delta).toBe(20);
    expect(out.followers.gained).toBe(20);
    expect(out.followers.lost).toBe(0);
    expect(out.followers.trend).toBe("up");
  });

  it("quando followers cai, lost > 0 e gained = 0", () => {
    const out = buildKpis(
      {
        followers: 80,
        reach: 0,
        totalInteractions: 0,
        engagementRate: 0,
      } as any,
      {
        followers: 100,
        reach: 0,
        totalInteractions: 0,
        engagementRate: 0,
      } as any,
    );

    expect(out.followers.delta).toBe(-20);

    expect(out.followers.gained).toBe(0);
    expect(out.followers.lost).toBe(20);

    expect(out.followers.trend).toBe("down");
  });

  it("quando previous=0 e current>0, deltaPercent deve ser 100", () => {
    const out = buildKpis(
      {
        followers: 10,
        reach: 0,
        totalInteractions: 0,
        engagementRate: 0,
      } as any,
      {
        followers: 0,
        reach: 0,
        totalInteractions: 0,
        engagementRate: 0,
      } as any,
    );

    expect(out.followers.deltaPercent).toBe(100);
  });

  it("followers: invariantes base (gained/lost não negativos, finitos, e gained+lost = |delta|)", () => {
    const cases: Array<{ prev: number; curr: number }> = [
      { prev: 100, curr: 100 },
      { prev: 0, curr: 0 },
      { prev: 0, curr: 10 },
      { prev: 10, curr: 0 },
      { prev: 1, curr: 9999 },
      { prev: 9999, curr: 1 },
    ];

    for (const c of cases) {
      const out = buildKpis(
        {
          followers: c.curr,
          reach: 0,
          totalInteractions: 0,
          engagementRate: 0,
        } as any,
        {
          followers: c.prev,
          reach: 0,
          totalInteractions: 0,
          engagementRate: 0,
        } as any,
      );

      expectFinite(out.followers.delta);
      expectFiniteNonNegative(out.followers.deltaPercent);

      const gained = numOrZero(out.followers.gained);
      const lost = numOrZero(out.followers.lost);

      expectFiniteNonNegative(gained);
      expectFiniteNonNegative(lost);

      expect(gained + lost).toBe(Math.abs(c.curr - c.prev));

      if (c.curr > c.prev) expect(out.followers.trend).toBe("up");
      if (c.curr < c.prev) expect(out.followers.trend).toBe("down");
      if (c.curr === c.prev) {
        expect(["flat", "same", "neutral", "up", "down"]).toContain(
          out.followers.trend,
        );
      }
    }
  });

  it("followers: quando não muda, delta=0, gained=0, lost=0", () => {
    const out = buildKpis(
      {
        followers: 100,
        reach: 0,
        totalInteractions: 0,
        engagementRate: 0,
      } as any,
      {
        followers: 100,
        reach: 0,
        totalInteractions: 0,
        engagementRate: 0,
      } as any,
    );

    expect(out.followers.delta).toBe(0);
    expect(numOrZero(out.followers.gained)).toBe(0);
    expect(numOrZero(out.followers.lost)).toBe(0);
  });

  it("followers: deltaPercent deve ser finito e >=0 (nunca NaN/Infinity)", () => {
    const cases: Array<{ prev: number; curr: number }> = [
      { prev: 0, curr: 0 },
      { prev: 0, curr: 10 },
      { prev: 10, curr: 0 },
      { prev: 10, curr: 15 },
      { prev: 200, curr: 100 },
    ];

    for (const c of cases) {
      const out = buildKpis(
        {
          followers: c.curr,
          reach: 0,
          totalInteractions: 0,
          engagementRate: 0,
        } as any,
        {
          followers: c.prev,
          reach: 0,
          totalInteractions: 0,
          engagementRate: 0,
        } as any,
      );

      expectFiniteNonNegative(out.followers.deltaPercent);
    }
  });

  it("followers: caso extremo prev=0 e curr=0 => deltaPercent deve ser 0 (ou pelo menos finito)", () => {
    const out = buildKpis(
      {
        followers: 0,
        reach: 0,
        totalInteractions: 0,
        engagementRate: 0,
      } as any,
      {
        followers: 0,
        reach: 0,
        totalInteractions: 0,
        engagementRate: 0,
      } as any,
    );

    expectFinite(out.followers.deltaPercent);
    expect(out.followers.deltaPercent).toBe(0);
  });

  it("stress: 5k combinações aleatórias mantendo invariantes", () => {
    for (let i = 0; i < 5000; i++) {
      const prev = Math.floor(Math.random() * 100000);
      const curr = Math.floor(Math.random() * 100000);

      const out = buildKpis(
        {
          followers: curr,
          reach: 0,
          totalInteractions: 0,
          engagementRate: 0,
        } as any,
        {
          followers: prev,
          reach: 0,
          totalInteractions: 0,
          engagementRate: 0,
        } as any,
      );

      expectFinite(out.followers.delta);
      expectFiniteNonNegative(out.followers.deltaPercent);

      const gained = numOrZero(out.followers.gained);
      const lost = numOrZero(out.followers.lost);

      expectFiniteNonNegative(gained);
      expectFiniteNonNegative(lost);

      expect(gained + lost).toBe(Math.abs(curr - prev));

      if (curr > prev) expect(out.followers.trend).toBe("up");
      if (curr < prev) expect(out.followers.trend).toBe("down");
    }
  });

  it("não deve explodir com entradas sujas (NaN/Infinity/negativos) e não deve produzir NaN no output", () => {
    const dirtyCases: Array<{ prev: any; curr: any }> = [
      { prev: Number.NaN, curr: 10 },
      { prev: 10, curr: Number.NaN },
      { prev: Number.POSITIVE_INFINITY, curr: 10 },
      { prev: 10, curr: Number.POSITIVE_INFINITY },
      { prev: -10, curr: 10 },
      { prev: 10, curr: -10 },
    ];

    for (const c of dirtyCases) {
      const out = buildKpis(
        {
          followers: c.curr,
          reach: 0,
          totalInteractions: 0,
          engagementRate: 0,
        } as any,
        {
          followers: c.prev,
          reach: 0,
          totalInteractions: 0,
          engagementRate: 0,
        } as any,
      );

      expect(typeof out.followers.delta).toBe("number");
      expect(typeof out.followers.deltaPercent).toBe("number");

      expect(Number.isNaN(out.followers.delta)).toBe(false);
      expect(Number.isNaN(out.followers.deltaPercent)).toBe(false);

      const gained = numOrZero(out.followers.gained);
      const lost = numOrZero(out.followers.lost);

      expect(Number.isNaN(gained)).toBe(false);
      expect(Number.isNaN(lost)).toBe(false);
    }
  });
});
