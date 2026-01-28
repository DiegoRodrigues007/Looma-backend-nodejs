import request from "supertest";
import { app } from "../../../../src/presentation/http/app";
import { prisma } from "../../../../src/infrastructure/db/prismaClient";
import { makeAuthHeader } from "../../helpers/jwt";
import {
  createTestUser,
  createConnectedInstagramAccount,
  seedDailyMetrics,
} from "../../helpers/igTestFactory";

describe("INTEGRATION Topbar Golden Flow (connected)", () => {
  beforeEach(async () => {
    // limpeza bem forte (ordem por FK)
    await prisma.instagramAccountDailyMetrics.deleteMany();
    await prisma.instagramCandidate.deleteMany();
    await prisma.instagramAccount.deleteMany();
    await prisma.user.deleteMany();
  });

  it("status -> accounts -> active -> metrics devem ser consistentes", async () => {
    const user = await createTestUser("diego+topbar@looma.com");
    const acc = await createConnectedInstagramAccount({
      userId: user.id,
      igUserId: "IG_TOPBAR_1",
    });

    // garante active setado
    await prisma.user.update({
      where: { id: user.id },
      data: { activeInstagramAccountId: acc.id },
    });

    // seed de métricas pra não depender de backfill
    await seedDailyMetrics({
      userId: user.id,
      instagramAccountId: acc.id,
      points: [
        { day: "2026-01-01", reach: 10, profileViewsTotal: 2, totalInteractions: 1 },
        { day: "2026-01-02", reach: 20, profileViewsTotal: 3, totalInteractions: 2 },
        { day: "2026-01-03", reach: 30, profileViewsTotal: 4, totalInteractions: 3 },
      ],
    });

    // 1) status
    const status = await request(app)
      .get("/api/instagram/status")
      .set("Authorization", makeAuthHeader(user.id));

    expect(status.status).toBe(200);
    expect(status.body).toEqual(
      expect.objectContaining({
        ok: true,
        connected: true,
        totalAccounts: 1,
        activeInstagramAccountId: acc.id,
      })
    );

    // 2) accounts
    const accounts = await request(app)
      .get("/api/instagram/accounts")
      .set("Authorization", makeAuthHeader(user.id));

    expect(accounts.status).toBe(200);
    expect(accounts.body.ok).toBe(true);
    expect(accounts.body.total).toBe(1);
    expect(accounts.body.activeInstagramAccountId).toBe(acc.id);
    expect(accounts.body.accounts[0]).toEqual(
      expect.objectContaining({
        id: acc.id,
        igUserId: "IG_TOPBAR_1",
        isActive: true,
      })
    );

    // segurança: não vazar token
    expect(accounts.body.accounts[0]).not.toHaveProperty("pageAccessToken");
    expect(accounts.body.accounts[0]).not.toHaveProperty("accessToken");

    // 3) active
    const active = await request(app)
      .get("/api/instagram/active")
      .set("Authorization", makeAuthHeader(user.id));

    expect(active.status).toBe(200);
    expect(active.body).toEqual(
      expect.objectContaining({
        ok: true,
        activeInstagramAccountId: acc.id,
        account: expect.objectContaining({ id: acc.id }),
      })
    );

    // 4) metrics (travando contrato REAL)
    const metrics = await request(app)
      .get("/api/instagram/metrics?from=2026-01-01&to=2026-01-03&refillZeros=false&autoBackfill=false")
      .set("Authorization", makeAuthHeader(user.id));

    expect(metrics.status).toBe(200);

    // ✅ contrato mínimo alinhado ao payload real
    expect(metrics.body).toEqual(
      expect.objectContaining({
        ok: true,
        filters: expect.objectContaining({
          from: "2026-01-01",
          to: "2026-01-03",
        }),
        timeseries: expect.any(Array),
        kpis: expect.any(Object),
      })
    );

    // ✅ robustez: deve usar a conta ativa
    expect(metrics.body).toEqual(
      expect.objectContaining({
        instagramAccountIdUsed: acc.id,
        activeInstagramAccountId: acc.id,
      })
    );

    // timeseries robusto: exatamente N dias e valores finitos
    expect(metrics.body.timeseries).toHaveLength(3);

    for (const p of metrics.body.timeseries) {
      // payload real usa "date"
      expect(p).toEqual(expect.objectContaining({ date: expect.any(String) }));

      // campos esperados no timeseries real
      const numericKeys = ["reach", "profileViews", "totalInteractions", "engagementRate", "followers"];

      for (const k of numericKeys) {
        if (k in p) {
          expect(Number.isFinite(Number(p[k]))).toBe(true);
        }
      }
    }
  });
});