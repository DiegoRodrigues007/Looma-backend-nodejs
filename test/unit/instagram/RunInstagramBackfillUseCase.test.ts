// test/unit/instagram/RunInstagramBackfillUseCase.test.ts
import axios from "axios";
import { prisma } from "../../mocks/prismaClient";
import { RunInstagramBackfillUseCase } from "../../../src/application/use-cases/instagram/RunInstagramBackfillUseCase";
import { mulberry32, randInt, ymdRange } from "../helpers/stress";

type AxiosMock = { get: jest.Mock };
const ax = axios as unknown as AxiosMock;

function mkDailyRow(dayYmd: string, reach: number, pv: number, ti: number) {
  return {
    id: `row-${dayYmd}`,
    userId: "u1",
    instagramAccountId: "acc1",
    day: new Date(`${dayYmd}T00:00:00.000Z`),
    followers: null,
    reach,
    profileViewsTotal: pv,
    totalInteractions: ti,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

type UpsertCall = {
  where: any;
  create: any;
  update: any;
};

function getUpsertCalls(): UpsertCall[] {
  return ((prisma as any).instagramAccountDailyMetrics.upsert.mock.calls as any[]).map((c) => c[0]);
}

function resetDbMocks() {
  (prisma as any).instagramAccountDailyMetrics = {
    findMany: jest.fn(),
    upsert: jest.fn(),
  };

  (prisma as any).metricsSnapshot = {
    upsert: jest.fn(),
  };
}

function mockAccountResolved() {
  (prisma as any).user.findUnique.mockResolvedValue({ activeInstagramAccountId: "acc1" });
  (prisma as any).instagramAccount.findFirst.mockResolvedValue({
    id: "acc1",
    userId: "u1",
    isConnected: true,
    igUserId: "ig1",
    pageAccessToken: "pat",
    updatedAt: new Date(),
  });
}

describe("RunInstagramBackfillUseCase", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetDbMocks();
  });

  it("faz backfill apenas dos dias necessários e salva snapshot de followers no final", async () => {
    mockAccountResolved();

    // existing: dia 01 ok, dia 02 tudo zero (deve refazer), dia 03 faltando (deve buscar)
    (prisma as any).instagramAccountDailyMetrics.findMany.mockResolvedValueOnce([
      mkDailyRow("2026-01-01", 10, 10, 10),
      mkDailyRow("2026-01-02", 0, 0, 0),
    ]);

    ax.get.mockImplementation(async (url: string) => {
      if (url.includes("fields=followers_count")) return { data: { followers_count: 999 } };

      if (url.includes("metric=reach")) {
        return { data: { data: [{ name: "reach", values: [{ value: 100 }] }] } };
      }

      if (url.includes("metric=profile_views,total_interactions")) {
        return {
          data: {
            data: [
              { name: "profile_views", values: [{ value: 7 }] },
              { name: "total_interactions", values: [{ value: { value: 9 } }] },
            ],
          },
        };
      }

      return { data: {} };
    });

    (prisma as any).instagramAccountDailyMetrics.upsert.mockResolvedValue({ id: "x" });
    (prisma as any).metricsSnapshot.upsert.mockResolvedValue({ followers: 999 });

    const uc = new RunInstagramBackfillUseCase();

    const out = await uc.execute({
      userId: "u1",
      from: "2026-01-01",
      to: "2026-01-03",
      alwaysRefetchLastDays: 1,
      concurrency: 2,
      refillZeros: true,
    });

    expect(out.ok).toBe(true);
    expect(out.instagramAccountIdUsed).toBe("acc1");
    expect(out.plannedDays).toBe(2);
    expect(out.fetchedDays).toBe(2);
    expect(out.errorsCount).toBe(0);

    expect((prisma as any).instagramAccountDailyMetrics.upsert).toHaveBeenCalledTimes(2);

    // followers não pode “poluir” daily
    for (const c of getUpsertCalls()) {
      expect(c.create.followers).toBeNull();
      expect(c.update.followers).toBeNull();
    }

    expect((prisma as any).metricsSnapshot.upsert).toHaveBeenCalledTimes(1);
    expect(out.followersSnapshot).toEqual({ day: "2026-01-03", followers: 999 });
  });

  it("captura erro do Graph por dia e continua (errorsCount > 0)", async () => {
    mockAccountResolved();

    (prisma as any).instagramAccountDailyMetrics.findMany.mockResolvedValueOnce([]); // tudo faltando

    ax.get.mockImplementation(async (url: string) => {
      if (url.includes("fields=followers_count")) return { data: { followers_count: 10 } };

      // faz o A falhar (insights reach vazio)
      if (url.includes("metric=reach")) return { data: { data: [] } };

      return { data: {} };
    });

    const uc = new RunInstagramBackfillUseCase();

    const out = await uc.execute({
      userId: "u1",
      from: "2026-01-01",
      to: "2026-01-01",
      concurrency: 1,
    });

    expect(out.plannedDays).toBe(1);
    expect(out.fetchedDays).toBe(0);
    expect(out.errorsCount).toBe(1);
    expect(out.errorsPreview[0]).toEqual(expect.objectContaining({ day: "2026-01-01" }));

    expect((prisma as any).metricsSnapshot.upsert).toHaveBeenCalledTimes(1);
  });

  it("com refillZeros=false não refaz dia antigo zerado (exceto tail)", async () => {
    mockAccountResolved();

    (prisma as any).instagramAccountDailyMetrics.findMany.mockResolvedValueOnce([
      mkDailyRow("2026-01-01", 0, 0, 0), // zero antigo
      mkDailyRow("2026-01-02", 0, 0, 0), // tail (alwaysRefetchLastDays=1 => tail é 02)
    ]);

    ax.get.mockImplementation(async (url: string) => {
      if (url.includes("fields=followers_count")) return { data: { followers_count: 1 } };
      if (url.includes("metric=reach")) {
        return { data: { data: [{ name: "reach", values: [{ value: 1 }] }] } };
      }
      if (url.includes("metric=profile_views,total_interactions")) return { data: { data: [] } };
      return { data: {} };
    });

    (prisma as any).instagramAccountDailyMetrics.upsert.mockResolvedValue({ id: "x" });
    (prisma as any).metricsSnapshot.upsert.mockResolvedValue({ followers: 1 });

    const uc = new RunInstagramBackfillUseCase();

    const out = await uc.execute({
      userId: "u1",
      from: "2026-01-01",
      to: "2026-01-02",
      alwaysRefetchLastDays: 1,
      refillZeros: false,
      concurrency: 1,
    });

    expect(out.plannedDays).toBe(1);
    expect((prisma as any).instagramAccountDailyMetrics.upsert).toHaveBeenCalledTimes(1);
  });

  describe("STRESS", () => {
    beforeAll(() => {
      jest.setTimeout(30000);
    });

    it("STRESS: 120 dias com buracos + zeros + tail => plannedDays = fetchedDays + errorsCount e nunca grava followers em daily", async () => {
      mockAccountResolved();

      const rng = mulberry32(4242);

      const from = "2026-01-01";
      const to = "2026-04-30"; // 120 dias
      const days = ymdRange(from, to);

      // gera existing (parte preenchida) com zeros espalhados e buracos
      const existing: any[] = [];
      for (const d of days) {
        const p = rng();

        // 35% buraco (não existe no DB)
        if (p < 0.35) continue;

        // 20% vira zero (candidato a refill quando refillZeros=true)
        const isZero = p >= 0.35 && p < 0.55;

        existing.push(
          mkDailyRow(
            d,
            isZero ? 0 : randInt(rng, 0, 50000),
            isZero ? 0 : randInt(rng, 0, 5000),
            isZero ? 0 : randInt(rng, 0, 20000)
          )
        );
      }

      (prisma as any).instagramAccountDailyMetrics.findMany.mockResolvedValueOnce(existing);

      // mock axios com falha intermitente e com "delay" curtinho pra simular carga
      ax.get.mockImplementation(async (url: string) => {
        // pequena latência (força concorrência trabalhar, sem virar integração)
        await new Promise((r) => setTimeout(r, 1));

        // followers snapshot sempre ok (não atrapalha o job terminar)
        if (url.includes("fields=followers_count")) {
          return { data: { followers_count: 1000 } };
        }

        // falhas intermitentes em 15% das chamadas de insights
        const p = rng();
        if (p < 0.15) {
          const err: any = new Error(p < 0.07 ? "rate-limit" : "graph-500");
          err.response = { status: p < 0.07 ? 429 : 500 };
          throw err;
        }

        if (url.includes("metric=reach")) {
          // 5% retorna vazio (simula resposta estranha)
          if (rng() < 0.05) return { data: { data: [] } };
          return { data: { data: [{ name: "reach", values: [{ value: randInt(rng, 0, 50000) }] }] } };
        }

        if (url.includes("metric=profile_views,total_interactions")) {
          // 10% retorna vazio (service deve aceitar? no teu código atual, reach vazio já falha)
          if (rng() < 0.1) return { data: { data: [] } };
          return {
            data: {
              data: [
                { name: "profile_views", values: [{ value: randInt(rng, 0, 5000) }] },
                { name: "total_interactions", values: [{ value: { value: randInt(rng, 0, 20000) } }] },
              ],
            },
          };
        }

        return { data: {} };
      });

      (prisma as any).instagramAccountDailyMetrics.upsert.mockResolvedValue({ id: "x" });
      (prisma as any).metricsSnapshot.upsert.mockResolvedValue({ followers: 1000 });

      const uc = new RunInstagramBackfillUseCase();

      const out = await uc.execute({
        userId: "u1",
        from,
        to,
        alwaysRefetchLastDays: 7,
        concurrency: 10,
        refillZeros: true,
      });

      expect(out.ok).toBe(true);
      expect(out.instagramAccountIdUsed).toBe("acc1");

      // invariantes críticas:
      expect(out.plannedDays).toBe(out.fetchedDays + out.errorsCount);
      expect(out.plannedDays).toBeGreaterThan(0);

      // deve sempre fazer snapshot final mesmo com erros
      expect((prisma as any).metricsSnapshot.upsert).toHaveBeenCalledTimes(1);

      // nunca grava followers no daily (anti-métrica fantasma)
      for (const c of getUpsertCalls()) {
        expect(c.create.followers).toBeNull();
        expect(c.update.followers).toBeNull();
      }
    });

    it("STRESS: refillZeros=false NÃO refaz zeros antigos; só tail + faltantes", async () => {
      mockAccountResolved();

      const from = "2026-01-01";
      const to = "2026-01-30";
      const days = ymdRange(from, to);

      // monta existing completo, mas com vários zeros antigos
      const rng = mulberry32(888);
      const existing = days.map((d, idx) => {
        const isOldZero = idx < days.length - 7 && rng() < 0.5; // zeros antigos
        return mkDailyRow(
          d,
          isOldZero ? 0 : randInt(rng, 0, 1000),
          isOldZero ? 0 : randInt(rng, 0, 100),
          isOldZero ? 0 : randInt(rng, 0, 200)
        );
      });

      (prisma as any).instagramAccountDailyMetrics.findMany.mockResolvedValueOnce(existing);

      // axios sempre ok (pra plannedDays = fetchedDays)
      ax.get.mockImplementation(async (url: string) => {
        if (url.includes("fields=followers_count")) return { data: { followers_count: 10 } };
        if (url.includes("metric=reach")) return { data: { data: [{ name: "reach", values: [{ value: 1 }] }] } };
        if (url.includes("metric=profile_views,total_interactions")) {
          return {
            data: {
              data: [
                { name: "profile_views", values: [{ value: 1 }] },
                { name: "total_interactions", values: [{ value: { value: 1 } }] },
              ],
            },
          };
        }
        return { data: {} };
      });

      (prisma as any).instagramAccountDailyMetrics.upsert.mockResolvedValue({ id: "x" });
      (prisma as any).metricsSnapshot.upsert.mockResolvedValue({ followers: 10 });

      const uc = new RunInstagramBackfillUseCase();

      const out = await uc.execute({
        userId: "u1",
        from,
        to,
        alwaysRefetchLastDays: 7,
        refillZeros: false,
        concurrency: 5,
      });


      expect(out.ok).toBe(true);
      expect(out.plannedDays).toBe(7);
      expect(out.fetchedDays).toBe(7);
      expect(out.errorsCount).toBe(0);
      expect((prisma as any).instagramAccountDailyMetrics.upsert).toHaveBeenCalledTimes(7);

      // anti-fantasma: followers nunca entra no daily
      for (const c of getUpsertCalls()) {
        expect(c.create.followers).toBeNull();
        expect(c.update.followers).toBeNull();
      }
    });

    it("STRESS: erro de conta inexistente/conectada retorna falha coerente (não tenta chamar axios)", async () => {
      // simula não ter conta conectada
      (prisma as any).user.findUnique.mockResolvedValueOnce({ activeInstagramAccountId: "acc1" });
      (prisma as any).instagramAccount.findFirst.mockResolvedValueOnce(null);

      const uc = new RunInstagramBackfillUseCase();

      await expect(
        uc.execute({
          userId: "u1",
          from: "2026-01-01",
          to: "2026-01-02",
          concurrency: 2,
        })
      ).rejects.toThrow();

      expect(ax.get).not.toHaveBeenCalled();
      expect((prisma as any).instagramAccountDailyMetrics.upsert).not.toHaveBeenCalled();
      expect((prisma as any).metricsSnapshot.upsert).not.toHaveBeenCalled();
    });
  });
});
