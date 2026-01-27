// test/unit/backfill/backfill.start.test.ts
import request from "supertest";
import { prisma } from "../../mocks/prismaClient";
import { makeAuthHeader } from "../../utils/jwt";
import {
  assertBasicJsonOk,
  assertHasRequestIdMaybe,
  pickJob,
} from "../../utils/response";

// ⚠️ Ajuste o import do app se necessário
import { app } from "../../../src/presentation/http/app";

describe("Backfill - Start (realistic)", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // ✅ evita crash caso o handler tente limpar/consultar outras coisas
    (prisma.instagramBackfillJob.deleteMany as jest.Mock).mockResolvedValue({
      count: 0,
    });
  });

  it("POST /api/instagram/backfill/start deve criar job queued e retornar id", async () => {
    // ✅ o handler normalmente valida o usuário autenticado
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: "user-1" });

    // ✅ precisa existir conta IG conectada/ativa (ajuste conforme seu handler)
    (prisma.instagramAccount.findFirst as jest.Mock).mockResolvedValue({
      id: "ig_acc_1",
      userId: "user-1",
      isConnected: true,
      igUserId: "IG_USER_1",
      pageAccessToken: "PAGE_TOKEN_1",
      updatedAt: new Date(),
    } as any);

    // ✅ não existe job ativo (então deve criar)
    (prisma.instagramBackfillJob.findFirst as jest.Mock).mockResolvedValue(null);

    (prisma.instagramBackfillJob.create as jest.Mock).mockResolvedValue({
      id: "job_1",
      instagramAccountId: "ig_acc_1",
      status: "queued",
      createdAt: new Date(),
    } as any);

    const res = await request(app)
      .post("/api/instagram/backfill/start")
      .set("Authorization", makeAuthHeader("user-1"))
      .send({});

    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);

    assertBasicJsonOk(res.body);
    assertHasRequestIdMaybe(res.body);

    // ✅ forte: tentou impedir duplicidade e depois criou
    expect(prisma.instagramBackfillJob.findFirst).toHaveBeenCalled();
    expect(prisma.instagramBackfillJob.create).toHaveBeenCalled();

    const job = pickJob(res.body);
    const jobId = (res.body as any).jobId ?? job?.id ?? (res.body as any).id;

    expect(typeof jobId).toBe("string");
    expect(String(jobId).length).toBeGreaterThan(2);
  });

  it("POST /api/instagram/backfill/start deve reaproveitar job existente (não duplicar)", async () => {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: "user-1" });

    (prisma.instagramAccount.findFirst as jest.Mock).mockResolvedValue({
      id: "ig_acc_1",
      userId: "user-1",
      isConnected: true,
      igUserId: "IG_USER_1",
      pageAccessToken: "PAGE_TOKEN_1",
      updatedAt: new Date(),
    } as any);

    // ✅ existe job ativo -> deve retornar ele
    (prisma.instagramBackfillJob.findFirst as jest.Mock).mockResolvedValue({
      id: "job_existing",
      instagramAccountId: "ig_acc_1",
      status: "running",
      createdAt: new Date(),
    } as any);

    const res = await request(app)
      .post("/api/instagram/backfill/start")
      .set("Authorization", makeAuthHeader("user-1"))
      .send({});

    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);

    assertBasicJsonOk(res.body);

    // ✅ não deve criar outro
    expect(prisma.instagramBackfillJob.create).not.toHaveBeenCalled();

    const job = pickJob(res.body);
    const jobId = (res.body as any).jobId ?? job?.id ?? (res.body as any).id;

    expect(String(jobId)).toBe("job_existing");
  });
});