// src/presentation/http/server.ts
import "dotenv/config";

import { env } from "../../infrastructure/config/env";
import { app } from "./app";

import { startDailyMetricsSnapshotJob } from "../../infrastructure/jobs/DailyMetricsSnapshotJob";
import { startInstagramBackfillWorker } from "../../infrastructure/jobs/InstagramBackfillWorker";
import { runInstagramDailySnapshotsJob } from "../../infrastructure/jobs/instagramDailySnapshotsJob";
import { startInstagramAccountDailyMetricsCron } from "../../infrastructure/jobs/InstagramAccountDailyMetricsCron";

/**
 * ✅ Ajustes feitos:
 * - padroniza bool/env parsing (evita "TRUE", "1", "yes" etc. não pegar)
 * - não inicia CRON se JOBS_ENABLED=false
 * - controla InstagramAccountDailyMetricsCron por env (pra você ligar/desligar)
 * - adiciona logs claros do que está realmente ligado
 * - garante TZ padrão (se você quiser) sem quebrar produção
 */

const DEFAULT_TZ = "America/Sao_Paulo";

function isTrue(v?: string): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "y" || s === "on";
}

function isFalse(v?: string): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "false" || s === "0" || s === "no" || s === "n" || s === "off";
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (isTrue(raw)) return true;
  if (isFalse(raw)) return false;
  return fallback;
}

function envNum(
  name: string,
  fallback: number,
  min?: number,
  max?: number,
): number {
  const raw = process.env[name];
  const x = Number(raw);
  const val = Number.isFinite(x) ? x : fallback;
  if (typeof min === "number" && val < min) return min;
  if (typeof max === "number" && val > max) return max;
  return val;
}

function logBootConfig() {
  console.log(`🚀 API running at http://localhost:${env.port}`);
  console.log(`🕒 TZ = ${process.env.TZ ?? "(not set)"} (default=${DEFAULT_TZ})`);

  console.log("🌐 Front URLs (env):", {
    FRONT_URL: process.env.FRONT_URL ?? "(not set)",
    FRONTEND_URL: process.env.FRONTEND_URL ?? "(not set)",
    IG_RETURN_PATH: process.env.IG_RETURN_PATH ?? "(not set)",
  });

  console.log("⚡ In-process backfill (env):", {
    ENABLE_INPROCESS_BACKFILL: process.env.ENABLE_INPROCESS_BACKFILL ?? "(not set)",
    INPROCESS_BACKFILL_CONCURRENCY: process.env.INPROCESS_BACKFILL_CONCURRENCY ?? "(not set)",
  });

  console.log("⚙️ Jobs config (env):", {
    JOBS_ENABLED: process.env.JOBS_ENABLED ?? "(default true)",
    DAILY_METRICS_SNAPSHOT_ENABLED: process.env.DAILY_METRICS_SNAPSHOT_ENABLED ?? "(default false)",
    IG_SNAPSHOTS_RUN_ON_BOOT: process.env.IG_SNAPSHOTS_RUN_ON_BOOT ?? "(default false)",
    IG_ACCOUNT_DAILY_METRICS_CRON_ENABLED:
      process.env.IG_ACCOUNT_DAILY_METRICS_CRON_ENABLED ?? "(default true)",

    IG_BACKFILL_ENABLED: process.env.IG_BACKFILL_ENABLED ?? "(default false)",
    IG_BACKFILL_POLL_MS: process.env.IG_BACKFILL_POLL_MS ?? "(default 1500)",
    IG_BACKFILL_MAX_PARALLEL_JOBS: process.env.IG_BACKFILL_MAX_PARALLEL_JOBS ?? "(default 1)",
    IG_BACKFILL_CONCURRENCY: process.env.IG_BACKFILL_CONCURRENCY ?? "(default 1)",
    IG_BACKFILL_ALWAYS_REFETCH_LAST_DAYS:
      process.env.IG_BACKFILL_ALWAYS_REFETCH_LAST_DAYS ?? "(default 7)",
  });

  console.log("🪵 Debug flags (env):", {
    IG_DEBUG_LOGS: process.env.IG_DEBUG_LOGS ?? "(not set)",
    IG_DEBUG: process.env.IG_DEBUG ?? "(not set)",
  });

  console.log("✅ [ENV CHECK] resolved booleans:", {
    jobsEnabled: envBool("JOBS_ENABLED", true),
    dailyMetricsSnapshot: envBool("DAILY_METRICS_SNAPSHOT_ENABLED", false),
    igDailyRunOnBoot: envBool("IG_SNAPSHOTS_RUN_ON_BOOT", false),
    igAccountDailyCron: envBool("IG_ACCOUNT_DAILY_METRICS_CRON_ENABLED", true),
    igBackfillWorkerEnabled: envBool("IG_BACKFILL_ENABLED", false),
    inprocessBackfillEnabled: envBool("ENABLE_INPROCESS_BACKFILL", false),
  });
}

