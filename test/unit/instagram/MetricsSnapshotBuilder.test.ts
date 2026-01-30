// test/unit/metrics/MetricsSnapshotBuilder.test.ts
import { MetricsSnapshot } from "../../../src/domain/entities/MetricsSnapshot";
import { aggregateSnapshotsAverage } from "../../../src/domain/metrics/calculators/aggregateSnapshots";
import { MetricsHistoryService } from "../../../src/application/services/metrics/MetricsHistoryService";
import { mulberry32, randInt } from "../helpers/stress";

function mkPrismaP2002Error(): any {
  // Simula erro do Prisma de unique constraint
  const e: any = new Error("Unique constraint failed on the fields");
  e.code = "P2002";
  e.meta = { target: ["userId", "platform", "date"] };
  return e;
}

describe("MetricsSnapshotBuilder (aggregateSnapshotsAverage + MetricsHistoryService)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("aggregateSnapshotsAverage: faz média e arredonda followers/reach/interactions; engagementRate média sem round", () => {
    const data = [
      new MetricsSnapshot("u1", "instagram", new Date("2026-01-01T00:00:00.000Z"), 101, 10, 7, 2.5),
      new MetricsSnapshot("u1", "instagram", new Date("2026-01-02T00:00:00.000Z"), 100, 11, 8, 3.5),
    ];

    const out = aggregateSnapshotsAverage({
      userId: "u1",
      platform: "instagram",
      date: new Date("2026-01-31T00:00:00.000Z"),
      data,
    });

    expect(out).not.toBeNull();
    expect(out!.followers).toBe(Math.round((101 + 100) / 2));
    expect(out!.reach).toBe(Math.round((10 + 11) / 2));
    expect(out!.totalInteractions).toBe(Math.round((7 + 8) / 2));
    expect(out!.engagementRate).toBe((2.5 + 3.5) / 2);
  });

  it("MetricsHistoryService.ensureDailySnapshot: não duplica snapshot do mesmo dia", async () => {
    const repo = {
      findByDate: jest.fn(),
      save: jest.fn(),
      findRange: jest.fn(),
    } as any;

    const svc = new MetricsHistoryService(repo);

    const day = new Date("2026-01-10T15:00:00.000Z");

    repo.findByDate.mockResolvedValueOnce(null);

    const first = await svc.ensureDailySnapshot(
      "u1",
      "instagram",
      { followers: 1, reach: 2, totalInteractions: 3, engagementRate: 4 },
      day
    );

    expect(first).toBe(true);
    expect(repo.save).toHaveBeenCalledTimes(1);

    repo.findByDate.mockResolvedValueOnce(
      new MetricsSnapshot("u1", "instagram", new Date("2026-01-10T00:00:00.000Z"), 1, 2, 3, 4)
    );

    const second = await svc.ensureDailySnapshot(
      "u1",
      "instagram",
      { followers: 1, reach: 2, totalInteractions: 3, engagementRate: 4 },
      day
    );

    expect(second).toBe(false);
    expect(repo.save).toHaveBeenCalledTimes(1);
  });

  describe("STRESS", () => {
    beforeAll(() => {
      jest.setTimeout(30000);
    });

    it("STRESS: aggregateSnapshotsAverage com 5000 snapshots aleatórios nunca gera NaN e respeita regra de rounding", () => {
      const rng = mulberry32(20260130);

      const userId = "u1";
      const platform = "instagram";
      const date = new Date("2026-01-31T00:00:00.000Z");

      const N = 5000;

      const data: MetricsSnapshot[] = [];
      let sumFollowers = 0;
      let sumReach = 0;
      let sumTi = 0;
      let sumEr = 0;

      for (let i = 0; i < N; i++) {
        const followers = randInt(rng, 0, 500000);
        const reach = randInt(rng, 0, 100000);
        const ti = randInt(rng, 0, 50000);

        const er = Math.round((randInt(rng, 0, 10000) / 100) * 100) / 100;

        sumFollowers += followers;
        sumReach += reach;
        sumTi += ti;
        sumEr += er;

        const d = new Date(Date.UTC(2026, 0, 1 + (i % 28), 0, 0, 0, 0));
        data.push(new MetricsSnapshot(userId, platform, d, followers, reach, ti, er));
      }

      const out = aggregateSnapshotsAverage({ userId, platform, date, data });

      expect(out).not.toBeNull();

      const expFollowers = Math.round(sumFollowers / N);
      const expReach = Math.round(sumReach / N);
      const expTi = Math.round(sumTi / N);
      const expEr = sumEr / N;

      expect(out!.followers).toBe(expFollowers);
      expect(out!.reach).toBe(expReach);
      expect(out!.totalInteractions).toBe(expTi);
      expect(out!.engagementRate).toBe(expEr);

      expect(Number.isFinite(out!.followers)).toBe(true);
      expect(Number.isFinite(out!.reach)).toBe(true);
      expect(Number.isFinite(out!.totalInteractions)).toBe(true);
      expect(Number.isFinite(out!.engagementRate)).toBe(true);

      expect(out!.followers).toBeGreaterThanOrEqual(0);
      expect(out!.reach).toBeGreaterThanOrEqual(0);
      expect(out!.totalInteractions).toBeGreaterThanOrEqual(0);
      expect(out!.engagementRate).toBeGreaterThanOrEqual(0);
    });

    it("STRESS: aggregateSnapshotsAverage com data vazia retorna null (não cria snapshot fantasma)", () => {
      const out = aggregateSnapshotsAverage({
        userId: "u1",
        platform: "instagram",
        date: new Date("2026-01-31T00:00:00.000Z"),
        data: [],
      });

      expect(out).toBeNull();
    });

    it("STRESS: ensureDailySnapshot com 200 chamadas concorrentes no mesmo dia só cria 1 (os outros viram false via unique constraint)", async () => {
      // Repo “realista”: não tem lock; quem garante idempotência é UNIQUE + tratamento de erro
      const repo = (() => {
        let stored: MetricsSnapshot | null = null;
        let created = 0; // quantos inserts efetivos aconteceram
        let saveCalls = 0;

        return {
          findByDate: jest.fn(async (_userId: string, _platform: string, _day: Date) => {
            // delay curto pra aumentar corrida
            await new Promise((r) => setTimeout(r, 1));
            return stored;
          }),
          save: jest.fn(async (snap: MetricsSnapshot) => {
            saveCalls++;
            // delay pra acentuar corrida
            await new Promise((r) => setTimeout(r, 2));

            // Se já existe, simula UNIQUE do banco
            if (stored) {
              throw mkPrismaP2002Error();
            }

            stored = snap;
            created++;
            return snap;
          }),
          findRange: jest.fn(),
          __getSaveCalls: () => saveCalls,
          __getCreated: () => created,
          __getStored: () => stored,
        };
      })();

      const svc = new MetricsHistoryService(repo as any);

      const day = new Date("2026-01-10T15:00:00.000Z");
      const payload = { followers: 1, reach: 2, totalInteractions: 3, engagementRate: 4 };

      const results = await Promise.all(
        Array.from({ length: 200 }).map(() =>
          // se teu service não trata P2002 ainda, esse teste vai falhar aqui.
          svc.ensureDailySnapshot("u1", "instagram", payload, day)
        )
      );

      // exatamente 1 true (quem “criou”)
      expect(results.filter((r) => r === true).length).toBe(1);

      // o resto false
      expect(results.filter((r) => r === false).length).toBe(199);

      // inserção efetiva só 1x
      expect(repo.__getCreated()).toBe(1);

      // save pode ser chamado mais vezes por causa da corrida — isso é esperado
      expect(repo.__getSaveCalls()).toBeGreaterThanOrEqual(1);

      const stored = repo.__getStored();
      expect(stored).toBeTruthy();
      expect(stored!.followers).toBe(1);
      expect(stored!.reach).toBe(2);
      expect(stored!.totalInteractions).toBe(3);
      expect(stored!.engagementRate).toBe(4);
    });
  });
});
