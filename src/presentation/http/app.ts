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

import { instagramAnalyticsRouter } from "./routes/instagramAnalytics.routes";

import { authMiddleware } from "./middlewares/authMiddleware";

export const app = express();

app.use(corsMiddleware);

app.options(/.*/, (_req, res) => {
  return res.sendStatus(204);
});

app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

if (process.env.NODE_ENV !== "test") {
  app.get("/", (_req, res) => {
    res.redirect("/swagger");
  });
}

app.use("/api/auth", authRouter);

app.use("/api/instagram", instagramRouter);

app.use("/api/instagram", instagramAnalyticsRouter);

app.use("/api/instagram", authMiddleware, instagramBackfillRoutes);

app.use("/api/instagram", authMiddleware, instagramPostsRoutes);

app.use("/api/youtube", youtubeRouter);

app.use("/api/metrics", authMiddleware, metricsRoutes);

app.use("/auth", authRouter);

app.use("/instagram", instagramRouter);

app.use("/instagram", authMiddleware, instagramBackfillRoutes);

app.use("/instagram", authMiddleware, instagramPostsRoutes);

app.use("/youtube", youtubeRouter);

app.use("/metrics", authMiddleware, metricsRoutes);

if (process.env.NODE_ENV !== "test") {
  setupSwagger(app);
}

app.use((req, res) => {
  res.status(404).json({
    message: "Rota não encontrada",
    code: "NOT_FOUND",
    path: req.originalUrl,
  });
});

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
