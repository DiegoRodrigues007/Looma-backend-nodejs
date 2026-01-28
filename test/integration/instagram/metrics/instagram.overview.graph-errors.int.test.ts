// test/integration/instagram/metrics/instagram.overview.graph-errors.int.test.ts

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
};

const ax = axios as unknown as AxiosMock;

function axiosErr(status: number, message = "AXIOS_ERROR") {
  const err: any = new Error(message);
  err.response = { status, data: { error: { message } } };
  err.isAxiosError = true;
  return err;
}

describe("INTEGRATION GET /api/metrics/instagram/overview (Graph errors)", () => {
  beforeAll(() => freezeTime("2026-01-10T12:00:00.000Z"));
  afterAll(() => unfreezeTime());

  beforeEach(async () => {
    ax.__reset?.();
    await prisma.metricsSnapshot.deleteMany();
    await prisma.instagramAccount.deleteMany();
    await prisma.user.deleteMany();
  });

  it("503 quando Graph API rate limita (429)", async () => {
    const user = await createTestUser("diego+overview-429@looma.com");
    await createConnectedInstagramAccount({ userId: user.id, igUserId: "IG_429" });

    // precisa de snapshot anterior para não cair em 204
    await seedMetricsSnapshots({
      userId: user.id,
      points: [
        { day: "2026-01-09", followers: 90, reach: 4000, totalInteractions: 150, engagementRate: 3.75 },
      ],
    });

    // 1ª chamada do InstagramMetricsService é o followers_count -> explode com 429
    ax.get.mockRejectedValueOnce(axiosErr(429, "RATE_LIMIT"));

    const res = await request(app)
      .get("/api/metrics/instagram/overview")
      .set("Authorization", makeAuthHeader(user.id));

    expect(res.status).toBe(503);
    expect(res.body).toEqual(
      expect.objectContaining({
        message: expect.stringMatching(/rate limited/i),
      })
    );
  });

  it("400 quando token está inválido/revogado (403)", async () => {
    const user = await createTestUser("diego+overview-403@looma.com");
    await createConnectedInstagramAccount({ userId: user.id, igUserId: "IG_403" });

    await seedMetricsSnapshots({
      userId: user.id,
      points: [
        { day: "2026-01-09", followers: 90, reach: 4000, totalInteractions: 150, engagementRate: 3.75 },
      ],
    });

    ax.get.mockRejectedValueOnce(axiosErr(403, "TOKEN_REVOKED"));

    const res = await request(app)
      .get("/api/metrics/instagram/overview")
      .set("Authorization", makeAuthHeader(user.id));

    expect(res.status).toBe(400);
    expect(res.body).toEqual(
      expect.objectContaining({
        message: expect.stringMatching(/token/i),
      })
    );
  });
});