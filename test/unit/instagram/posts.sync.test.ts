import request from "supertest";

jest.mock("axios", () => {
  const get = jest.fn();
  const post = jest.fn();

  const interceptors = {
    request: { use: jest.fn(), eject: jest.fn() },
    response: { use: jest.fn(), eject: jest.fn() },
  };

  const instance = { get, post, interceptors };

  const create = jest.fn(() => instance);

  const axiosFn: any = (..._args: any[]) =>
    Promise.resolve({ data: undefined });
  axiosFn.get = get;
  axiosFn.post = post;
  axiosFn.create = create;
  axiosFn.interceptors = interceptors;
  axiosFn.isAxiosError = (e: any) => !!e?.isAxiosError;

  return {
    __esModule: true,
    default: axiosFn,
  };
});

import axios from "axios";
import { prisma } from "../../mocks/prismaClient";
import { makeAuthHeader } from "../../utils/jwt";
import {
  assertBasicJsonOk,
  assertHasRequestIdMaybe,
} from "../../utils/response";
import { app } from "../../../src/presentation/http/app";

describe("Instagram Posts - Sync (realistic)", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (prisma.instagramPost.deleteMany as jest.Mock).mockResolvedValue({
      count: 0,
    });
  });

  it("POST /api/instagram/posts/sync deve buscar da Meta (axios) e salvar (prisma)", async () => {
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

    (axios as any).get.mockResolvedValue({
      data: {
        data: [
          {
            id: "ig_post_1",
            caption: "teste 1",
            media_type: "IMAGE",
            timestamp: "2026-01-24T00:00:00+0000",
          },
          {
            id: "ig_post_2",
            caption: "teste 2",
            media_type: "VIDEO",
            timestamp: "2026-01-23T00:00:00+0000",
          },
        ],
        paging: { next: null },
      },
    });

    (prisma.instagramPost.upsert as jest.Mock).mockResolvedValue({});

    const res = await request(app)
      .post("/api/instagram/posts/sync?limit=20")
      .set("Authorization", makeAuthHeader("user-1"))
      .send({});

    if (res.status >= 500) {
      console.log("SYNC 500 BODY:", res.body);
    }

    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);

    assertBasicJsonOk(res.body);
    assertHasRequestIdMaybe(res.body);

    expect((axios as any).get).toHaveBeenCalled();

    const [url, cfg] = (axios as any).get.mock.calls[0] ?? [];
    expect(String(url)).toMatch(/graph\.facebook|\/media/i);
    expect(cfg).toBeTruthy();
    expect(cfg?.params).toBeTruthy();
    expect(String(cfg.params.access_token)).toMatch(/PAGE_TOKEN_1/i);
    expect(Number(cfg.params.limit)).toBe(20);

    expect(prisma.instagramPost.upsert).toHaveBeenCalled();
    expect((prisma.instagramPost.upsert as jest.Mock).mock.calls.length).toBe(
      2,
    );

    expect(prisma.instagramPost.deleteMany).toHaveBeenCalled();
  });

  it("POST /api/instagram/posts/sync deve respeitar limit=5", async () => {
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

    (axios as any).get.mockResolvedValue({
      data: {
        data: Array.from({ length: 5 }).map((_, i) => ({
          id: `ig_${i + 1}`,
          timestamp: "2026-01-24T00:00:00+0000",
        })),
      },
    });

    (prisma.instagramPost.upsert as jest.Mock).mockResolvedValue({});

    const res = await request(app)
      .post("/api/instagram/posts/sync?limit=5")
      .set("Authorization", makeAuthHeader("user-1"))
      .send({});

    if (res.status >= 500) {
      console.log("SYNC 500 BODY:", res.body);
    }

    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);

    const [_url, cfg] = (axios as any).get.mock.calls[0] ?? [];
    expect(Number(cfg?.params?.limit)).toBe(5);

    expect((prisma.instagramPost.upsert as jest.Mock).mock.calls.length).toBe(
      5,
    );
  });
});
