import { prisma } from "../../../src/infrastructure/db/prismaClient";

export async function createTestUser(email: string) {
  return prisma.user.create({
    data: {
      email,
      name: "Test User",
      passwordHash: "hash",
    },
  });
}

export async function createConnectedInstagramAccount(params: {
  userId: string;
  igUserId: string;
  username?: string;
  pageAccessToken?: string;
  isConnected?: boolean;
  facebookPageId?: string | null;
}) {
  return prisma.instagramAccount.create({
    data: {
      userId: params.userId,
      igUserId: params.igUserId,
      username: params.username ?? `user_${params.igUserId}`,
      accountType: "BUSINESS",
      isConnected: params.isConnected ?? true,
      pageAccessToken: params.pageAccessToken ?? "FAKE_PAGE_ACCESS_TOKEN_OK",
      facebookPageId: params.facebookPageId ?? "PAGE_1",

      // ❌ NÃO existe no schema do InstagramAccount:
      // facebookPageName: "Fake Page",
    } as any,
  });
}

export async function seedDailyMetrics(params: {
  userId: string;
  instagramAccountId: string;
  points: Array<{
    day: string;
    reach: number;
    profileViewsTotal: number;
    totalInteractions: number;
  }>;
}) {
  return prisma.instagramAccountDailyMetrics.createMany({
    data: params.points.map((p) => ({
      userId: params.userId,
      instagramAccountId: params.instagramAccountId,
      day: new Date(`${p.day}T00:00:00.000Z`),
      reach: p.reach,
      profileViewsTotal: p.profileViewsTotal,
      totalInteractions: p.totalInteractions,
    })),
  });
}