export type InstagramDailyMetricRow = {
  readonly day: Date;
  readonly followers: number | null;
  readonly reach: number | null;
  readonly profileViewsTotal: number | null;
  readonly totalInteractions: number | null;
};

export type ListInstagramDailyMetricsByRangeInput = {
  readonly userId: string;
  readonly instagramAccountId: string;
  readonly from: Date; // inclusive (UTC)
  readonly to: Date;   // inclusive (UTC)
};

export type UpsertInstagramDailyMetricInput = {
  readonly userId: string;
  readonly instagramAccountId: string;

  readonly day: Date;

  readonly followers: number | null;
  readonly reach: number | null;
  readonly profileViewsTotal: number | null;
  readonly totalInteractions: number | null;
};

export interface IInstagramDailyMetricsRepository {

  listByRange(
    args: ListInstagramDailyMetricsByRangeInput,
  ): Promise<InstagramDailyMetricRow[]>;

  upsertDay(input: UpsertInstagramDailyMetricInput): Promise<void>;

  upsertDailyMetrics?(
    input: ReadonlyArray<UpsertInstagramDailyMetricInput>,
  ): Promise<void>;
}
