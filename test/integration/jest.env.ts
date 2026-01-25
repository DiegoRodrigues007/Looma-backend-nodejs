import path from "path";
import dotenv from "dotenv";

dotenv.config({
  path: path.resolve(process.cwd(), ".env.test"),
});

// Segurança: garante NODE_ENV test
process.env.NODE_ENV = "test";