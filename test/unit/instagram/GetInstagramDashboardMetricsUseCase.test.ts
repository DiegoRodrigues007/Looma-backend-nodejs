// test/unit/instagram/GetInstagramDashboardMetricsUseCase.test.ts
import { GetInstagramDashboardMetricsUseCase } from "../../../src/application/use-cases/instagram/GetInstagramDashboardMetricsUseCase";
import { mulberry32, randInt, ymdRange, pickSubset } from "../helpers/stress";

function mkRow(dayYmd: string, data: Partial<any>) {
  return {
    day: new Date(`${dayYmd}T00:00:00.000Z`),
    followers: data.followers ?? null,
    reach: data.reach ?? null,
    profileViewsTotal: data.profileViewsTotal ?? null,
    totalInteractions: data.totalInteractions ?? null,
  };
}

function makePrisma() {
  return {
    instagramAccountDailyMetrics: {
      findMany: jest.fn(),
    },
    metricsSnapshot: {
      findUnique: jest.fn(),
    },
  } as any;
}

function sumNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function safeReadNumber(obj: any, key: string): number {
  const n = Number(obj?.[key]);
  return Number.isFinite(n) ? n : 0;
}

function isYmd(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s));
}

function assertSortedUniqueWithinRange(dates: string[], from: string, to: string) {
  // formato
  for (const d of dates) expect(isYmd(d)).toBe(true);

  // ordenado
  const sorted = [...dates].sort();
  expect(dates).toEqual(sorted);

  // sem duplicar
  expect(new Set(dates).size).toBe(dates.length);

  // dentro do range
  if (dates.length) {
    expect(dates[0] >= from).toBe(true);
    expect(dates[dates.length - 1] <= to).toBe(true);
  }
}

function assertYmdUniqueWithinRange(days: string[], from: string, to: string) {
  // não exige ordenação; só invariantes
  for (const d of days) expect(isYmd(d)).toBe(true);
  expect(new Set(days).size).toBe(days.length);
  for (const d of days) {
    expect(d >= from).toBe(true);
    expect(d <= to).toBe(true);
  }
}

