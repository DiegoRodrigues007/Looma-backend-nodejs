import "dotenv/config";
import { prisma } from "../infrastructure/db/prismaClient";

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, days: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

async function main() {
  // usa o userId que já existe nos seus snapshots
  const existing = await prisma.metricsSnapshot.findFirst({
    where: { platform: "instagram" },
    orderBy: { date: "desc" },
  });

  if (!existing) {
    console.log("❌ Nenhum snapshot existente. Crie 1 primeiro.");
    process.exit(1);
  }

  const userId = existing.userId;
  const platform = "instagram";
  const today = startOfDay(new Date());

  // gera 14 dias (pra permitir period=7 comparar 7x7)
  for (let i = 13; i >= 0; i--) {
    const date = addDays(today, -i);

    const followers = 100 + (13 - i) * 2;
    const reach = 7000 + (13 - i) * 150;
    const totalInteractions = 200 + (13 - i) * 5;
    const engagementRate = totalInteractions / Math.max(reach, 1);

    await prisma.metricsSnapshot.upsert({
      where: { userId_platform_date: { userId, platform, date } },
      update: { followers, reach, totalInteractions, engagementRate },
      create: { userId, platform, date, followers, reach, totalInteractions, engagementRate },
    });
  }

  console.log("✅ 14 snapshots gerados para userId:", userId);
}

main()
  .catch(console.error)
  .finally(async () => prisma.$disconnect());