app.listen(env.port, () => {
  // ✅ opcional: se não setou TZ, define default (não sobrescreve se já existe)
  if (!process.env.TZ) {
    process.env.TZ = DEFAULT_TZ;
  }

  logBootConfig();

  const jobsEnabled = envBool("JOBS_ENABLED", true);

  if (!jobsEnabled) {
    console.log("⏸️ Jobs disabled (JOBS_ENABLED=false)");
    return;
  }

  /**
   * ===========================
   * 1) Daily Metrics Snapshot
   * ===========================
   */
  if (envBool("DAILY_METRICS_SNAPSHOT_ENABLED", false)) {
    startDailyMetricsSnapshotJob();
    console.log("📊 DailyMetricsSnapshotJob started");
  } else {
    console.log("⏸️ DailyMetricsSnapshotJob disabled (DAILY_METRICS_SNAPSHOT_ENABLED=false)");
  }

  /**
   * ======================================
   * 2) InstagramAccountDailyMetrics CRON
   * ======================================
   * ✅ agora dá pra desligar via env
   */
  if (envBool("IG_ACCOUNT_DAILY_METRICS_CRON_ENABLED", true)) {
    startInstagramAccountDailyMetricsCron();
    console.log("⏰ InstagramAccountDailyMetrics CRON started");
  } else {
    console.log(
      "⏸️ InstagramAccountDailyMetrics CRON disabled (IG_ACCOUNT_DAILY_METRICS_CRON_ENABLED=false)",
    );
  }

  /**
   * ======================================
   * 3) IG Daily Snapshots run on boot
   * ======================================
   */
  if (envBool("IG_SNAPSHOTS_RUN_ON_BOOT", false)) {
    runInstagramDailySnapshotsJob()
      .then((r) => console.log("✅ [IG DAILY METRICS] runOnBoot completed:", r))
      .catch((e: any) =>
        console.error("❌ [IG DAILY METRICS] runOnBoot failed:", e?.message ?? e),
      );
  } else {
    console.log("⏸️ IG daily snapshots runOnBoot disabled (IG_SNAPSHOTS_RUN_ON_BOOT=false)");
  }

  /**
   * ===========================
   * 4) Instagram Backfill Worker
   * ===========================
   */
  if (envBool("IG_BACKFILL_ENABLED", false)) {
    const pollMs = envNum("IG_BACKFILL_POLL_MS", 1500, 100, 60_000);
    const maxParallelJobs = envNum("IG_BACKFILL_MAX_PARALLEL_JOBS", 1, 1, 5);
    const concurrency = envNum("IG_BACKFILL_CONCURRENCY", 1, 1, 10);
    const alwaysRefetchLastDays = envNum("IG_BACKFILL_ALWAYS_REFETCH_LAST_DAYS", 7, 0, 60);

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
    console.log("⏸️ Instagram Backfill Worker disabled (IG_BACKFILL_ENABLED=false)");
  }
});
