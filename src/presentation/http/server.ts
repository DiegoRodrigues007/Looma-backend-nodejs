import { app } from "./app";
import { env } from "../../infrastructure/config/env";

app.listen(env.port, () => {
  console.log(`API running at http://localhost:${env.port}`);
});