describe("GetInstagramDashboardMetricsUseCase", () => {
  beforeEach(() => jest.clearAllMocks());

  it("decide dias para backfill e monta KPIs/timeseries consistentes", async () => {
    const prisma = makePrisma();
    const backfillDays = jest.fn().mockResolvedValue({ filledDays: 2, errors: [] });

    prisma.instagramAccountDailyMetrics.findMany.mockResolvedValueOnce([
      mkRow("2026-01-01", { reach: 10, profileViewsTotal: 1, totalInteractions: 2, followers: 0 }),
      mkRow("2026-01-02", { reach: 0, profileViewsTotal: 0, totalInteractions: 0, followers: 0 }),
    ]);

    prisma.instagramAccountDailyMetrics.findMany.mockResolvedValueOnce([
      mkRow("2026-01-01", { reach: 10, profileViewsTotal: 1, totalInteractions: 2, followers: 0 }),
      mkRow("2026-01-02", { reach: 50, profileViewsTotal: 5, totalInteractions: 10, followers: 0 }),
      mkRow("2026-01-03", { reach: 40, profileViewsTotal: 4, totalInteractions: 8, followers: 0 }),
    ]);

    prisma.metricsSnapshot.findUnique.mockResolvedValueOnce({ followers: 100 }).mockResolvedValueOnce({ followers: 90 });

    const uc = new GetInstagramDashboardMetricsUseCase(prisma, backfillDays);

    const out = await uc.execute({
      requestId: "r1",
      userId: "u1",
      from: "2026-01-01",
      to: "2026-01-03",
      instagramAccountId: "acc1",
      igUserId: "ig1",
      pageAccessToken: "pat",
      force: false,
      refillZeros: true,
      alwaysRefetchLastDays: 1,
    });

    expect(backfillDays).toHaveBeenCalledTimes(1);
    expect(backfillDays.mock.calls[0][0].days).toEqual(["2026-01-02", "2026-01-03"]);

    expect(out.kpis.reach).toBe(10 + 50 + 40);
    expect(out.kpis.totalInteractions).toBe(2 + 10 + 8);

    expect(out.kpis.followersTotal).toBe(100);
    expect(out.kpis.followersGained).toBe(10);
    expect(out.kpis.followersLost).toBe(0);

    expect(out.timeseries.map((p: any) => p.date)).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);

    expect(out.meta.requestedFetchDays).toBe(2);
    expect(out.meta.filledDays).toBe(2);
    expect(out.meta.errorsCount).toBe(0);

    expect(Number.isFinite(out.summary.last7d.engagementRate)).toBe(true);
  });

  it("force=true refaz todos os dias", async () => {
    const prisma = makePrisma();
    const backfillDays = jest.fn().mockResolvedValue({ filledDays: 3, errors: [] });

    prisma.instagramAccountDailyMetrics.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        mkRow("2026-01-01", { reach: 1, profileViewsTotal: 1, totalInteractions: 1, followers: 10 }),
        mkRow("2026-01-02", { reach: 1, profileViewsTotal: 1, totalInteractions: 1, followers: 9 }),
        mkRow("2026-01-03", { reach: 1, profileViewsTotal: 1, totalInteractions: 1, followers: 8 }),
      ]);

    const uc = new GetInstagramDashboardMetricsUseCase(prisma, backfillDays);

    await uc.execute({
      requestId: "r1",
      userId: "u1",
      from: "2026-01-01",
      to: "2026-01-03",
      instagramAccountId: "acc1",
      igUserId: "ig1",
      pageAccessToken: "pat",
      force: true,
    });

    expect(backfillDays).toHaveBeenCalledTimes(1);
    expect(backfillDays.mock.calls[0][0].days).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
  });

  it("range inválido dispara erro", async () => {
    const prisma = makePrisma();
    const backfillDays = jest.fn();
    const uc = new GetInstagramDashboardMetricsUseCase(prisma, backfillDays);

    await expect(
      uc.execute({
        requestId: "r1",
        userId: "u1",
        from: "2026-01-10",
        to: "2026-01-01",
        instagramAccountId: "acc1",
        igUserId: "ig1",
        pageAccessToken: "pat",
      })
    ).rejects.toThrow("Range inválido");
  });

  describe("STRESS", () => {
    beforeAll(() => {
      jest.setTimeout(30000);
    });

    it("STRESS: 365 dias com buracos/zeros/outliers mantém invariantes (sem NaN, ordenado/único, meta soma, KPIs batem com o que voltou)", async () => {
      const prisma = makePrisma();
      const rng = mulberry32(99);

      const from = "2025-01-01";
      const to = "2025-12-31";
      const days = ymdRange(from, to);

      const backfillDays = jest.fn().mockImplementation(async ({ days: daysToFill }: any) => {
        return { filledDays: Array.isArray(daysToFill) ? daysToFill.length : 0, errors: [] };
      });

      const existingDays = pickSubset(rng, days, 0.6);
      const existingRows = existingDays.map((d) => {
        const makeZero = rng() < 0.2;
        const outlier = rng() < 0.03;

        const reach = makeZero ? 0 : outlier ? randInt(rng, 200000, 500000) : randInt(rng, 0, 50000);
        const pv = makeZero ? 0 : outlier ? randInt(rng, 20000, 90000) : randInt(rng, 0, 5000);
        const ti = makeZero ? 0 : outlier ? randInt(rng, 50000, 150000) : randInt(rng, 0, 10000);

        return mkRow(d, { reach, profileViewsTotal: pv, totalInteractions: ti, followers: 0 });
      });

      // mesmo que a gente devolva o ano todo, teu UC pode decidir retornar só uma janela (ex.: últimos ~90 dias)
      const filledRows = days.map((d) =>
        mkRow(d, {
          followers: 0,
          reach: randInt(rng, 0, 50000),
          profileViewsTotal: randInt(rng, 0, 5000),
          totalInteractions: randInt(rng, 0, 10000),
        })
      );

      prisma.instagramAccountDailyMetrics.findMany.mockResolvedValueOnce(existingRows).mockResolvedValueOnce(filledRows);

      prisma.metricsSnapshot.findUnique.mockResolvedValueOnce({ followers: 1000 }).mockResolvedValueOnce({ followers: 950 });

      const uc = new GetInstagramDashboardMetricsUseCase(prisma, backfillDays);

      const out = await uc.execute({
        requestId: "stress-1y",
        userId: "u1",
        from,
        to,
        instagramAccountId: "acc1",
        igUserId: "ig1",
        pageAccessToken: "pat",
        force: false,
        refillZeros: true,
        alwaysRefetchLastDays: 7,
      });

      // ✅ invariantes: não vazio e não maior que o range
      expect(out.timeseries.length).toBeGreaterThan(0);
      expect(out.timeseries.length).toBeLessThanOrEqual(days.length);

      // ✅ datas ordenadas/únicas e dentro do range informado
      const dates = out.timeseries.map((p: any) => p.date);
      assertSortedUniqueWithinRange(dates, from, to);

      // ✅ (não assume que termina em `to`, só garante que não passa do `to`)
      expect(dates[dates.length - 1] <= to).toBe(true);

      // ✅ KPIs finitos e não negativos (campos do tipo real)
      expect(Number.isFinite(out.kpis.reach)).toBe(true);
      expect(Number.isFinite(out.kpis.totalInteractions)).toBe(true);
      expect(Number.isFinite(out.kpis.engagementRate)).toBe(true);

      expect(out.kpis.reach).toBeGreaterThanOrEqual(0);
      expect(out.kpis.totalInteractions).toBeGreaterThanOrEqual(0);

      // ✅ followers via snapshot (contrato do teu UC)
      expect(out.kpis.followersTotal).toBe(1000);
      expect(out.kpis.followersGained).toBe(50);
      expect(out.kpis.followersLost).toBe(0);

      // ✅ summary sem NaN/Infinity
      expect(Number.isFinite(out.summary.last7d.engagementRate)).toBe(true);
      expect(Number.isFinite(out.summary.last30d.engagementRate)).toBe(true);

      // ✅ meta consistente
      expect(out.meta.requestedFetchDays).toBeGreaterThanOrEqual(0);
      expect(out.meta.filledDays).toBeGreaterThanOrEqual(0);
      expect(out.meta.errorsCount).toBeGreaterThanOrEqual(0);
      expect(out.meta.requestedFetchDays).toBe(out.meta.filledDays + out.meta.errorsCount);

      // ✅ KPIs batem com a soma DA TIMESERIES QUE ELE DEVOLVEU
      const sumReach = out.timeseries.reduce((acc: number, p: any) => acc + sumNum(p.reach), 0);
      const sumTi = out.timeseries.reduce((acc: number, p: any) => acc + sumNum(p.totalInteractions), 0);
      expect(out.kpis.reach).toBe(sumReach);
      expect(out.kpis.totalInteractions).toBe(sumTi);

      // ✅ opcional: se vier profileViews/profileViewsTotal na timeseries, nunca pode ser NaN
      for (const p of out.timeseries as any[]) {
        if ("profileViewsTotal" in p) expect(Number.isFinite(safeReadNumber(p, "profileViewsTotal"))).toBe(true);
        if ("profileViews" in p) expect(Number.isFinite(safeReadNumber(p, "profileViews"))).toBe(true);
      }

      // ✅ backfillDays chamado 1x e dias pedidos fazem sentido (subset do range)
      expect(backfillDays).toHaveBeenCalledTimes(1);
      const requestedDays: string[] = backfillDays.mock.calls[0][0].days;
      expect(Array.isArray(requestedDays)).toBe(true);
      expect(requestedDays.length).toBe(out.meta.requestedFetchDays);

      // não exige ordenação — só invariantes
      assertYmdUniqueWithinRange(requestedDays, from, to);
    });

    it("STRESS: 200 cenários curtos aleatórios garantem invariantes (sem NaN, ordenado/único, meta soma, KPIs batem com a timeseries)", async () => {
      const rng = mulberry32(2026);

      for (let i = 0; i < 200; i++) {
        const prisma = makePrisma();

        const startDay = randInt(rng, 1, 10);
        const len = randInt(rng, 3, 20);

        const from = `2026-01-${String(startDay).padStart(2, "0")}`;
        const to = `2026-01-${String(startDay + len - 1).padStart(2, "0")}`;
        const days = ymdRange(from, to);

        const backfillDays = jest.fn().mockImplementation(async ({ days: daysToFill }: any) => {
          return { filledDays: Array.isArray(daysToFill) ? daysToFill.length : 0, errors: [] };
        });

        const existingDays = pickSubset(rng, days, 0.5);
        const existingRows = existingDays.map((d) =>
          mkRow(d, {
            reach: rng() < 0.3 ? 0 : randInt(rng, 0, 2000),
            profileViewsTotal: rng() < 0.3 ? 0 : randInt(rng, 0, 500),
            totalInteractions: rng() < 0.3 ? 0 : randInt(rng, 0, 600),
            followers: 0,
          })
        );

        prisma.instagramAccountDailyMetrics.findMany
          .mockResolvedValueOnce(existingRows)
          .mockResolvedValueOnce(
            days.map((d) =>
              mkRow(d, {
                reach: randInt(rng, 0, 2000),
                profileViewsTotal: randInt(rng, 0, 500),
                totalInteractions: randInt(rng, 0, 600),
                followers: 0,
              })
            )
          );

        const snapTo = rng() < 0.1 ? null : { followers: randInt(rng, 0, 200000) };
        const snapPrev = rng() < 0.1 ? null : { followers: randInt(rng, 0, 200000) };
        prisma.metricsSnapshot.findUnique.mockResolvedValueOnce(snapTo).mockResolvedValueOnce(snapPrev);

        const uc = new GetInstagramDashboardMetricsUseCase(prisma, backfillDays);

        const out = await uc.execute({
          requestId: `fuzz-${i}`,
          userId: "u1",
          from,
          to,
          instagramAccountId: "acc1",
          igUserId: "ig1",
          pageAccessToken: "pat",
          force: rng() < 0.1,
          refillZeros: rng() < 0.7,
          alwaysRefetchLastDays: randInt(rng, 0, 3),
        });

        // ✅ robusto: não assume que sempre retorna o range inteiro
        expect(out.timeseries.length).toBeGreaterThan(0);
        expect(out.timeseries.length).toBeLessThanOrEqual(days.length);

        const dates = out.timeseries.map((p: any) => p.date);
        assertSortedUniqueWithinRange(dates, from, to);

        // ✅ KPIs finitos
        expect(Number.isFinite(out.kpis.reach)).toBe(true);
        expect(Number.isFinite(out.kpis.totalInteractions)).toBe(true);
        expect(Number.isFinite(out.kpis.engagementRate)).toBe(true);

        expect(out.kpis.reach).toBeGreaterThanOrEqual(0);
        expect(out.kpis.totalInteractions).toBeGreaterThanOrEqual(0);

        expect(Number.isFinite(out.summary.last7d.engagementRate)).toBe(true);

        // ✅ meta soma
        expect(out.meta.requestedFetchDays).toBe(out.meta.filledDays + out.meta.errorsCount);

        // ✅ followers métricas finitas
        expect(Number.isFinite(out.kpis.followersTotal)).toBe(true);
        expect(Number.isFinite(out.kpis.followersGained)).toBe(true);
        expect(Number.isFinite(out.kpis.followersLost)).toBe(true);

        expect(out.kpis.followersGained).toBeGreaterThanOrEqual(0);
        expect(out.kpis.followersLost).toBeGreaterThanOrEqual(0);

        // ✅ kpis coerentes com o que veio
        const sumReach = out.timeseries.reduce((acc: number, p: any) => acc + sumNum(p.reach), 0);
        const sumTi = out.timeseries.reduce((acc: number, p: any) => acc + sumNum(p.totalInteractions), 0);

        expect(out.kpis.reach).toBe(sumReach);
        expect(out.kpis.totalInteractions).toBe(sumTi);
      }
    });
  });
});
