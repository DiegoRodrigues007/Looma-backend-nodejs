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

describe("INTEGRATION GET /api/metrics/instagram/overview", () => {
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
    const res = await request(app).get("/api/metrics/instagram/overview");
    expect(res.status).toBe(401);
  });

  it("204 se não tem snapshot anterior (histórico insuficiente)", async () => {
    const user = await createTestUser("diego+overview-204@looma.com");
    await createConnectedInstagramAccount({ userId: user.id, igUserId: "IG_1" });

    // ✅ mock do Graph via axios.get (service usa axios.get direto)
    ax.get.mockImplementation(async (url: string, config?: any) => {
      const metric = config?.params?.metric;

      // followers_count vem do GET /{igUserId}?fields=followers_count
      if (!String(url).includes("/insights")) {
        return { data: { followers_count: 100 } };
      }

      if (metric === "reach") {
        return { data: { data: [{ name: "reach", values: [{ value: 5000 }] }] } };
      }

      if (metric === "total_interactions") {
        return { data: { data: [{ name: "total_interactions", total_value: { value: 200 } }] } };
      }

      return { data: { data: [] } };
    });

    const res = await request(app)
      .get("/api/metrics/instagram/overview")
      .set("Authorization", makeAuthHeader(user.id));

    expect(res.status).toBe(204);
  });

  it("200 com comparação (live vs snapshot <= yesterday) e shape robusto", async () => {
    const user = await createTestUser("diego+overview-200@looma.com");
    await createConnectedInstagramAccount({ userId: user.id, igUserId: "IG_1" });

    // ontem (2026-01-09) existe snapshot
    await seedMetricsSnapshots({
      userId: user.id,
      points: [{ day: "2026-01-09", followers: 90, reach: 4000, totalInteractions: 150, engagementRate: 3.75 }],
    });

    // ✅ mock do Graph via axios.get
    ax.get.mockImplementation(async (url: string, config?: any) => {
      const metric = config?.params?.metric;

      if (!String(url).includes("/insights")) {
        return { data: { followers_count: 100 } };
      }

      if (metric === "reach") {
        return { data: { data: [{ name: "reach", values: [{ value: 5000 }] }] } };
      }

      if (metric === "total_interactions") {
        return { data: { data: [{ name: "total_interactions", total_value: { value: 200 } }] } };
      }

      return { data: { data: [] } };
    });

    const res = await request(app)
      .get("/api/metrics/instagram/overview")
      .set("Authorization", makeAuthHeader(user.id));

    expect(res.status).toBe(200);

    // robusto: valida presença das chaves principais e comparação
    expect(res.body).toEqual(
      expect.objectContaining({
        hasComparison: true,
        followers: expect.objectContaining({
          label: expect.any(String),
          current: expect.any(Number),
          previous: expect.any(Number),
          delta: expect.any(Number),
          trend: expect.any(String),
          deltaLabel: expect.any(String),
        }),
        reach: expect.any(Object),
        interactions: expect.any(Object),
        engagement: expect.any(Object),
      })
    );
  });
});