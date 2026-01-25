import cron from "node-cron";
import { prisma } from "../db/prismaClient";
import { PrismaMetricsSnapshotRepository } from "../db/repositories/PrismaMetricsSnapshotRepository";
import { MetricsHistoryService } from "../../application/services/metrics/MetricsHistoryService";
import { InstagramMetricsService } from "../instagram/services/InstagramMetricsService";


const TZ = "America/Sao_Paulo";

function dateOnlyUtcFromYmd(ymdStr: string): Date {
  return new Date(`${ymdStr.slice(0, 10)}T00:00:00.000Z`);
}

function ymdInTz(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function addDays(date: Date, delta: number) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + delta);
  return d;
}

function pickAccessToken(acc: {
  pageAccessToken: string | null;
  accessToken: string | null;
}) {
  const tok = acc.pageAccessToken ?? acc.accessToken ?? null;
  return tok && String(tok).trim() ? String(tok).trim() : null;
}

export function startDailyMetricsSnapshotJob() {
  cron.schedule(
    "5 0 * * *",
    async () => {
      const startedAt = Date.now();
      console.log("📊 [SNAPSHOT] Running daily Instagram metrics snapshot");

      const repo = new PrismaMetricsSnapshotRepository();
      const historyService = new MetricsHistoryService(repo);

      const now = new Date();
      const yesterday = addDays(now, -1);
      const ymdTarget = ymdInTz(yesterday, TZ);
      const targetDate = dateOnlyUtcFromYmd(ymdTarget);

      console.log("📅 [SNAPSHOT] targetDay", { ymd: ymdTarget });

      const accounts = await prisma.instagramAccount.findMany({
        where: { isConnected: true },
        select: {
          userId: true,
          igUserId: true,
          accessToken: true,
          pageAccessToken: true,
          id: true,
        },
      });

      let processed = 0;
      let saved = 0;
      let skipped = 0;
      let failed = 0;

      for (const account of accounts) {
        processed++;

        const igUserId = account.igUserId ? String(account.igUserId).trim() : null;
        const accessToken = pickAccessToken({
          pageAccessToken: account.pageAccessToken,
          accessToken: account.accessToken,
        });

        if (!igUserId || !accessToken) {
          skipped++;
          continue;
        }

        try {
          const metrics = await InstagramMetricsService.fetchDailyMetrics(
            igUserId,
            accessToken,
            // @ts-expect-error - caso sua assinatura ainda não tenha o 3º param
            { dayYmd: ymdTarget }
          );

          const didSave = await historyService.ensureDailySnapshot(
            account.userId,
            "instagram",
            metrics,
            targetDate
          );

          if (didSave) saved++;
          else skipped++;
        } catch (err) {
          failed++;
          console.error(
            `❌ [SNAPSHOT] failed userId=${account.userId} accountId=${account.id} igUserId=${igUserId}`,
            err
          );
        }
      }

      console.log(
        `✅ [SNAPSHOT] Done. target=${ymdTarget} processed=${processed} saved=${saved} skipped=${skipped} failed=${failed} elapsedMs=${Date.now() - startedAt}`
      );
    },
    { timezone: TZ }
  );
}
