// src/infrastructure/db/repositories/instagram/PrismaInstagramPostRepository.ts
import type {
  IInstagramPostRepository,
  UpsertRecentFromMediaItemsInput,
  DeleteOldBeyondKeepListInput,
} from "../../../../application/interfaces/db/IInstagramPostRepository";
import { prisma } from "../../prismaClient";

function s(v: any): string {
  return String(v ?? "").trim();
}

/**
 * Meta costuma retornar: "2026-01-24T00:00:00+0000"
 * Normaliza "+0000" -> "+00:00" pra parse confiável.
 */
function parseMetaTimestampToDate(ts: any): Date | null {
  const raw = s(ts);
  if (!raw) return null;
  const normalized = raw.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export class PrismaInstagramPostRepository implements IInstagramPostRepository {
  async upsertRecentFromMediaItems(input: UpsertRecentFromMediaItemsInput): Promise<number> {
    const { userId, instagramAccountId, items } = input;

    let upserted = 0;

    for (const it of items) {
      const igMediaId = s(it.id);
      if (!igMediaId) continue;

      const publishedAt = parseMetaTimestampToDate(it.timestamp) ?? new Date();
      const thumb = s(it.thumbnail_url) || s(it.media_url) || null;

      await prisma.instagramPost.upsert({
        where: {
          instagramAccountId_igMediaId: {
            instagramAccountId,
            igMediaId,
          },
        },
        create: {
          userId,
          instagramAccountId,
          igMediaId,
          mediaType: it.media_type ?? null,
          publishedAt,
          caption: it.caption ?? null,
          permalink: it.permalink ?? null,
          likeCount: 0,
          commentsCount: 0,
          thumb,
        },
        update: {
          mediaType: it.media_type ?? null,
          publishedAt,
          caption: it.caption ?? null,
          permalink: it.permalink ?? null,
          thumb,
        },
      });

      upserted++;
    }

    return upserted;
  }

  async deleteOldBeyondKeepList(input: DeleteOldBeyondKeepListInput): Promise<number> {
    const { userId, instagramAccountId, keepIgMediaIds } = input;

    const del = await prisma.instagramPost.deleteMany({
      where: {
        userId,
        instagramAccountId,
        igMediaId: { notIn: keepIgMediaIds },
      },
    });

    return del.count ?? 0;
  }
}
