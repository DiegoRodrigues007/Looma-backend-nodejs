import request from "supertest";
import jwt from "jsonwebtoken";
import axios from "axios";
import { app } from "../../../src/presentation/http/app";
import { prisma } from "../../../src/infrastructure/db/prismaClient";
import { makeAuthHeader } from "../helpers/jwt";
import { seedMetricsSnapshots } from "../helpers/metricsTestUtils";

/**
 * =========================================================
 * 🔒 MOCK GLOBAL DO AXIOS (modo especialista)
 * =========================================================
 * - cobre axios.create() (clients)
 * - cobre axios.get() direto (controllers)
 * - preserva interceptors
 * - impede QUALQUER chamada real ao Graph API
 */
jest.spyOn(axios, "create").mockImplementation(() => {
  return {
    get: jest.fn().mockResolvedValue({
      data: { followers_count: 123 },
    }),
    post: jest.fn(),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  } as any;
});

// 🔥 ESTE ERA O PONTO QUE FALTAVA
jest.spyOn(axios, "get").mockResolvedValue({
  data: {
    followers_count: 123,
  },
} as any);

describe("SECURITY /api/metrics/instagram", () => {
  beforeAll(() => {
    // 🔐 força verificação REAL do JWT mesmo em test
    process.env.AUTH_VERIFY_IN_TEST = "true";
  });

  beforeEach(async () => {
    await prisma.metricsSnapshot.deleteMany();
    await prisma.instagramAccount.deleteMany();
    await prisma.user.deleteMany();
  });

  const endpoints = [
    "/api/metrics/instagram/overview",
    "/api/metrics/instagram/period?from=2026-01-01&to=2026-01-10",
  ];

  function invalidToken() {
    return jwt.sign({ sub: "x" }, "BAD_SECRET");
  }

  it.each(endpoints)("401 sem token → %s", async (url) => {
    const res = await request(app).get(url);
    expect(res.status).toBe(401);
  });

  it.each(endpoints)("401/403 com token inválido → %s", async (url) => {
    const res = await request(app)
      .get(url)
      .set("Authorization", `Bearer ${invalidToken()}`);

    expect([401, 403]).toContain(res.status);
  });

  it.each(endpoints)("200 com token válido → %s", async (url) => {
    // 👤 usuário válido (contrato COMPLETO do Prisma)
    const user = await prisma.user.create({
      data: {
        email: "secure+metrics@looma.com",
        name: "Security Metrics User",
        passwordHash: "TEST_PASSWORD_HASH",
      },
    });

    // 📸 conta Instagram conectada
    const ig = await prisma.instagramAccount.create({
      data: {
        userId: user.id,
        igUserId: "IG_SEC_METRICS",
        accessToken: "FAKE",
      },
    });

    // ⭐ define conta ativa
    await prisma.user.update({
      where: { id: user.id },
      data: { activeInstagramAccountId: ig.id },
    });

    // 📊 snapshots coerentes
    await seedMetricsSnapshots({
      userId: user.id,
      platform: "instagram",
      points: [
        { day: "2026-01-06", followers: 100, reach: 1000, totalInteractions: 80 },
        { day: "2026-01-07", followers: 105, reach: 1100, totalInteractions: 90 },
        { day: "2026-01-08", followers: 110, reach: 1200, totalInteractions: 95 },
        { day: "2026-01-09", followers: 120, reach: 1400, totalInteractions: 110 },
        { day: "2026-01-10", followers: 130, reach: 1600, totalInteractions: 130 },
      ],
    });

    const res = await request(app)
      .get(url)
      .set("Authorization", makeAuthHeader(user.id));

    expect(res.status).toBe(200);
  });
});