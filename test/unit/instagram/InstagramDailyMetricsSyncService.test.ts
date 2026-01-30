// test/unit/instagram/InstagramDailyMetricsSyncService.test.ts
import axios from "axios";
import { prisma } from "../../mocks/prismaClient";
import { InstagramDailyMetricsSyncService } from "../../../src/application/instagram/InstagramDailyMetricsSyncService";
import { mulberry32, randInt, ymdRange } from "../helpers/stress";

type AxiosMock = {
  get: jest.Mock;
  create: jest.Mock;
};

const ax = axios as unknown as AxiosMock;

/**
 * Args reais que a gente usa no teste (pra tipar spy.mock.calls e evitar TS2571)
 */
type SyncDayArgs = {
  userId: string;
  instagramAccountId: string;
  igUserId: string;
  pageAccessToken: string;
  dayYmd: string;
};

/**
 * Helpers de payload (Meta Graph)
 */
function mkInsightsPayload(vals: Partial<{ reach: any; profile_views: any; accounts_engaged: any }>) {
  const data: any[] = [];
  if ("reach" in vals) data.push({ name: "reach", values: [{ value: vals.reach }] });
  if ("profile_views" in vals) data.push({ name: "profile_views", values: [{ value: vals.profile_views }] });
  if ("accounts_engaged" in vals) data.push({ name: "accounts_engaged", values: [{ value: vals.accounts_engaged }] });
  return { data: { data } };
}

function lastUpsertCreate() {
  const calls = (prisma as any).instagramAccountDailyMetrics.upsert.mock.calls as any[];
  return calls[calls.length - 1]?.[0]?.create;
}

