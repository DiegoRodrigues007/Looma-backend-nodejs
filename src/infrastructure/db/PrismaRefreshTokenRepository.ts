import { prisma } from "./prismaClient"; 

export class PrismaRefreshTokenRepository {
  async create(userId: string, tokenHash: string, expiresAt: Date) {
    return prisma.refreshToken.create({
      data: { userId, tokenHash, expiresAt },
    });
  }

  async findValidByHash(tokenHash: string) {
    return prisma.refreshToken.findFirst({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
  }

  async revoke(tokenHash: string) {
    return prisma.refreshToken.updateMany({
      where: { tokenHash },
      data: { revokedAt: new Date() },
    });
  }
}
