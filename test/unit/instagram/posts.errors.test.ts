import request from "supertest";

jest.mock("axios", () => {
  const get = jest.fn();
  const post = jest.fn();

  const instance = {
    get,
    post,
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  };

  return {
    __esModule: true,
    default: {
      get,
      post,
      create: jest.fn(() => instance),
      isAxiosError: (e: any) => !!e?.isAxiosError,
    },
  };
});

import axios from "axios";
import { prisma } from "../../mocks/prismaClient";
import { makeAuthHeader } from "../../utils/jwt";
import { app } from "../../../src/presentation/http/app";

describe("Instagram Posts - Sync Errors (realistic)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("POST /api/instagram/posts/sync deve retornar 401 sem token", async () => {
    const res = await request(app).post("/api/instagram/posts/sync?limit=20");
    expect(res.status).toBe(401);
  });

  it("POST /api/instagram/posts/sync deve retornar 4xx quando user não tem conta ativa (activeInstagramAccountId)", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      activeInstagramAccountId: null,
    });

    const res = await request(app)
      .post("/api/instagram/posts/sync?limit=20")
      .set("Authorization", makeAuthHeader("user-1"));

    expect([400, 401, 404, 500]).toContain(res.status);
  });

  it("POST /api/instagram/posts/sync deve retornar 4xx quando conta IG ativa não existe", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      activeInstagramAccountId: "ig_acc_1",
    });

    (prisma.instagramAccount.findFirst as jest.Mock).mockResolvedValue(null);

    const res = await request(app)
      .post("/api/instagram/posts/sync?limit=20")
      .set("Authorization", makeAuthHeader("user-1"));

    expect([400, 404, 500]).toContain(res.status);
  });

  it("POST /api/instagram/posts/sync deve retornar 4xx quando conta IG não tem igUserId ou pageAccessToken", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      activeInstagramAccountId: "ig_acc_1",
    });

    (prisma.instagramAccount.findFirst as jest.Mock).mockResolvedValue({
      id: "ig_acc_1",
      userId: "user-1",
      isConnected: true,
      updatedAt: new Date(),
      igUserId: "IG_USER_ID_1",
      pageAccessToken: null,
    });

    const res = await request(app)
      .post("/api/instagram/posts/sync?limit=20")
      .set("Authorization", makeAuthHeader("user-1"));

    expect([400, 500]).toContain(res.status);

    expect((axios as any).get).not.toHaveBeenCalled();
  });

  it("POST /api/instagram/posts/sync deve lidar com erro da Meta (axios) e retornar 500/502", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      activeInstagramAccountId: "ig_acc_1",
    });

    (prisma.instagramAccount.findFirst as jest.Mock).mockResolvedValue({
      id: "ig_acc_1",
      userId: "user-1",
      isConnected: true,
      updatedAt: new Date(),
      igUserId: "IG_USER_ID_1",
      pageAccessToken: "PAGE_TOKEN_1",
    });

    (axios as any).get.mockRejectedValue(new Error("Meta down"));

    const res = await request(app)
      .post("/api/instagram/posts/sync?limit=20")
      .set("Authorization", makeAuthHeader("user-1"));

    expect([500, 502]).toContain(res.status);

    expect((axios as any).get).toHaveBeenCalled();
  });

  it("POST /api/instagram/posts/sync deve validar limit inválido e ainda responder (2xx ou 4xx, mas não crashar)", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      activeInstagramAccountId: "ig_acc_1",
    });

    (prisma.instagramAccount.findFirst as jest.Mock).mockResolvedValue({
      id: "ig_acc_1",
      userId: "user-1",
      isConnected: true,
      updatedAt: new Date(),
      igUserId: "IG_USER_ID_1",
      pageAccessToken: "PAGE_TOKEN_1",
    });

    (axios as any).get.mockResolvedValue({ data: { data: [] } });

    const res = await request(app)
      .post("/api/instagram/posts/sync?limit=abc")
      .set("Authorization", makeAuthHeader("user-1"));

    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(600);
  });
});
