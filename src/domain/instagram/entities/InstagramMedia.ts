import type { Ymd } from "../value-objects/DateRangeYmd";

export type InstagramMedia = {
  id: string;
  timestampIso: string; 
  ymd: Ymd; 
  likeCount: number;
  commentsCount: number;
};

export type InstagramMediaInsights = {
  mediaId: string;
  shares: number;
  saved: number;
};

export function ymdFromIso(timestampIso: string): string {
  return String(timestampIso ?? "").slice(0, 10);
}
