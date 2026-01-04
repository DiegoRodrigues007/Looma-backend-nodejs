import express from "express";
import cookieParser from "cookie-parser";

import { corsMiddleware } from "../../infrastructure/config/cors";
import { setupSwagger } from "./docs/swagger";

import { authRouter } from "./routes/auth.routes";
import { instagramRouter } from "./routes/instagram.routes";
import { youtubeRouter } from "./routes/youtube.routes";

export const app = express();

// ==========================
// Middlewares
// ==========================
app.use(corsMiddleware);

// Preflight OPTIONS
app.use((req, res, next) => {
  if (req.method === "OPTIONS") {
    corsMiddleware(req, res, () => res.sendStatus(204));
    return;
  }
  next();
});

app.use(express.json());
app.use(cookieParser());

// ==========================
// Health / Root
// ==========================
app.get("/", (_req, res) => {
  res.redirect("/swagger");
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// ==========================
// Routes
// ==========================
app.use("/api/auth", authRouter);
app.use("/api/instagram", instagramRouter);
app.use("/api/youtube", youtubeRouter);

// ==========================
// Swagger (depois das rotas)
// ==========================
setupSwagger(app);

// ==========================
// 404
// ==========================
app.use((req, res) => {
  res.status(404).json({
    message: "Rota não encontrada",
    path: req.originalUrl,
  });
});
