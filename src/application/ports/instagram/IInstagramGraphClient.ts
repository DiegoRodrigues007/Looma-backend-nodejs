export type IgMediaItem = {
  id: string;
  caption?: string | null;
  media_type?: string | null;
  media_url?: string | null;
  permalink?: string | null;
  timestamp?: string | null;
  thumbnail_url?: string | null;
  like_count?: number | string | null;
  comments_count?: number | string | null;
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
  data: IgMediaItem[];
  paging?: {
    cursors?: { after?: string };
    next?: string;
  };
};

export type GetMediaReachInput = {
  mediaId: string;
  accessToken: string;
  timeoutMs?: number;
};

export interface IInstagramGraphClient {
  getRecentMedia(input: GetRecentMediaInput): Promise<IgMediaItem[]>;
  getRecentMediaPaged(input: GetRecentMediaInput): Promise<GetRecentMediaOutput>;
  getMediaReach(input: GetMediaReachInput): Promise<number>;
}
 