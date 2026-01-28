// ✅ IMPORTANTE: mock do axios precisa vir ANTES de qualquer import que use axios
jest.mock("axios", () => require("../../../setup/axios.mock").default);

import request from "supertest";
import axios from "axios";
import { app } from "../../../../src/presentation/http/app";
import { prisma } from "../../../../src/infrastructure/db/prismaClient";
import { makeAuthHeader } from "../../helpers/jwt";
import { createTestUser, createConnectedInstagramAccount } from "../../helpers/igTestFactory";
import { freezeTime, unfreezeTime } from "../../helpers/metricsTestUtils";

type AxiosMock = {
  __reset?: () => void;
  get: jest.Mock;
  post: jest.Mock;
};

const ax = axios as unknown as AxiosMock;

function ymdNow() {
  return new Date().toISOString().slice(0, 10);
}

describe("INTEGRATION POST /api/metrics/instagram/snapshot/ensure", () => {
  beforeAll(() => {
    freezeTime("2026-01-10T12:00:00.000Z");
  });

  afterAll(() => {
    unfreezeTime();
  });

  beforeEach(async () => {
    // ✅ reseta o mock global do axios (create + instance + interceptors)
    ax.__reset?.();

    await prisma.metricsSnapshot.deleteMany();
    await prisma.instagramAccount.deleteMany();
    await prisma.user.deleteMany();
  });

  it("401 se não autenticado", async () => {
    const res = await request(app).post("/api/metrics/instagram/snapshot/ensure");
    expect(res.status).toBe(401);
  });

  it("400 se IG não conectado", async () => {
    const user = await createTestUser("diego+snap-no-ig@looma.com");

    const res = await request(app)
      .post("/api/metrics/instagram/snapshot/ensure")
      .set("Authorization", makeAuthHeader(user.id));

    expect(res.status).toBe(400);
    expect(res.body).toEqual(
      expect.objectContaining({
        message: expect.stringMatching(/not connected/i),
      })
    );
  });

  it("cria snapshot do dia (saved=true) e na segunda chamada não duplica (saved=false)", async () => {
    const user = await createTestUser("diego+snap-ok@looma.com");
    await createConnectedInstagramAccount({ userId: user.id, igUserId: "IG_1" });

    const todayYmd = ymdNow();

    // ✅ mock do Graph via axios.get (service usa axios.get direto)
    ax.get.mockImplementation(async (url: string, config?: any) => {
      const metric = config?.params?.metric;

      // followers_count vem do GET /{igUserId}?fields=followers_count
      if (!String(url).includes("/insights")) {
        return { data: { followers_count: 120 } };
      }

      if (metric === "reach") {
        return { data: { data: [{ name: "reach", values: [{ value: 8000 }] }] } };
      }

      if (metric === "total_interactions") {
        return { data: { data: [{ name: "total_interactions", total_value: { value: 250 } }] } };
      }

      return { data: { data: [] } };
    });

    const r1 = await request(app)
      .post("/api/metrics/instagram/snapshot/ensure")
      .set("Authorization", makeAuthHeader(user.id));

    expect(r1.status).toBe(200);
    expect(r1.body).toEqual(
      expect.objectContaining({
        saved: true,
        date: todayYmd,
      })
    );

    const r2 = await request(app)
      .post("/api/metrics/instagram/snapshot/ensure")
      .set("Authorization", makeAuthHeader(user.id));

    expect(r2.status).toBe(200);
    expect(r2.body).toEqual(
      expect.objectContaining({
        saved: false,
        date: todayYmd,
        reason: expect.any(String),
      })
    );

    const count = await prisma.metricsSnapshot.count({
      where: { userId: user.id, platform: "instagram" as any },
    });
    expect(count).toBe(1);
  });
});