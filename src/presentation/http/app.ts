import express, { NextFunction, Request, Response } from "express";
import cookieParser from "cookie-parser";
import axios from "axios";

import { corsMiddleware } from "../../infrastructure/config/cors";
import { setupSwagger } from "./docs/swagger";

import { authRouter } from "./routes/auth.routes";
import { instagramRouter } from "./routes/instagram.routes";
import { youtubeRouter } from "./routes/youtube.routes";
import metricsRoutes from "./routes/metrics.routes";

// ✅ Rotas do backfill do Instagram (prefixo /api/instagram/backfill/*)
import instagramBackfillRoutes from "./routes/instagramBackfill.routes";

// ✅ IMPORTANTE: use o MESMO middleware que já protege rotas no seu projeto
import { authMiddleware } from "./middlewares/authMiddleware";

export const app = express();

app.use(corsMiddleware);

app.options(/.*/, (_req, res) => {
  return res.sendStatus(204);
});

app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

app.get("/", (_req, res) => {
  res.redirect("/swagger");
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// ==========================
// ✅ ROUTES
// ==========================
app.use("/api/auth", authRouter);

// ✅ Instagram (inclui: start/callback/status/disconnect/metrics/posts)
app.use("/api/instagram", instagramRouter);

// ✅ Instagram Backfill (ex: /api/instagram/backfill/start | /status)
app.use("/api/instagram", instagramBackfillRoutes);

app.use("/api/youtube", youtubeRouter);

// ✅ Metrics protegida globalmente
app.use("/api/metrics", authMiddleware, metricsRoutes);

// ==========================
// ✅ SWAGGER
// ==========================
setupSwagger(app);

// ==========================
// ✅ 404
// ==========================
app.use((req, res) => {
  res.status(404).json({
    message: "Rota não encontrada",
    code: "NOT_FOUND",
    path: req.originalUrl,
  });
});

// ==========================
// ✅ ERROR HANDLER
// ==========================
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
