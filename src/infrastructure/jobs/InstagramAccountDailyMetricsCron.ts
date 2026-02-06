import cron from "node-cron";
import { runInstagramDailySnapshotsJob } from "./instagramDailySnapshotsJob";

function s(v: any): string {
  return String(v ?? "").trim();
}

function isLeader(): boolean {
  // ✅ padrão seguro:
  // - se CRON_LEADER não existir -> assume leader (para não "morrer" em dev)
  // - se CRON_LEADER="false" -> não roda
  const v = s(process.env.CRON_LEADER).toLowerCase();
  if (!v) return true;
  return v !== "false" && v !== "0" && v !== "no";
}

export function startInstagramAccountDailyMetricsCron() {
  /**
   * ✅ Rodar 02:10 (America/Sao_Paulo)
   * - snapshot "do dia anterior" normalmente já está estável nesse horário
   * - se você quiser garantir ainda mais, pode ser 03:10
   */
  const schedule = process.env.IG_DAILY_METRICS_CRON ?? "10 2 * * *";

  cron.schedule(
    schedule,
    async () => {
      if (!isLeader()) {
        console.log("⏸️ [IG DAILY METRICS] Cron skipped (not leader)", {
          CRON_LEADER: process.env.CRON_LEADER,
        });
        return;
      }

      console.log("📊 [IG DAILY METRICS] Running InstagramAccountDailyMetrics job", {
        schedule,
        tz: "America/Sao_Paulo",
      });

      const start = Date.now();

      try {
        const result = await runInstagramDailySnapshotsJob();
        console.log(`✅ [IG DAILY METRICS] Done in ${Date.now() - start}ms`, result);
      } catch (err: any) {
        console.error("❌ [IG DAILY METRICS] Failed", {
          message: err?.message ?? String(err),
        });
      }
    },
    { timezone: "America/Sao_Paulo" }
  );

  console.log("⏱️ [IG DAILY METRICS] Cron scheduled", {
    schedule,
    timezone: "America/Sao_Paulo",
    leader: isLeader(),
  });
}
