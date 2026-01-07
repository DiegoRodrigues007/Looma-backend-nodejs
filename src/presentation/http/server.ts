import "dotenv/config";

import { env } from "../../infrastructure/config/env";
import { app } from "./app";
import { startDailyMetricsSnapshotJob } from "../../application/jobs/DailyMetricsSnapshotJob";

app.listen(env.port, () => {
  console.log(`🚀 API running at http://localhost:${env.port}`);
  console.log(`🌐 FRONTEND_URL runtime = ${process.env.FRONTEND_URL}`);
  startDailyMetricsSnapshotJob();
});
