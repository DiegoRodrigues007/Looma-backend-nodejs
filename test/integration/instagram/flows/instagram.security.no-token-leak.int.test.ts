import request from "supertest";
import { app } from "../../../../src/presentation/http/app";
import { prisma } from "../../../../src/infrastructure/db/prismaClient";
import { makeAuthHeader } from "../../helpers/jwt";
import { createTestUser, createConnectedInstagramAccount } from "../../helpers/igTestFactory";

function assertNoSecrets(obj: any) {
  const json = JSON.stringify(obj).toLowerCase();
  // palavras-chave de segredo que não podem aparecer
  const forbidden = ["access_token", "pageaccesstoken", "refresh_token", "tokenhash", "client_secret"];
  for (const f of forbidden) expect(json.includes(f)).toBe(false);
}

describe("INTEGRATION Instagram Security - no token leak", () => {
  beforeEach(async () => {
    await prisma.instagramAccountDailyMetrics.deleteMany();
    await prisma.instagramCandidate.deleteMany();
    await prisma.instagramAccount.deleteMany();
    await prisma.user.deleteMany();
  });

  it("status/accounts/active/candidates não podem vazar tokens", async () => {
    const user = await createTestUser("diego+ig-security@looma.com");
    const acc = await createConnectedInstagramAccount({ userId: user.id, igUserId: "IG_SEC_1" });

    await prisma.user.update({ where: { id: user.id }, data: { activeInstagramAccountId: acc.id } });

    await prisma.instagramCandidate.create({
      data: {
        userId: user.id,
        selectionId: "SEL_SEC",
        igUserId: "IG_CAND_SEC",
        facebookPageId: "PAGE_1",
        facebookPageName: "Fake Page",
        pageAccessToken: "SHOULD_NOT_LEAK",
        source: "graph",
      },
    });

    const routes = [
      "/api/instagram/status",
      "/api/instagram/accounts",
      "/api/instagram/active",
      "/api/instagram/candidates?selectionId=SEL_SEC",
    ];

    for (const r of routes) {
      const res = await request(app).get(r).set("Authorization", makeAuthHeader(user.id));
      expect(res.status).toBe(200);
      assertNoSecrets(res.body);
    }
  });
});