import request from "supertest";
import { app } from "../../../../src/presentation/http/app";
import { prisma } from "../../../../src/infrastructure/db/prismaClient";
import { makeAuthHeader } from "../../helpers/jwt";

describe("INTEGRATION /api/instagram/confirm", () => {
  it("deve exigir autenticação", async () => {
    const res = await request(app).post("/api/instagram/confirm").send({});
    expect(res.status).toBe(401);
  });

  it("deve retornar 400 se selectionId não for enviado", async () => {
    const user = await prisma.user.create({
      data: {
        email: "diego+ig-confirm-400@looma.com",
        name: "IG Confirm 400",
        passwordHash: "hash",
      },
    });

    const res = await request(app)
      .post("/api/instagram/confirm")
      .set("Authorization", makeAuthHeader(user.id))
      .set("x-test-user-id", user.id)
      .send({ igUserIds: ["IG_X"] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual(
      expect.objectContaining({
        ok: false,
      })
    );
  });

  it("deve retornar 400 se não enviar igUserIds/candidateIds", async () => {
    const user = await prisma.user.create({
      data: {
        email: "diego+ig-confirm-ids@looma.com",
        name: "IG Confirm IDs",
        passwordHash: "hash",
      },
    });

    const res = await request(app)
      .post("/api/instagram/confirm")
      .set("Authorization", makeAuthHeader(user.id))
      .set("x-test-user-id", user.id)
      .send({ selectionId: "SEL_1" });

    expect(res.status).toBe(400);
  });

  it("deve retornar 404 se não existir candidato com selectionId/seleção", async () => {
    const user = await prisma.user.create({
      data: {
        email: "diego+ig-confirm-404@looma.com",
        name: "IG Confirm 404",
        passwordHash: "hash",
      },
    });

    const res = await request(app)
      .post("/api/instagram/confirm")
      .set("Authorization", makeAuthHeader(user.id))
      .set("x-test-user-id", user.id)
      .send({ selectionId: "SEL_NOT_FOUND", igUserIds: ["IG_X"] });

    expect(res.status).toBe(404);
  });
});