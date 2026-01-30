// test/unit/instagram/InstagramFollowersMetricsService.test.ts
import { InstagramFollowersMetricsService } from "../../../src/application/services/instagram/InstagramFollowersMetricsService";
import { mulberry32, randInt } from "../helpers/stress";

function makePrisma(overrides?: Partial<any>) {
  return {
    metricsSnapshot: {
      findUnique: jest.fn(),
    },
    ...overrides,
  } as any;
}

describe("InstagramFollowersMetricsService", () => {
  beforeEach(() => jest.clearAllMocks());

  it("calcula total/gained/lost comparando dia vs dia anterior", async () => {
    const prisma = makePrisma();

    prisma.metricsSnapshot.findUnique
      .mockResolvedValueOnce({ followers: 120 }) // day
      .mockResolvedValueOnce({ followers: 100 }); // prevDay

    const svc = new InstagramFollowersMetricsService(prisma);

    const out = await svc.getFollowersMetrics({ userId: "u1", to: "2026-01-10" });

    expect(out).toEqual(
      expect.objectContaining({
        total: 120,
        gained: 20,
        lost: 0,
        day: "2026-01-10",
        prevDay: "2026-01-09",
        totalPrevDay: 100,
      })
    );

    expect(prisma.metricsSnapshot.findUnique).toHaveBeenCalledTimes(2);
  });

  it("quando cai, lost fica positivo e gained = 0", async () => {
    const prisma = makePrisma();

    prisma.metricsSnapshot.findUnique
      .mockResolvedValueOnce({ followers: 90 }) // day
      .mockResolvedValueOnce({ followers: 100 }); // prevDay

    const svc = new InstagramFollowersMetricsService(prisma);

    const out = await svc.getFollowersMetrics({ userId: "u1", to: "2026-01-10" });

    expect(out.gained).toBe(0);
    expect(out.lost).toBe(10);
  });

  it("se não existir snapshot anterior, assume 0", async () => {
    const prisma = makePrisma();

    prisma.metricsSnapshot.findUnique
      .mockResolvedValueOnce({ followers: 50 }) // day
      .mockResolvedValueOnce(null); // prevDay

    const svc = new InstagramFollowersMetricsService(prisma);

    const out = await svc.getFollowersMetrics({ userId: "u1", to: "2026-01-10" });

    expect(out.total).toBe(50);
    expect(out.gained).toBe(50);
    expect(out.lost).toBe(0);
  });

  it("valida parâmetros", async () => {
    const prisma = makePrisma();
    const svc = new InstagramFollowersMetricsService(prisma);

    await expect(svc.getFollowersMetrics({ userId: "", to: "2026-01-10" })).rejects.toThrow(
      "userId é obrigatório"
    );

    await expect(svc.getFollowersMetrics({ userId: "u1", to: "" })).rejects.toThrow(
      "to (YYYY-MM-DD) é obrigatório"
    );
  });

  describe("STRESS", () => {
    // Mantém um timeout um pouco maior só pro stress (mock + loop)
    beforeAll(() => {
      jest.setTimeout(15000);
    });

    it("STRESS: 3000 cenários aleatórios (seed fixo) nunca geram NaN e respeitam gained/lost", async () => {
      const rng = mulberry32(1337);

      for (let i = 0; i < 3000; i++) {
        const dayFollowers = randInt(rng, 0, 200000);
        const prevFollowers = randInt(rng, 0, 200000);

        const prisma = makePrisma();

        prisma.metricsSnapshot.findUnique
          .mockResolvedValueOnce({ followers: dayFollowers })
          .mockResolvedValueOnce({ followers: prevFollowers });

        const svc = new InstagramFollowersMetricsService(prisma);

        const out = await svc.getFollowersMetrics({ userId: "u1", to: "2026-01-10" });

        // invariantes de sanidade
        expect(Number.isFinite(out.total)).toBe(true);
        expect(Number.isFinite(out.gained)).toBe(true);
        expect(Number.isFinite(out.lost)).toBe(true);

        // invariantes de domínio
        expect(out.total).toBe(dayFollowers);
        expect(out.totalPrevDay).toBe(prevFollowers);

        const expectedGained = Math.max(0, dayFollowers - prevFollowers);
        const expectedLost = Math.max(0, prevFollowers - dayFollowers);

        expect(out.gained).toBe(expectedGained);
        expect(out.lost).toBe(expectedLost);

        expect(out.gained).toBeGreaterThanOrEqual(0);
        expect(out.lost).toBeGreaterThanOrEqual(0);

        // sempre faz 2 queries (dia e dia anterior)
        expect(prisma.metricsSnapshot.findUnique).toHaveBeenCalledTimes(2);
      }
    });

    it("STRESS: snapshots ausentes (null) em 2000 cenários mantém output consistente", async () => {
      const rng = mulberry32(2026);

      for (let i = 0; i < 2000; i++) {
        const dayFollowers = randInt(rng, 0, 200000);
        const dayExists = rng() > 0.1; // 10% missing no dia
        const prevExists = rng() > 0.3; // 30% missing no dia anterior

        const prisma = makePrisma();

        prisma.metricsSnapshot.findUnique
          .mockResolvedValueOnce(dayExists ? { followers: dayFollowers } : null)
          .mockResolvedValueOnce(prevExists ? { followers: randInt(rng, 0, 200000) } : null);

        const svc = new InstagramFollowersMetricsService(prisma);

        const out = await svc.getFollowersMetrics({ userId: "u1", to: "2026-01-10" });

        // sanidade
        expect(Number.isFinite(out.total)).toBe(true);
        expect(Number.isFinite(out.gained)).toBe(true);
        expect(Number.isFinite(out.lost)).toBe(true);

        // pelo contrato atual do service: se o snapshot do dia não existir, total vira 0
        // (se no seu código real for diferente, esse teste vai te avisar)
        if (!dayExists) {
          expect(out.total).toBe(0);
        } else {
          expect(out.total).toBe(dayFollowers);
        }

        expect(out.gained).toBeGreaterThanOrEqual(0);
        expect(out.lost).toBeGreaterThanOrEqual(0);

        expect(prisma.metricsSnapshot.findUnique).toHaveBeenCalledTimes(2);
      }
    });
  });
});
