export type InstagramMediaType =
  | "IMAGE"
  | "VIDEO"
  | "CAROUSEL_ALBUM"
  | "REELS"
  | "STORY"
  | "UNKNOWN";

export type InstagramMediaItem = {
  id: string;
  caption: string | null;
  mediaType: InstagramMediaType;
  mediaUrl: string | null;
  permalink: string | null;
  timestamp: Date | null; // ✅ normalizado (Date)
  thumbnailUrl: string | null;
  likeCount: number;
  commentsCount: number;
};

export type PaginationCursor = {
  after?: string;
};

export type Pagination = {
  cursors?: PaginationCursor;
  next?: string;
};

export type GetRecentMediaInput = {
  igUserId: string;
  accessToken: string;
  limit: number;
  after?: string;
  fields?: string;
  timeoutMs?: number;
};

export type GetRecentMediaOutput = {
  data: InstagramMediaItem[];
  paging?: Pagination;
};

export type GetMediaReachInput = {
  mediaId: string;
  accessToken: string;
  timeoutMs?: number;
};

export interface IInstagramGraphClient {
  getRecentMedia(input: GetRecentMediaInput): Promise<InstagramMediaItem[]>;
  getRecentMediaPaged(input: GetRecentMediaInput): Promise<GetRecentMediaOutput>;
  getMediaReach(input: GetMediaReachInput): Promise<number>;
}

/**
 * ✅ Tipo RAW (como vem da API do Instagram/Meta)
 * timestamp é string ISO
 */
export type IgMediaItemRaw = {
  id: string;
  caption?: string | null;
  media_type?: string | null;
  media_url?: string | null;
  permalink?: string | null;
  timestamp?: string | null; // ✅ raw (string)
  thumbnail_url?: string | null;
  like_count?: number | string | null;
  comments_count?: number | string | null;
};

function toNullString(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s.length ? s : null;
}

function toSafeDate(v: unknown): Date | null {
  const s = toNullString(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

function toSafeNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function normalizeMediaType(v: unknown): InstagramMediaType {
  const s = String(v ?? "").trim().toUpperCase();
  if (s === "IMAGE") return "IMAGE";
  if (s === "VIDEO") return "VIDEO";
  if (s === "CAROUSEL_ALBUM") return "CAROUSEL_ALBUM";
  if (s === "REELS") return "REELS";
  if (s === "STORY") return "STORY";
  return "UNKNOWN";
}

/**
 * ✅ RAW -> NORMALIZADO
 */
export function normalizeInstagramMediaItem(raw: IgMediaItemRaw): InstagramMediaItem {
  return {
    id: String(raw.id),
    caption: toNullString(raw.caption),
    mediaType: normalizeMediaType(raw.media_type),
    mediaUrl: toNullString(raw.media_url),
    permalink: toNullString(raw.permalink),
    timestamp: toSafeDate(raw.timestamp), // string -> Date
    thumbnailUrl: toNullString(raw.thumbnail_url),
    likeCount: toSafeNumber(raw.like_count),
    commentsCount: toSafeNumber(raw.comments_count),
  };
}

/**
 * ✅ Helper para arrays (RAW -> NORMALIZADO)
 */
export function normalizeInstagramMediaItems(rawItems: IgMediaItemRaw[]): InstagramMediaItem[] {
  return rawItems.map(normalizeInstagramMediaItem);
}

/**
 * ✅ NORMALIZADO -> RAW
 * (isso evita o TS2322 quando alguém precisa de IgMediaItemRaw[])
 */
export function toIgMediaItemRaw(item: InstagramMediaItem): IgMediaItemRaw {
  return {
    id: item.id,
    caption: item.caption,
    media_type: item.mediaType,
    media_url: item.mediaUrl,
    permalink: item.permalink,
    timestamp: item.timestamp ? item.timestamp.toISOString() : null, // Date -> string ISO
    thumbnail_url: item.thumbnailUrl,
    like_count: item.likeCount,
    comments_count: item.commentsCount,
  };
}

/**
 * ✅ Helper para arrays (NORMALIZADO -> RAW)
 */
export function toIgMediaItemsRaw(items: InstagramMediaItem[]): IgMediaItemRaw[] {
  return items.map(toIgMediaItemRaw);
}
