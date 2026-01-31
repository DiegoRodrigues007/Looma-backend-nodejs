import type {
  IUserAuthRepository,
  UserAuthData,
} from "../../../application/ports/db/IUserAuthRepository";
import { prisma } from "../prismaClient";

export class PrismaUserAuthRepository implements IUserAuthRepository {
  async getAuthDataById(userId: string): Promise<UserAuthData | null> {
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, activeInstagramAccountId: true },
    });

    return row ?? null;
  }
}
