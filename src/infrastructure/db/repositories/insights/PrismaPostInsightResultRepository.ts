import { prisma } from "../../prismaClient";
import type {
  IPostInsightResultRepository,
  PersistPostInsightResultParams,
} from "../../../../application/interfaces/insights/IPostInsightResultRepository";

export class PrismaPostInsightResultRepository
  implements IPostInsightResultRepository
{
  async upsertResult(params: PersistPostInsightResultParams): Promise<void> {
    const {
      userId,
      instagramAccountId,
      igUserId,
      postId,
      postDbId,
      baselineDays,
      payloadJson,
    } = params;

    const where: any = {};
    if (postDbId) {
      where.postId_baselineDays = { postId: postDbId, baselineDays };
    } else {
      where.igUserId_postId_baselineDays = { igUserId, postId, baselineDays };
    }

    // @ts-ignore (schema pode variar)
    await prisma.instagramPostInsightResults.upsert({
      where,
      update: {
        userId: String(userId),
        instagramAccountId: instagramAccountId ?? null,
        igUserId: String(igUserId),
        postId: String(postId),
        baselineDays,
        payloadJson,
        updatedAt: new Date(),
      },
      create: {
        userId: String(userId),
        instagramAccountId: instagramAccountId ?? null,
        igUserId: String(igUserId),
        postId: String(postId),
        baselineDays,
        postDbId: postDbId ?? null,
        payloadJson,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }
}
