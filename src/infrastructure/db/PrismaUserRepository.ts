import { IUserRepository } from "../../domain/repositories/IUserRepository";
import { User } from "../../domain/entities/User";
import { prisma } from "./prismaClient";

export class PrismaUserRepository implements IUserRepository {
  async findByEmailOrUserName(emailOrUserName: string): Promise<User | null> {
    const row = await prisma.user.findFirst({
      where: {
        OR: [{ email: emailOrUserName }, { userName: emailOrUserName }]
      }
    });

    if (!row) return null;

    return User.fromPersistence({
      id: row.id,
      email: row.email,
      userName: row.userName,
      name: row.name,
      passwordHash: row.passwordHash,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    });
  }

  async findById(id: string): Promise<User | null> {
    const row = await prisma.user.findUnique({ where: { id } });
    if (!row) return null;

    return User.fromPersistence({
      id: row.id,
      email: row.email,
      userName: row.userName,
      name: row.name,
      passwordHash: row.passwordHash,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    });
  }

  async create(user: User): Promise<void> {
    const data = user.toPrimitives();

    await prisma.user.create({
      data: {
        id: data.id,
        email: data.email,
        userName: data.userName ?? undefined,
        name: data.name,
        passwordHash: data.passwordHash,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt
      }
    });
  }
}
