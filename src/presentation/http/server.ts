// src/presentation/http/server.ts
import "dotenv/config";

import { env } from "../../infrastructure/config/env";
import { app } from "./app";

import { startDailyMetricsSnapshotJob } from "../../infrastructure/jobs/DailyMetricsSnapshotJob";
import { startInstagramBackfillWorker } from "../../infrastructure/jobs/InstagramBackfillWorker";
import { runInstagramDailySnapshotsJob } from "../../infrastructure/jobs/instagramDailySnapshotsJob";
import { startInstagramAccountDailyMetricsCron } from "../../infrastructure/jobs/InstagramAccountDailyMetricsCron";

function isTrue(v?: string) {
  return String(v ?? "false").toLowerCase() === "true";
}

function isJobsEnabled() {
  // default: true (mantém seu comportamento atual)
  return String(process.env.JOBS_ENABLED ?? "true").toLowerCase() === "true";
}

function n(v: any, fallback: number, min?: number, max?: number) {
  const x = Number(v);
  const val = Number.isFinite(x) ? x : fallback;
  if (typeof min === "number" && val < min) return min;
  if (typeof max === "number" && val > max) return max;
  return val;
}

function logBootConfig() {
  console.log(`🚀 API running at http://localhost:${env.port}`);
  console.log(`🌐 FRONTEND_URL runtime = ${process.env.FRONTEND_URL}`);
  console.log(`🕒 TZ = ${process.env.TZ ?? "not set"}`);

  console.log("⚙️ Jobs config:", {
    JOBS_ENABLED: process.env.JOBS_ENABLED ?? "true",
    DAILY_METRICS_SNAPSHOT_ENABLED:
      process.env.DAILY_METRICS_SNAPSHOT_ENABLED ?? "false",
    IG_SNAPSHOTS_RUN_ON_BOOT: process.env.IG_SNAPSHOTS_RUN_ON_BOOT ?? "false",
    IG_BACKFILL_ENABLED: process.env.IG_BACKFILL_ENABLED ?? "false",
  });
}

app.listen(env.port, () => {
  logBootConfig();

  if (!isJobsEnabled()) {
    console.log("⏸️ Jobs disabled (JOBS_ENABLED=false)");
    return;
  }

  /**
   * ===========================
   * 1) Daily Metrics Snapshot
   * ===========================
   */
  if (isTrue(process.env.DAILY_METRICS_SNAPSHOT_ENABLED)) {
    startDailyMetricsSnapshotJob();
    console.log("📊 DailyMetricsSnapshotJob started");
  } else {
    console.log(
      "⏸️ DailyMetricsSnapshotJob disabled (DAILY_METRICS_SNAPSHOT_ENABLED=false)"
    );
  }

  /**
   * ======================================
   * 2) InstagramAccountDailyMetrics CRON
   * ======================================
   */
  startInstagramAccountDailyMetricsCron();
  console.log("⏰ InstagramAccountDailyMetrics CRON started");

  /**
   * ======================================
   * 3) IG Daily Snapshots run on boot
   * ======================================
   */
  if (isTrue(process.env.IG_SNAPSHOTS_RUN_ON_BOOT)) {
    runInstagramDailySnapshotsJob()
      .then((r) =>
        console.log("✅ [IG DAILY METRICS] runOnBoot completed:", r)
      )
      .catch((e: any) =>
        console.error("❌ [IG DAILY METRICS] runOnBoot failed:", e?.message ?? e)
      );
  } else {
    console.log("⏸️ IG daily snapshots runOnBoot disabled (IG_SNAPSHOTS_RUN_ON_BOOT=false)");
  }

  /**
   * ===========================
   * 4) Instagram Backfill Worker
   * ===========================
   *
   * ✅ IMPORTANTE:
   * - Agora o worker consome jobs do BANCO (instagramBackfillJob status=queued)
   * - Então os params "maxPosts/maxPages/delays" não são mais usados aqui.
   *   (Eles eram do worker antigo em memória).
   *
   * Se você quiser controlar limite/delay, isso precisa ser implementado dentro do
   * RunInstagramBackfillUseCase (ou dentro do provider que chama a API do Instagram).
   */
  if (isTrue(process.env.IG_BACKFILL_ENABLED)) {
    // Permite override via env sem quebrar seu código
    const pollMs = n(process.env.IG_BACKFILL_POLL_MS, 1500, 100, 60_000);
    const maxParallelJobs = n(
      process.env.IG_BACKFILL_MAX_PARALLEL_JOBS,
      1,
      1,
      5
    );
    const concurrency = n(process.env.IG_BACKFILL_CONCURRENCY, 1, 1, 10);
    const alwaysRefetchLastDays = n(
      process.env.IG_BACKFILL_ALWAYS_REFETCH_LAST_DAYS,
      7,
      0,
      60
    );

    startInstagramBackfillWorker({
      pollMs,
      maxParallelJobs,
      concurrency,
      alwaysRefetchLastDays,
    });

    console.log("🧵 Instagram Backfill Worker started", {
      pollMs,
      maxParallelJobs,
      concurrency,
      alwaysRefetchLastDays,
    });
  } else {
    console.log(
      "⏸️ Instagram Backfill Worker disabled (IG_BACKFILL_ENABLED=false)"
    );
  }
});
