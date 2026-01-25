// src/presentation/http/app.ts
import express, { NextFunction, Request, Response } from "express";
import cookieParser from "cookie-parser";
import axios from "axios";

import { corsMiddleware } from "../../infrastructure/config/cors";
import { setupSwagger } from "./docs/swagger";

import { authRouter } from "./routes/auth.routes";
import { instagramRouter } from "./routes/instagram.routes";
import { youtubeRouter } from "./routes/youtube.routes";
import metricsRoutes from "./routes/metrics.routes";

import instagramBackfillRoutes from "./routes/instagramBackfill.routes";
import instagramPostsRoutes from "./routes/instagramPosts.routes";

import { authMiddleware } from "./middlewares/authMiddleware";

export const app = express();

/* =========================
   Middlewares básicos
========================= */

app.use(corsMiddleware);

app.options(/.*/, (_req, res) => {
  return res.sendStatus(204);
});

app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

/* =========================
   Health / Root
========================= */

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

if (process.env.NODE_ENV !== "test") {
  app.get("/", (_req, res) => {
    res.redirect("/swagger");
  });
}

/* =========================
   Routes
========================= */

// Auth
app.use("/api/auth", authRouter);

// Instagram base (login, connect etc — pode ficar sem auth)
app.use("/api/instagram", instagramRouter);

// 🔒 Instagram Backfill (PRECISA DE AUTH)
app.use(
  "/api/instagram",
  authMiddleware,
  instagramBackfillRoutes
);

// 🔒 Instagram Posts (sync, list etc — PRECISA DE AUTH)
app.use(
  "/api/instagram",
  authMiddleware,
  instagramPostsRoutes
);

// YouTube
app.use("/api/youtube", youtubeRouter);

// Metrics
app.use("/api/metrics", authMiddleware, metricsRoutes);

/* =========================
   Swagger
========================= */

if (process.env.NODE_ENV !== "test") {
  setupSwagger(app);
}

/* =========================
   404 handler
========================= */

app.use((req, res) => {
  res.status(404).json({
    message: "Rota não encontrada",
    code: "NOT_FOUND",
    path: req.originalUrl,
  });
});

/* =========================
   Error handler
========================= */

app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  const status = Number(err?.statusCode || err?.status || 500);

  const isAxios = axios.isAxiosError(err);
  const axiosStatus = isAxios ? err.response?.status : undefined;
  const axiosData = isAxios ? err.response?.data : undefined;

  console.error("[API ERROR]", {
    status,
    method: req.method,
    path: req.originalUrl,
    message: err?.message,
    code: err?.code,
    axiosStatus,
  });

  return res.status(status).json({
    message: err?.publicMessage || err?.message || "Erro interno no servidor",
    code: err?.code || "INTERNAL_ERROR",
    path: req.originalUrl,
    details:
      err?.details ??
      (isAxios
        ? {
            providerStatus: axiosStatus,
            providerData: axiosData,
          }
        : undefined),
  });
});