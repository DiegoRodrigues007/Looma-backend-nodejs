import {
  buildKpis,
  MetricsOverview,
  MetricsSnapshot,
} from "../../../domain/metrics/calculators/buildKpis";

export class MetricsService {
  static buildOverview(
    current: MetricsSnapshot,
    previous: MetricsSnapshot
  ): MetricsOverview {
    return buildKpis(current, previous);
  }
}
