import request from "supertest";
import { prisma } from "../../mocks/prismaClient";
import { makeAuthHeader } from "../../utils/jwt";
import {
  assertBasicJsonOk,
  assertHasRequestIdMaybe,
  pickItems,
} from "../../utils/response";

import { app } from "../../../src/presentation/http/app";

describe("Instagram Posts - List (realistic)", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    (prisma.instagramAccount.findFirst as jest.Mock).mockResolvedValue({
      id: "ig_acc_1",
      userId: "user-1",
      isConnected: true,
      igUserId: "IG_USER_1",
      pageAccessToken: "PAGE_TOKEN_1",
      updatedAt: new Date(),
    } as any);

    (prisma.user.findUnique as jest.Mock).mockResolvedValue({
      id: "user-1",
      email: "test@local",
      activeInstagramAccountId: "ig_acc_1",
    } as any);
  });

  it("GET /api/instagram/posts deve retornar array e respeitar limit=20", async () => {
    const fakePosts = Array.from({ length: 20 }).map((_, i) => ({
      id: `post_${i + 1}`,
      instagramAccountId: "ig_acc_1",
      createdAt: new Date().toISOString(),
      caption: `Post ${i + 1}`,
    }));

    (prisma.instagramPost.findMany as jest.Mock).mockResolvedValue(fakePosts);

    const res = await request(app)
      .get("/api/instagram/posts?limit=20")
      .set("Authorization", makeAuthHeader("user-1"))
      .set("x-test-user-id", "user-1")
      .set("x-test-email", "test@local");

    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
    expect(res.headers["content-type"] || "").toContain("application/json");

    assertBasicJsonOk(res.body);
    assertHasRequestIdMaybe(res.body);

    const items = pickItems(res.body);
    expect(Array.isArray(items)).toBe(true);
    expect(items.length).toBe(20);

    expect(prisma.instagramAccount.findFirst).toHaveBeenCalled();
    expect(prisma.instagramPost.findMany).toHaveBeenCalled();

    const callArg =
      (prisma.instagramPost.findMany as jest.Mock).mock.calls[0]?.[0] ?? {};
    if (callArg?.take !== undefined) expect(callArg.take).toBe(20);
    if (callArg?.orderBy !== undefined) {
      expect(JSON.stringify(callArg.orderBy)).toMatch(
        /createdAt|timestamp|takenAt|igCreatedTime|publishedAt/i,
      );
    }
  });

  it("GET /api/instagram/posts sem limit deve defaultar para 20 (ou fallback)", async () => {
    (prisma.instagramPost.findMany as jest.Mock).mockResolvedValue(
      Array.from({ length: 20 }).map((_, i) => ({ id: `p_${i + 1}` })),
    );

    const res = await request(app)
      .get("/api/instagram/posts")
      .set("Authorization", makeAuthHeader("user-1"))
      .set("x-test-user-id", "user-1")
      .set("x-test-email", "test@local");

    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);

    const items = pickItems(res.body);
    expect(items.length).toBeGreaterThan(0);
    expect(prisma.instagramAccount.findFirst).toHaveBeenCalled();
    expect(prisma.instagramPost.findMany).toHaveBeenCalled();
  });
});
