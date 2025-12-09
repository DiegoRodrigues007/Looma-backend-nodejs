import express from "express";
import { corsMiddleware } from "../../infrastructure/config/cors";
import { setupSwagger } from "./docs/swagger";
import { authRouter } from "./routes/auth.routes";
import { instagramRouter } from "./routes/instagram.routes";

export const app = express();

app.use(express.json());
app.use(corsMiddleware);

app.get("/", (_req, res) => {
  res.redirect("/swagger");
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

setupSwagger(app);

app.use("/api/auth", authRouter);

app.use("/api/instagram", instagramRouter);
