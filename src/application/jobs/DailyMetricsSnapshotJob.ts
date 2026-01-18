import cron from "node-cron";
import { PrismaMetricsSnapshotRepository } from "../../infrastructure/db/PrismaMetricsSnapshotRepository";
import { MetricsHistoryService } from "../services/MetricsHistoryService";
import { InstagramMetricsService } from "../../infrastructure/instagram/InstagramMetricsService";
import { prisma } from "../../infrastructure/db/prismaClient";

export function startDailyMetricsSnapshotJob() {
  cron.schedule(
    "5 0 * * *",
    async () => {
      console.log("📊 Running daily Instagram metrics snapshot (backup)");

      const repo = new PrismaMetricsSnapshotRepository();
      const historyService = new MetricsHistoryService(repo);

      const accounts = await prisma.instagramAccount.findMany({
        where: { isConnected: true },
        select: {
          userId: true,
          igUserId: true, // ✅ CORRETO (no seu schema é igUserId)
          accessToken: true,
          pageAccessToken: true, // ✅ se existir no seu model, ajuda (prioriza)
        },
      });

      let processed = 0;
      let saved = 0;
      let skipped = 0;
      let failed = 0;

      for (const account of accounts) {
        processed++;

        const igUserId = account.igUserId ? String(account.igUserId) : null;

        // ✅ prioriza pageAccessToken (melhor pros endpoints IG), senão accessToken
        const accessToken =
          (account as any).pageAccessToken ?? account.accessToken ?? null;

        if (!igUserId || !accessToken) {
          skipped++;
          continue;
        }

        try {
          const metrics = await InstagramMetricsService.fetchDailyMetrics(
            igUserId,
            accessToken
          );

          // ✅ híbrido: só salva se ainda não existir snapshot do dia
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
        `✅ Daily snapshot done. processed=${processed} saved=${saved} skipped=${skipped} failed=${failed}`
      );
    },
    {
      timezone: "America/Sao_Paulo",
    }
  );
}
