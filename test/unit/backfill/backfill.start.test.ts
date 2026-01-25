import request from "supertest";
import { prisma } from "../mocks/prismaClient";
import { makeAuthHeader } from "../utils/jwt";
import { assertBasicJsonOk, assertHasRequestIdMaybe, pickJob } from "../utils/response";

// ⚠️ Ajuste o import do app se necessário
import { app } from "../../src/presentation/http/app";

describe("Backfill - Start (realistic)", () => {
  it("POST /api/instagram/backfill/start deve criar job queued e retornar id", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: "user-1" });

    (prisma.instagramAccount.findFirst as jest.Mock).mockResolvedValue({
      id: "ig_acc_1",
      userId: "user-1",
    });

    // não existe job ativo
    (prisma.instagramBackfillJob.findFirst as jest.Mock).mockResolvedValue(null);

    (prisma.instagramBackfillJob.create as jest.Mock).mockResolvedValue({
      id: "job_1",
      instagramAccountId: "ig_acc_1",
      status: "queued",
      createdAt: new Date(),
    });

    const res = await request(app)
      .post("/api/instagram/backfill/start")
      .set("Authorization", makeAuthHeader("user-1"))
      .send({});

    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);

    assertBasicJsonOk(res.body);
    assertHasRequestIdMaybe(res.body);

    expect(prisma.instagramBackfillJob.create).toHaveBeenCalled();

    const job = pickJob(res.body);
    const jobId = res.body.jobId ?? job?.id ?? res.body.id;
    expect(typeof jobId).toBe("string");
    expect(jobId.length).toBeGreaterThan(2);

    // forte: garante que tentou impedir duplicidade
    expect(prisma.instagramBackfillJob.findFirst).toHaveBeenCalled();
  });
});