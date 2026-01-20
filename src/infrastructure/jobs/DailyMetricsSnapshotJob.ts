import cron from "node-cron";
import { PrismaMetricsSnapshotRepository } from "../db/PrismaMetricsSnapshotRepository";
import { MetricsHistoryService } from "../../application/services/MetricsHistoryService";
import { InstagramMetricsService } from "../instagram/InstagramMetricsService";
import { prisma } from "../db/prismaClient";

export function startDailyMetricsSnapshotJob() {
  cron.schedule(
    // ✅ todo dia às 00:05
    "5 0 * * *",
    async () => {
      console.log("📊 [SNAPSHOT] Running daily Instagram metrics snapshot");

      const repo = new PrismaMetricsSnapshotRepository();
      const historyService = new MetricsHistoryService(repo);

      const accounts = await prisma.instagramAccount.findMany({
        where: { isConnected: true },
        select: {
          userId: true,
          igUserId: true,
          accessToken: true,
          pageAccessToken: true,
        },
      });

      let processed = 0;
      let saved = 0;
      let skipped = 0;
      let failed = 0;

      for (const account of accounts) {
        processed++;

        const igUserId = account.igUserId ? String(account.igUserId) : null;
        const accessToken =
          account.pageAccessToken ?? account.accessToken ?? null;

        if (!igUserId || !accessToken) {
          skipped++;
          continue;
        }

        try {
          // 🔹 busca métricas do dia
          const metrics = await InstagramMetricsService.fetchDailyMetrics(
            igUserId,
            accessToken
          );

          // 🔹 garante apenas 1 snapshot por dia
          const didSave = await historyService.ensureDailySnapshot(
            account.userId,
            "instagram",
            metrics
          );

          if (didSave) saved++;
          else skipped++;
        } catch (err) {
          failed++;
          console.error(
            `❌ Snapshot failed for userId=${account.userId} igUserId=${igUserId}`,
            err
          );
        }
      }

      console.log(
        `✅ [SNAPSHOT] Done. processed=${processed} saved=${saved} skipped=${skipped} failed=${failed}`
      );
    },
    {
      timezone: "America/Sao_Paulo",
    }
  );
}
