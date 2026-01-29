import {
  windowAgg,
  buildWindowsSummary,
} from "../../../src/domain/metrics/windows/metricsWindows";

describe("domain metricsWindows", () => {
  const ts = (
    date: string,
    reach: number,
    views: number,
    interactions: number,
  ) => ({
    date,
    followers: 0,
    reach,
    profileViews: views,
    totalInteractions: interactions,
    engagementRate: 0,
  });

  function expectFiniteNonNegative(n: unknown) {
    expect(typeof n).toBe("number");
    expect(Number.isFinite(n as number)).toBe(true);
    expect((n as number) >= 0).toBe(true);
  }

  it("windowAgg deve somar últimos N dias e calcular engagementRate", () => {
    const series = [
      ts("2026-01-01", 100, 10, 5),
      ts("2026-01-02", 200, 20, 10),
      ts("2026-01-03", 300, 30, 15),
    ];

    const out = windowAgg(series as any, 2);
    expect(out.reach).toBe(200 + 300);
    expect(out.profileViews).toBe(20 + 30);
    expect(out.totalInteractions).toBe(10 + 15);
    expect(out.engagementRate).toBeCloseTo(((10 + 15) / (200 + 300)) * 100, 6);
  });

  it("windowAgg deve retornar engagementRate=0 se reach=0 (evita Infinity/NaN)", () => {
    const series = [ts("2026-01-01", 0, 10, 5)];
    const out = windowAgg(series as any, 7);
    expect(out.engagementRate).toBe(0);
  });

  it("windowAgg deve ser determinístico e não depender da ordem do array", () => {
    const seriesA = [
      ts("2026-01-01", 100, 10, 5),
      ts("2026-01-02", 200, 20, 10),
      ts("2026-01-03", 300, 30, 15),
    ];

    const seriesB = [
      ts("2026-01-03", 300, 30, 15),
      ts("2026-01-01", 100, 10, 5),
      ts("2026-01-02", 200, 20, 10),
    ];

    const a = windowAgg(seriesA as any, 2);
    const b = windowAgg(seriesB as any, 2);

    expect(b.reach).toBe(a.reach);
    expect(b.profileViews).toBe(a.profileViews);
    expect(b.totalInteractions).toBe(a.totalInteractions);
    expect(b.engagementRate).toBeCloseTo(a.engagementRate, 10);
  });

  it("windowAgg não deve explodir com N=0 (retorna tudo zerado)", () => {
    const series = [
      ts("2026-01-01", 100, 10, 5),
      ts("2026-01-02", 200, 20, 10),
    ];

    const out = windowAgg(series as any, 0);

    expectFiniteNonNegative(out.reach);
    expectFiniteNonNegative(out.profileViews);
    expectFiniteNonNegative(out.totalInteractions);
    expectFiniteNonNegative(out.engagementRate);
  });

  it("windowAgg deve lidar com N maior que a série (usa tudo que tiver)", () => {
    const series = [
      ts("2026-01-01", 100, 10, 5),
      ts("2026-01-02", 200, 20, 10),
    ];

    const out = windowAgg(series as any, 999);
    expect(out.reach).toBe(300);
    expect(out.profileViews).toBe(30);
    expect(out.totalInteractions).toBe(15);
    expect(out.engagementRate).toBeCloseTo((15 / 300) * 100, 6);
  });

  it("windowAgg deve ignorar valores inválidos (NaN/Infinity/negativos) sem gerar NaN", () => {
    const series = [
      ts("2026-01-01", Number.NaN as any, 10, 5),
      ts("2026-01-02", Number.POSITIVE_INFINITY as any, Number.NaN as any, 10),
      ts("2026-01-03", -100 as any, -20 as any, -5 as any),
      ts("2026-01-04", 100, 10, 5),
    ];

    const out = windowAgg(series as any, 30);

    expectFiniteNonNegative(out.reach);
    expectFiniteNonNegative(out.profileViews);
    expectFiniteNonNegative(out.totalInteractions);
    expectFiniteNonNegative(out.engagementRate);
  });

  it("windowAgg: se reach agregado for 0, engagementRate deve ser 0 (mesmo com interações)", () => {
    const series = [ts("2026-01-01", 0, 10, 50), ts("2026-01-02", 0, 10, 50)];

    const out = windowAgg(series as any, 30);
    expect(out.reach).toBe(0);
    expect(out.engagementRate).toBe(0);
  });

  it("stress: windowAgg não deve travar com séries grandes e sempre retorna números finitos", () => {
    const series = Array.from({ length: 1000 }, (_, i) => {
      const d = new Date("2026-01-01T00:00:00.000Z");
      d.setUTCDate(d.getUTCDate() + i);
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(d.getUTCDate()).padStart(2, "0");

      const reach = i % 97 === 0 ? (Number.NaN as any) : i * 10;
      const views = i % 89 === 0 ? (Number.POSITIVE_INFINITY as any) : i;
      const interactions = i % 83 === 0 ? (-5 as any) : i * 2;

      return ts(`${y}-${m}-${dd}`, reach, views, interactions);
    });

    const out = windowAgg(series as any, 30);

    expectFiniteNonNegative(out.reach);
    expectFiniteNonNegative(out.profileViews);
    expectFiniteNonNegative(out.totalInteractions);
    expectFiniteNonNegative(out.engagementRate);
  });

  it("buildWindowsSummary deve gerar last7d e last30d", () => {
    const series = [ts("2026-01-01", 10, 1, 1)];
    const out = buildWindowsSummary(series as any);
    expect(out).toHaveProperty("last7d");
    expect(out).toHaveProperty("last30d");
  });

  it("buildWindowsSummary deve ser consistente com windowAgg (last7d/last30d)", () => {
    const series = [
      ts("2026-01-01", 10, 1, 1),
      ts("2026-01-02", 20, 2, 2),
      ts("2026-01-03", 30, 3, 3),
      ts("2026-01-04", 40, 4, 4),
      ts("2026-01-05", 50, 5, 5),
      ts("2026-01-06", 60, 6, 6),
      ts("2026-01-07", 70, 7, 7),
      ts("2026-01-08", 80, 8, 8),
    ];

    const summary = buildWindowsSummary(series as any);
    const w7 = windowAgg(series as any, 7);
    const w30 = windowAgg(series as any, 30);

    expect(summary.last7d.reach).toBe(w7.reach);
    expect(summary.last7d.profileViews).toBe(w7.profileViews);
    expect(summary.last7d.totalInteractions).toBe(w7.totalInteractions);
    expect(summary.last7d.engagementRate).toBeCloseTo(w7.engagementRate, 10);

    expect(summary.last30d.reach).toBe(w30.reach);
    expect(summary.last30d.profileViews).toBe(w30.profileViews);
    expect(summary.last30d.totalInteractions).toBe(w30.totalInteractions);
    expect(summary.last30d.engagementRate).toBeCloseTo(w30.engagementRate, 10);
  });

  it("buildWindowsSummary não deve explodir com série vazia", () => {
    const out = buildWindowsSummary([] as any);

    expect(out).toHaveProperty("last7d");
    expect(out).toHaveProperty("last30d");

    expectFiniteNonNegative(out.last7d.reach);
    expectFiniteNonNegative(out.last7d.profileViews);
    expectFiniteNonNegative(out.last7d.totalInteractions);
    expectFiniteNonNegative(out.last7d.engagementRate);

    expectFiniteNonNegative(out.last30d.reach);
    expectFiniteNonNegative(out.last30d.profileViews);
    expectFiniteNonNegative(out.last30d.totalInteractions);
    expectFiniteNonNegative(out.last30d.engagementRate);
  });

  it("buildWindowsSummary não deve produzir NaN/Infinity mesmo com dados sujos", () => {
    const series = [
      ts("2026-01-01", Number.NaN as any, 1, 1),
      ts("2026-01-02", 0, Number.POSITIVE_INFINITY as any, 2),
      ts("2026-01-03", -10 as any, -10 as any, -10 as any),
    ];

    const out = buildWindowsSummary(series as any);

    expectFiniteNonNegative(out.last7d.reach);
    expectFiniteNonNegative(out.last7d.profileViews);
    expectFiniteNonNegative(out.last7d.totalInteractions);
    expectFiniteNonNegative(out.last7d.engagementRate);

    expectFiniteNonNegative(out.last30d.reach);
    expectFiniteNonNegative(out.last30d.profileViews);
    expectFiniteNonNegative(out.last30d.totalInteractions);
    expectFiniteNonNegative(out.last30d.engagementRate);
  });
});
