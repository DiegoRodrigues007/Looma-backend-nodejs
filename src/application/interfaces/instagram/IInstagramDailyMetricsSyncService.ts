export type InstagramDailyMetricsSyncParams = {
  userId: string;
  instagramAccountId?: string | null;
  igUserId?: string | null;
  accessToken?: string | null;
  dayYmd?: string;
  force?: boolean;
};

export type InstagramDailyMetricsSyncResult = {
  ok: boolean;
  synced: boolean;
  dayYmd: string;
  instagramAccountId?: string | null;
  igUserId?: string | null;
  details?: Record<string, any>;
};

export interface IInstagramDailyMetricsSyncService {

  syncDailyMetrics(params: InstagramDailyMetricsSyncParams): Promise<InstagramDailyMetricsSyncResult>;
}
