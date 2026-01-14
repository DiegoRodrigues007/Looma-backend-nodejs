import "dotenv/config";

import { env } from "../../infrastructure/config/env";
import { app } from "./app";
import { startDailyMetricsSnapshotJob } from "../../application/jobs/DailyMetricsSnapshotJob";

import { startInstagramBackfillWorker } from "../../application/jobs/InstagramBackfillWorker";

app.listen(env.port, () => {
  console.log(`🚀 API running at http://localhost:${env.port}`);
  console.log(`🌐 FRONTEND_URL runtime = ${process.env.FRONTEND_URL}`);

  startDailyMetricsSnapshotJob();

  startInstagramBackfillWorker({
    concurrency: 1,      
    pollMs: 1500,         
    maxPosts: 300,        
    maxPages: 20,
    perPostDelayMs: 120,  
    perPageDelayMs: 150,
  });

  console.log("🧵 Instagram Backfill Worker started");
});
