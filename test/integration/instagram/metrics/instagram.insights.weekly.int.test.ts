// ✅ IMPORTANTE: mock do axios precisa vir ANTES de qualquer import que use axios
jest.mock("axios", () => require("../../../setup/axios.mock").default);

import request from "supertest";
import axios from "axios";
import { app } from "../../../../src/presentation/http/app";
import { prisma } from "../../../../src/infrastructure/db/prismaClient";
import { makeAuthHeader } from "../../helpers/jwt";
import { createTestUser, createConnectedInstagramAccount } from "../../helpers/igTestFactory";
import { freezeTime, unfreezeTime, seedMetricsSnapshots } from "../../helpers/metricsTestUtils";

type AxiosMock = {
  __reset?: () => void;
  get: jest.Mock;
  post: jest.Mock;
};

const ax = axios as unknown as AxiosMock;

describe("INTEGRATION GET /api/metrics/instagram/insights/weekly", () => {
  beforeAll(() => freezeTime("2026-01-10T12:00:00.000Z"));
  afterAll(() => unfreezeTime());

  beforeEach(async () => {
    // ✅ reseta o mock global do axios (create + instance + interceptors)
    ax.__reset?.();

    await prisma.metricsSnapshot.deleteMany();
    await prisma.instagramAccount.deleteMany();
    await prisma.user.deleteMany();
  });

  it("401 se não autenticado", async () => {
    const res = await request(app).get("/api/metrics/instagram/insights/weekly?days=7");
    expect(res.status).toBe(401);
  });

  it("200 com period + insights (sem depender do Graph). days clamp min/max", async () => {
    const user = await createTestUser("diego+weekly-200@looma.com");
    await createConnectedInstagramAccount({ userId: user.id, igUserId: "IG_1" });

    // ✅ “Graph off”: qualquer chamada HTTP externa deve falhar.
    // O endpoint tem try/catch para TopContent, então deve continuar retornando 200.
    ax.get.mockRejectedValue(new Error("Graph disabled in integration test"));

    // Precisamos de 2*days - 1 dias de snapshots (service busca de from=(days*2-1) até to)
    // days=7 => 13 dias: 2025-12-29 ... 2026-01-10
    const points = [
      // período anterior (7 dias): mais forte
      { day: "2025-12-29", reach: 6000, totalInteractions: 300, engagementRate: 5.0 },
      { day: "2025-12-30", reach: 6200, totalInteractions: 320, engagementRate: 5.1 },
      { day: "2025-12-31", reach: 6100, totalInteractions: 310, engagementRate: 5.0 },
      { day: "2026-01-01", reach: 6300, totalInteractions: 330, engagementRate: 5.2 },
      { day: "2026-01-02", reach: 6400, totalInteractions: 340, engagementRate: 5.3 },
      { day: "2026-01-03", reach: 6500, totalInteractions: 350, engagementRate: 5.4 },

      // período atual (7 dias): “pior” pra poder gerar warning
      { day: "2026-01-04", reach: 3000, totalInteractions: 120, engagementRate: 2.5 },
      { day: "2026-01-05", reach: 3100, totalInteractions: 130, engagementRate: 2.6 },
      { day: "2026-01-06", reach: 2900, totalInteractions: 110, engagementRate: 2.4 },
      { day: "2026-01-07", reach: 2800, totalInteractions: 105, engagementRate: 2.3 },
      { day: "2026-01-08", reach: 2700, totalInteractions: 100, engagementRate: 2.2 },
      { day: "2026-01-09", reach: 2600, totalInteractions: 95, engagementRate: 2.1 },
      { day: "2026-01-10", reach: 2500, totalInteractions: 90, engagementRate: 2.0 },
    ];

    await seedMetricsSnapshots({ userId: user.id, points });

    const res = await request(app)
      // passa days fora do range pra validar clamp (min 3, max 30)
      .get("/api/metrics/instagram/insights/weekly?days=999")
      .set("Authorization", makeAuthHeader(user.id));

    expect(res.status).toBe(200);

    expect(res.body).toEqual(
      expect.objectContaining({
        period: expect.objectContaining({
          days: expect.any(Number),
          from: expect.any(String),
          to: expect.any(String),
          compareFrom: expect.any(String),
          compareTo: expect.any(String),
        }),
        insights: expect.any(Array),
      })
    );

    // cada insight deve ter shape estável
    for (const i of res.body.insights) {
      expect(i).toEqual(
        expect.objectContaining({
          level: expect.any(String),
          icon: expect.any(String),
          title: expect.any(String),
          detail: expect.any(String),
        })
      );
    }
  });
});