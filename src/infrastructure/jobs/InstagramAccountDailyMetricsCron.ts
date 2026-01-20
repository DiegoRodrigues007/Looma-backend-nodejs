import cron from "node-cron";
import { runInstagramDailySnapshotsJob } from "./instagramDailySnapshotsJob";

export function startInstagramAccountDailyMetricsCron() {
  cron.schedule(
    "10 2 * * *",
    async () => {
      if (process.env.CRON_LEADER === "false") {
        console.log("⏸️ [IG DAILY METRICS] Cron skipped (not leader)");
        return;
      }

      console.log("📊 [IG DAILY METRICS] Running InstagramAccountDailyMetrics job");
      const start = Date.now();

      try {
        const result = await runInstagramDailySnapshotsJob();
        console.log(
          `✅ [IG DAILY METRICS] Done in ${Date.now() - start}ms`,
          result
        );
      } catch (err) {
        console.error("❌ [IG DAILY METRICS] Failed", err);
      }
    },
    { timezone: "America/Sao_Paulo" }
  );
}
