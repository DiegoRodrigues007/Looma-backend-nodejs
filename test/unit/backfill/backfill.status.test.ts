import request from "supertest";
import { prisma } from "../../mocks/prismaClient";
import { makeAuthHeader } from "../../utils/jwt";
import { assertBasicJsonOk, pickStatus } from "../../utils/response";

// ⚠️ Ajuste o import do app se necessário
import { app } from "../../../src/presentation/http/app";

describe("Backfill - Status (realistic)", () => {
  it("GET /api/instagram/backfill/status deve retornar status do último job", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: "user-1" });

    (prisma.instagramAccount.findFirst as jest.Mock).mockResolvedValue({
      id: "ig_acc_1",
      userId: "user-1",
    });

    (prisma.instagramBackfillJob.findMany as jest.Mock).mockResolvedValue([
      {
        id: "job_1",
        instagramAccountId: "ig_acc_1",
        status: "running",
        createdAt: new Date(),
      },
    ]);

    const res = await request(app)
      .get("/api/instagram/backfill/status")
      .set("Authorization", makeAuthHeader("user-1"));

    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);

    assertBasicJsonOk(res.body);

    const status = pickStatus(res.body);
    expect(typeof status).toBe("string");
    expect([
      "none",
      "queued",
      "running",
      "done",
      "failed",
      "completed",
    ]).toContain(status!);
  });

  it("GET /api/instagram/backfill/status quando não existe job deve retornar 200 com status null/none OU 404", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: "user-1" });

    (prisma.instagramAccount.findFirst as jest.Mock).mockResolvedValue({
      id: "ig_acc_1",
      userId: "user-1",
    });

    (prisma.instagramBackfillJob.findMany as jest.Mock).mockResolvedValue([]);

    const res = await request(app)
      .get("/api/instagram/backfill/status")
      .set("Authorization", makeAuthHeader("user-1"));

    // algumas APIs retornam 404, outras retornam 200 com status "none"
    expect([200, 404]).toContain(res.status);

    if (res.status === 200) {
      const status = pickStatus(res.body);
      // aceita null/undefined/"none"
      expect(status === null || status === "none" || status === "idle").toBe(
        true,
      );
    }
  });
});
