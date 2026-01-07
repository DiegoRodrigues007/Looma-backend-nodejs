
import { MetricsSnapshot, MetricsPlatform } from "../entities/MetricsSnapshot";


export interface IMetricsSnapshotRepository {

  save(snapshot: MetricsSnapshot): Promise<void>;


  findByDate(
    userId: string,
    platform: MetricsPlatform,
    date: Date
  ): Promise<MetricsSnapshot | null>;


  findRange(
    userId: string,
    platform: MetricsPlatform,
    from: Date,
    to: Date
  ): Promise<MetricsSnapshot[]>;

  findLatest(
    userId: string,
    platform: MetricsPlatform
  ): Promise<MetricsSnapshot | null>;


  findPrevious(
    userId: string,
    platform: MetricsPlatform,
    beforeDate: Date
  ): Promise<MetricsSnapshot | null>;
}
