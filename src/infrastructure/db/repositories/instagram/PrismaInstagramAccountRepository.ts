import type {
  IInstagramAccountRepository,
  InstagramAccountRecord,
  InstagramAccountListDTO,
  UpdateInstagramAccountTokenInput,
} from "../../../../application/interfaces/db/IInstagramAccountRepository";
import { prisma } from "../../prismaClient";

export class PrismaInstagramAccountRepository
  implements IInstagramAccountRepository
{

  async findById(
    userId: string,
    accountId: string
  ): Promise<InstagramAccountRecord | null> {
    const acc = await prisma.instagramAccount.findFirst({
      where: {
        id: accountId,
        userId,
      },
      orderBy: { updatedAt: "desc" },
    });

    if (!acc) return null;

    return {
      id: acc.id,
      userId: acc.userId,
      isConnected: acc.isConnected,
      igUserId: (acc as any).igUserId ?? null,
      accessToken: (acc as any).accessToken ?? null,
      pageAccessToken: (acc as any).pageAccessToken ?? null,
      tokenExpiresAt: (acc as any).expiresAt ?? null, 
      grantedScopes: (acc as any).grantedScopes ?? null,
    };
  }

  async findConnectedById(
    userId: string,
    accountId: string
  ): Promise<InstagramAccountRecord | null> {
    const acc = await prisma.instagramAccount.findFirst({
      where: {
        id: accountId,
        userId,
        isConnected: true,
      },
      orderBy: { updatedAt: "desc" },
    });

    if (!acc) return null;

    return {
      id: acc.id,
      userId: acc.userId,
      isConnected: acc.isConnected,
      igUserId: (acc as any).igUserId ?? null,
      accessToken: (acc as any).accessToken ?? null,
      pageAccessToken: (acc as any).pageAccessToken ?? null,
      tokenExpiresAt: (acc as any).expiresAt ?? null,
      grantedScopes: (acc as any).grantedScopes ?? null,
    };
  }

  async findLatestConnected(userId: string): Promise<InstagramAccountRecord | null> {
    const acc = await prisma.instagramAccount.findFirst({
      where: {
        userId,
        isConnected: true,
      },
      orderBy: { updatedAt: "desc" },
    });

    if (!acc) return null;

    return {
      id: acc.id,
      userId: acc.userId,
      isConnected: acc.isConnected,
      igUserId: (acc as any).igUserId ?? null,
      accessToken: (acc as any).accessToken ?? null,
      pageAccessToken: (acc as any).pageAccessToken ?? null,
      tokenExpiresAt: (acc as any).expiresAt ?? null,
      grantedScopes: (acc as any).grantedScopes ?? null,
    };
  }

  async updateToken(input: UpdateInstagramAccountTokenInput): Promise<void> {
    await prisma.instagramAccount.update({
      where: {
        id: input.instagramAccountId,
        userId: input.userId,
      },
      data: {
        accessToken: input.accessToken,
        expiresAt: input.tokenExpiresAt,
        ...(input.pageAccessToken !== undefined
          ? { pageAccessToken: input.pageAccessToken }
          : {}),
        ...(input.lastRefreshedAt !== undefined
          ? { lastRefreshedAt: input.lastRefreshedAt }
          : {}),
        isConnected: true,
        updatedAt: new Date(),
      },
    });
  }

  async listByUser(userId: string): Promise<InstagramAccountListDTO[]> {
    const rows = await prisma.instagramAccount.findMany({
      where: {
        userId,
        isConnected: true,
        OR: [{ pageAccessToken: { not: null } }, { accessToken: { not: null } }],
      },
      orderBy: { updatedAt: "desc" },
      take: 50,
      select: {
        id: true,
        igUserId: true,
        username: true,
        accountType: true,
        facebookPageId: true,
        expiresAt: true,
        isConnected: true,
        updatedAt: true,
      },
    });

    return rows.map((r) => ({
      id: r.id,
      igUserId: r.igUserId ?? "",
      username: r.username ?? null,
      accountType: r.accountType ?? null,
      facebookPageId: r.facebookPageId ?? null,
      expiresAt: r.expiresAt ?? null,
      isConnected: r.isConnected,
      updatedAt: r.updatedAt,
    }));
  }
}