describe("InstagramDailyMetricsSyncService", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // estende prisma mock para esse service
    (prisma as any).instagramAccountDailyMetrics = {
      upsert: jest.fn(),
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    };
  });

  it("syncDayForAccount: busca followers + insights e faz upsert no dia", async () => {
    ax.get
      // followers_count
      .mockResolvedValueOnce({ data: { followers_count: 321 } })
      // insights
      .mockResolvedValueOnce(
        mkInsightsPayload({
          reach: 1000,
          profile_views: 40,
          accounts_engaged: 80,
        })
      );

    (prisma as any).instagramAccountDailyMetrics.upsert.mockResolvedValueOnce({ id: "row1" });

    const svc = new InstagramDailyMetricsSyncService();

    const out = await svc.syncDayForAccount({
      userId: "u1",
      instagramAccountId: "acc1",
      igUserId: "ig1",
      pageAccessToken: "pat",
      dayYmd: "2026-01-19",
    });

    expect(out).toEqual(
      expect.objectContaining({
        ok: true,
        day: "2026-01-19",
        followers: 321,
        reach: 1000,
        profileViews: 40,
        accountsEngaged: 80,
      })
    );

    expect((prisma as any).instagramAccountDailyMetrics.upsert).toHaveBeenCalledTimes(1);

    const create = lastUpsertCreate();
    expect(create).toEqual(
      expect.objectContaining({
        userId: "u1",
        instagramAccountId: "acc1",
        followers: 321,
        reach: 1000,
        profileViewsTotal: 40,
        totalInteractions: 80,
      })
    );
  });

  it("syncDayForAccount: valida parâmetros", async () => {
    const svc = new InstagramDailyMetricsSyncService();

    await expect(
      svc.syncDayForAccount({
        userId: "",
        instagramAccountId: "acc1",
        igUserId: "ig1",
        pageAccessToken: "pat",
        dayYmd: "2026-01-19",
      })
    ).rejects.toThrow("syncDayForAccount: parâmetros inválidos");
  });

  it("syncRangeForUserActiveAccount: usa activeInstagramAccountId quando existir", async () => {
    (prisma as any).user.findUnique.mockResolvedValueOnce({ activeInstagramAccountId: "accACTIVE" });

    (prisma as any).instagramAccount.findFirst.mockResolvedValueOnce({
      id: "accACTIVE",
      igUserId: "ig1",
      pageAccessToken: "pat",
    });

    const svc = new InstagramDailyMetricsSyncService();

    const spy = jest
      .spyOn(svc as any, "syncDayForAccount")
      .mockResolvedValue({ ok: true, day: "x" } as any);

    const out = await svc.syncRangeForUserActiveAccount({
      userId: "u1",
      from: "2026-01-01",
      to: "2026-01-03",
    });

    expect(out.ok).toBe(true);
    expect(out.instagramAccountId).toBe("accACTIVE");
    expect(out.totalDays).toBe(3);
    expect(spy).toHaveBeenCalledTimes(3);

    // ✅ TIPAGEM: evita TS2571
    const calls = spy.mock.calls as Array<[SyncDayArgs]>;
    const days = calls.map(([arg]) => arg.dayYmd);

    expect(days).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
  });

  it("syncRangeForUserActiveAccount: fallback para última conta conectada quando não tem active", async () => {
    (prisma as any).user.findUnique.mockResolvedValueOnce({ activeInstagramAccountId: null });

    (prisma as any).instagramAccount.findFirst.mockResolvedValueOnce({
      id: "accLAST",
      igUserId: "ig2",
      pageAccessToken: "pat2",
    });

    const svc = new InstagramDailyMetricsSyncService();

    jest.spyOn(svc as any, "syncDayForAccount").mockResolvedValue({ ok: true, day: "x" } as any);

    const out = await svc.syncRangeForUserActiveAccount({
      userId: "u1",
      from: "2026-01-10",
      to: "2026-01-10",
    });

    expect(out.instagramAccountId).toBe("accLAST");
    expect(out.totalDays).toBe(1);
  });

  describe("STRESS", () => {
    beforeAll(() => {
      jest.setTimeout(20000);
    });

    it("STRESS: 1000 variações de payload (valores ausentes/string/null) nunca geram NaN e sempre fazem upsert", async () => {
      const rng = mulberry32(7);
      const svc = new InstagramDailyMetricsSyncService();

      for (let i = 0; i < 1000; i++) {
        const fcVariant = rng();
        const followers_count: any =
          fcVariant < 0.15
            ? undefined
            : fcVariant < 0.25
            ? null
            : fcVariant < 0.35
            ? String(randInt(rng, 0, 200000))
            : randInt(rng, 0, 200000);

        const reachVariant = rng();
        const reachVal: any =
          reachVariant < 0.2
            ? null
            : reachVariant < 0.35
            ? "10"
            : reachVariant < 0.5
            ? undefined
            : randInt(rng, 0, 50000);

        const pvVariant = rng();
        const pvVal: any =
          pvVariant < 0.2
            ? null
            : pvVariant < 0.35
            ? "5"
            : pvVariant < 0.5
            ? undefined
            : randInt(rng, 0, 5000);

        const aeVariant = rng();
        const aeVal: any =
          aeVariant < 0.2
            ? null
            : aeVariant < 0.35
            ? "7"
            : aeVariant < 0.5
            ? undefined
            : randInt(rng, 0, 10000);

        const insightsEmpty = rng() < 0.3;

        ax.get
          .mockResolvedValueOnce({ data: { followers_count } })
          .mockResolvedValueOnce(
            insightsEmpty
              ? { data: { data: [] } }
              : mkInsightsPayload({
                  reach: reachVal,
                  profile_views: pvVal,
                  accounts_engaged: aeVal,
                })
          );

        (prisma as any).instagramAccountDailyMetrics.upsert.mockResolvedValueOnce({ id: `row-${i}` });

        const out = await svc.syncDayForAccount({
          userId: "u1",
          instagramAccountId: "acc1",
          igUserId: "ig1",
          pageAccessToken: "pat",
          dayYmd: "2026-01-19",
        });

        expect(out.ok).toBe(true);
        expect(Number.isFinite(out.followers)).toBe(true);
        expect(Number.isFinite(out.reach)).toBe(true);
        expect(Number.isFinite(out.profileViews)).toBe(true);
        expect(Number.isFinite(out.accountsEngaged)).toBe(true);

        expect(out.followers).toBeGreaterThanOrEqual(0);
        expect(out.reach).toBeGreaterThanOrEqual(0);
        expect(out.profileViews).toBeGreaterThanOrEqual(0);
        expect(out.accountsEngaged).toBeGreaterThanOrEqual(0);

        expect((prisma as any).instagramAccountDailyMetrics.upsert).toHaveBeenCalledTimes(i + 1);

        const create = lastUpsertCreate();
        expect(create.userId).toBe("u1");
        expect(create.instagramAccountId).toBe("acc1");
        expect(create.day).toBeInstanceOf(Date);
        expect(Number.isFinite(create.totalInteractions)).toBe(true);
        expect(create.totalInteractions).toBeGreaterThanOrEqual(0);
      }
    });

    it("STRESS: syncRange gera sequência perfeita de dias (31 dias) e chama syncDayForAccount para cada dia", async () => {
      const svc = new InstagramDailyMetricsSyncService();

      (prisma as any).user.findUnique.mockResolvedValue({ activeInstagramAccountId: "accACTIVE" });
      (prisma as any).instagramAccount.findFirst.mockResolvedValue({
        id: "accACTIVE",
        igUserId: "ig1",
        pageAccessToken: "pat",
      });

      const spy = jest
        .spyOn(svc as any, "syncDayForAccount")
        .mockResolvedValue({ ok: true, day: "x" } as any);

      const from = "2026-01-01";
      const to = "2026-01-31";
      const expected = ymdRange(from, to);

      const out = await svc.syncRangeForUserActiveAccount({ userId: "u1", from, to });

      expect(out.ok).toBe(true);
      expect(out.totalDays).toBe(expected.length);
      expect(spy).toHaveBeenCalledTimes(expected.length);

      // ✅ TIPAGEM: evita TS2571
      const calls = spy.mock.calls as Array<[SyncDayArgs]>;
      const days = calls.map(([arg]) => arg.dayYmd);

      expect(days).toEqual(expected);
    });

    it("STRESS: insights falhando (axios reject) propaga erro (não grava métrica fantasma)", async () => {
      const svc = new InstagramDailyMetricsSyncService();

      ax.get
        .mockResolvedValueOnce({ data: { followers_count: 123 } })
        .mockRejectedValueOnce(new Error("Graph insights down"));

      await expect(
        svc.syncDayForAccount({
          userId: "u1",
          instagramAccountId: "acc1",
          igUserId: "ig1",
          pageAccessToken: "pat",
          dayYmd: "2026-01-19",
        })
      ).rejects.toThrow();

      expect((prisma as any).instagramAccountDailyMetrics.upsert).not.toHaveBeenCalled();
    });
  });
});
