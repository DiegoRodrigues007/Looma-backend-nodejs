import "dotenv/config";

import { env } from "../../infrastructure/config/env";
import { app } from "./app";

import { startDailyMetricsSnapshotJob } from "../../infrastructure/jobs/DailyMetricsSnapshotJob";

import { startInstagramBackfillWorker } from "../../infrastructure/jobs/InstagramBackfillWorker";

import {
  runInstagramDailySnapshotsJob,
} from "../../infrastructure/jobs/instagramDailySnapshotsJob";

import {
  startInstagramAccountDailyMetricsCron,
} from "../../infrastructure/jobs/InstagramAccountDailyMetricsCron";

function isJobsEnabled() {
  return String(process.env.JOBS_ENABLED ?? "true").toLowerCase() === "true";
}

function isTrue(v?: string) {
  return String(v ?? "false").toLowerCase() === "true";
}

app.listen(env.port, () => {
  console.log(`🚀 API running at http://localhost:${env.port}`);
  console.log(`🌐 FRONTEND_URL runtime = ${process.env.FRONTEND_URL}`);
  console.log(`🕒 TZ = ${process.env.TZ ?? "not set"}`);

  if (!isJobsEnabled()) {
    console.log("⏸️ Jobs disabled (JOBS_ENABLED=false)");
    return;
  }

  if (isTrue(process.env.DAILY_METRICS_SNAPSHOT_ENABLED)) {
    startDailyMetricsSnapshotJob();
    console.log("📊 DailyMetricsSnapshotJob started");
  }
  startInstagramAccountDailyMetricsCron();
  console.log("⏰ InstagramAccountDailyMetrics CRON started");

  if (isTrue(process.env.IG_SNAPSHOTS_RUN_ON_BOOT)) {
    runInstagramDailySnapshotsJob()
      .then((r) =>
        console.log("✅ [IG DAILY METRICS] runOnBoot completed:", r)
      )
      .catch((e: any) =>
        console.error(
          "❌ [IG DAILY METRICS] runOnBoot failed:",
          e?.message ?? e
        )
      );
  }

  if (isTrue(process.env.IG_BACKFILL_ENABLED)) {
    startInstagramBackfillWorker({
      concurrency: 1,
      pollMs: 1500,
      maxPosts: 300,
      maxPages: 20,
      perPostDelayMs: 120,
      perPageDelayMs: 150,
    });

    console.log("🧵 Instagram Backfill Worker started");
  } else {
    console.log("⏸️ Instagram Backfill Worker disabled (IG_BACKFILL_ENABLED=false)");
  }
});
