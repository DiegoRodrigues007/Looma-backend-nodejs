const { execSync } = require("child_process");
const path = require("path");

require("dotenv").config({
  path: path.resolve(process.cwd(), ".env.test"),
});

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL não encontrado no .env.test");
  process.exit(1);
}

console.log("[test] Running prisma migrate deploy with .env.test DATABASE_URL...");
execSync("npx prisma migrate deploy", { stdio: "inherit" });