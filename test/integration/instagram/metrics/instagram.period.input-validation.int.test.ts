// test/integration/instagram/metrics/instagram.period.input-validation.int.test.ts

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
  __instance?: {
    get: jest.Mock;
    post: jest.Mock;
  };
  get?: jest.Mock;
  post?: jest.Mock;
};

const ax = axios as unknown as AxiosMock;

describe("INTEGRATION GET /api/metrics/instagram/period - input validation", () => {
  beforeAll(() => freezeTime("2026-01-10T12:00:00.000Z"));
  afterAll(() => unfreezeTime());

  beforeEach(async () => {
    ax.__reset?.();

    // 🧹 limpeza defensiva (ordem por FK)
    await prisma.metricsSnapshot.deleteMany();
    await prisma.instagramAccount.deleteMany();
    await prisma.user.deleteMany();
  });

  it("400 quando days = 0 (inválido)", async () => {
    const user = await createTestUser("diego+period-days0@looma.com");
    await createConnectedInstagramAccount({ userId: user.id, igUserId: "IG_DAYS_0" });

    const res = await request(app)
      .get("/api/metrics/instagram/period?days=0")
      .set("Authorization", makeAuthHeader(user.id))
      .set("x-test-user-id", user.id);

    expect(res.status).toBe(400);

    // ✅ não deve nem tentar bater no Graph API se days for inválido
    expect(ax.__instance?.get).not.toHaveBeenCalled();
    expect(ax.get).not.toHaveBeenCalled();
  });

  it("400 quando days é negativo (inválido)", async () => {
    const user = await createTestUser("diego+period-daysneg@looma.com");
    await createConnectedInstagramAccount({ userId: user.id, igUserId: "IG_DAYS_NEG" });

    const res = await request(app)
      .get("/api/metrics/instagram/period?days=-1")
      .set("Authorization", makeAuthHeader(user.id))
      .set("x-test-user-id", user.id);

    expect(res.status).toBe(400);

    expect(ax.__instance?.get).not.toHaveBeenCalled();
    expect(ax.get).not.toHaveBeenCalled();
  });

  it("400 quando days é string inválida (ex: tru)", async () => {
    const user = await createTestUser("diego+period-daystru@looma.com");
    await createConnectedInstagramAccount({ userId: user.id, igUserId: "IG_DAYS_TRU" });

    const res = await request(app)
      .get("/api/metrics/instagram/period?days=tru")
      .set("Authorization", makeAuthHeader(user.id))
      .set("x-test-user-id", user.id);

    expect(res.status).toBe(400);

    expect(ax.__instance?.get).not.toHaveBeenCalled();
    expect(ax.get).not.toHaveBeenCalled();
  });

  it("400 quando days é decimal (ex: 1.5)", async () => {
    const user = await createTestUser("diego+period-daysdecimal@looma.com");
    await createConnectedInstagramAccount({ userId: user.id, igUserId: "IG_DAYS_DECIMAL" });

    const res = await request(app)
      .get("/api/metrics/instagram/period?days=1.5")
      .set("Authorization", makeAuthHeader(user.id))
      .set("x-test-user-id", user.id);

    expect(res.status).toBe(400);

    expect(ax.__instance?.get).not.toHaveBeenCalled();
    expect(ax.get).not.toHaveBeenCalled();
  });
});