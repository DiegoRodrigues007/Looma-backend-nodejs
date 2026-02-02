// src/application/ports/db/IInstagramPostRepository.ts
import type { IgMediaItem } from "../instagram/IInstagramGraphClient";

export type UpsertRecentFromMediaItemsInput = {
  userId: string;
  instagramAccountId: string;
  items: IgMediaItem[];
};

export type DeleteOldBeyondKeepListInput = {
  userId: string;
  instagramAccountId: string;
  keepIgMediaIds: string[];
};

export interface IInstagramPostRepository {
  upsertRecentFromMediaItems(input: UpsertRecentFromMediaItemsInput): Promise<number>;
  deleteOldBeyondKeepList(input: DeleteOldBeyondKeepListInput): Promise<number>;
}
