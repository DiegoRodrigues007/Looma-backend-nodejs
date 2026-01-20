import "dotenv/config";
import { runInstagramDailySnapshotsJob } from "../infrastructure/jobs/instagramDailySnapshotsJob";

async function main() {
  const ymd = process.argv[2]; // opcional: "2026-01-19"
  const limitArg = process.argv[3]; // opcional: "50"
  const limit = limitArg ? Number(limitArg) : undefined;

  const res = await runInstagramDailySnapshotsJob({ ymd, limit });
  console.log(JSON.stringify(res, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
