// src/presentation/http/server.ts

// ✅ precisa ser a PRIMEIRA coisa do processo
import "dotenv/config";

import { env } from "../../infrastructure/config/env";
import { app } from "./app";

app.listen(env.port, () => {
  console.log(`API running at http://localhost:${env.port}`);
  console.log(`FRONTEND_URL runtime = ${process.env.FRONTEND_URL}`);
});
