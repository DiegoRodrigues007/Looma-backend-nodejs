export type MetricsPlatform = "instagram" | "youtube";

export class MetricsSnapshot {
  constructor(
    public readonly userId: string,
    public readonly platform: MetricsPlatform,
    public readonly date: Date,

    public readonly followers: number,
    public readonly reach: number,
    public readonly totalInteractions: number,
    public readonly engagementRate: number
  ) {}
}
