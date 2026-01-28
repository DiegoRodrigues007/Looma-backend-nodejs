// ✅ IMPORTANTÍSSIMO: mock do axios precisa vir ANTES de qualquer import que use axios
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
  __instance?: {
    get: jest.Mock;
    post: jest.Mock;
  };
};

const ax = axios as unknown as AxiosMock;

describe("INTEGRATION GET /api/metrics/instagram/period", () => {
  // ✅ DB real + integrações: evita falso timeout
  jest.setTimeout(20000);

  beforeAll(() => freezeTime("2026-01-10T12:00:00.000Z"));
  afterAll(() => unfreezeTime());

  beforeEach(async () => {
    // ✅ reseta o mock global do axios (create + instance + interceptors)
    ax.__reset?.();

    // ✅ “fail fast”: qualquer chamada axios não mockada deve falhar na hora (sem travar rede)
    ax.get.mockRejectedValue(new Error("Unexpected axios.get in test (not mocked)"));
    ax.post.mockRejectedValue(new Error("Unexpected axios.post in test (not mocked)"));
    ax.__instance?.get?.mockRejectedValue(new Error("Unexpected axios.__instance.get in test (not mocked)"));
    ax.__instance?.post?.mockRejectedValue(new Error("Unexpected axios.__instance.post in test (not mocked)"));

    await prisma.metricsSnapshot.deleteMany();
    await prisma.instagramAccount.deleteMany();
    await prisma.user.deleteMany();
  });

  it("401 se não autenticado", async () => {
    const res = await request(app).get("/api/metrics/instagram/period?days=7");
    expect(res.status).toBe(401);
  });

  it("204 se não tem snapshot em (today - days) ou anterior a ele", async () => {
    const user = await createTestUser("diego+period-204@looma.com");
    await createConnectedInstagramAccount({ userId: user.id, igUserId: "IG_1" });

    const mockGraphGet = async (url: string, config?: any) => {
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
    };

    // ✅ mocka os DOIS jeitos (axios.get e axios.create().get), pra não depender de como o service foi implementado
    ax.get.mockImplementation(mockGraphGet);
    ax.__instance?.get?.mockImplementation(mockGraphGet);

    const res = await request(app)
      .get("/api/metrics/instagram/period?days=7")
      .set("Authorization", makeAuthHeader(user.id));

    expect(res.status).toBe(204);
  });

  it("200 com comparação live vs snapshot <= (today - days) quando days NÃO é enviado (default=7)", async () => {
    const user = await createTestUser("diego+period-200-default@looma.com");
    await createConnectedInstagramAccount({ userId: user.id, igUserId: "IG_1" });

    // today = 2026-01-10, default days=7 -> target = 2026-01-03
    await seedMetricsSnapshots({
      userId: user.id,
      points: [{ day: "2026-01-03", followers: 70, reach: 3000, totalInteractions: 100, engagementRate: 3.33 }],
    });

    const mockGraphGet = async (url: string, config?: any) => {
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
    };

    ax.get.mockImplementation(mockGraphGet);
    ax.__instance?.get?.mockImplementation(mockGraphGet);

    const res = await request(app)
      .get("/api/metrics/instagram/period") // ✅ sem days => default=7
      .set("Authorization", makeAuthHeader(user.id));

    expect(res.status).toBe(200);
    expect(res.body).toEqual(
      expect.objectContaining({
        hasComparison: true,
        followers: expect.any(Object),
        reach: expect.any(Object),
        interactions: expect.any(Object),
        engagement: expect.any(Object),
      })
    );
  });

  it("400 quando days é inválido (ex: NaN) e NÃO chama Graph API", async () => {
    const user = await createTestUser("diego+period-400-nan@looma.com");
    await createConnectedInstagramAccount({ userId: user.id, igUserId: "IG_1" });

    // mesmo que existam snapshots, days inválido deve falhar antes
    await seedMetricsSnapshots({
      userId: user.id,
      points: [{ day: "2026-01-03", followers: 70, reach: 3000, totalInteractions: 100, engagementRate: 3.33 }],
    });

    const res = await request(app)
      .get("/api/metrics/instagram/period?days=NaN")
      .set("Authorization", makeAuthHeader(user.id));

    expect(res.status).toBe(400);

    // ✅ days inválido deve “falhar cedo” e nem tentar Graph API
    expect(ax.get).not.toHaveBeenCalled();
    expect(ax.__instance?.get).not.toHaveBeenCalled();
  });
});