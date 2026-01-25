import request from "supertest";
import { prisma } from "../mocks/prismaClient";
import { makeAuthHeader } from "../utils/jwt";

// ⚠️ Ajuste o import do app se necessário
import { app } from "../../src/presentation/http/app";

describe("Backfill - Errors (realistic)", () => {
  it("POST /api/instagram/backfill/start sem auth deve retornar 401/403", async () => {
    const res = await request(app).post("/api/instagram/backfill/start").send({});
    expect([401, 403]).toContain(res.status);
  });

  it("POST /api/instagram/backfill/start sem user deve dar 4xx e NÃO criar job", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

    const res = await request(app)
      .post("/api/instagram/backfill/start")
      .set("Authorization", makeAuthHeader("user-404"))
      .send({});

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);

    expect(prisma.instagramBackfillJob.create).not.toHaveBeenCalled();
  });

  it("POST /api/instagram/backfill/start sem conta IG deve dar 4xx e NÃO criar job", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: "user-1" });
    (prisma.instagramAccount.findFirst as jest.Mock).mockResolvedValue(null);

    const res = await request(app)
      .post("/api/instagram/backfill/start")
      .set("Authorization", makeAuthHeader("user-1"))
      .send({});

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);

    expect(prisma.instagramBackfillJob.create).not.toHaveBeenCalled();
  });

  it("POST /api/instagram/backfill/start se já existir job queued/running deve bloquear duplicado", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: "user-1" });
    (prisma.instagramAccount.findFirst as jest.Mock).mockResolvedValue({
      id: "ig_acc_1",
      userId: "user-1",
    });

    (prisma.instagramBackfillJob.findFirst as jest.Mock).mockResolvedValue({
      id: "job_existing",
      instagramAccountId: "ig_acc_1",
      status: "running",
      createdAt: new Date(),
    });

    const res = await request(app)
      .post("/api/instagram/backfill/start")
      .set("Authorization", makeAuthHeader("user-1"))
      .send({});

    // algumas APIs respondem 409, outras 200 retornando o job existente
    expect([200, 409, 400]).toContain(res.status);

    expect(prisma.instagramBackfillJob.create).not.toHaveBeenCalled();
  });
});