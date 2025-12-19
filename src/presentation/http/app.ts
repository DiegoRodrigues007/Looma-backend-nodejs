import express from "express";
import cookieParser from "cookie-parser";
import { corsMiddleware } from "../../infrastructure/config/cors";
import { setupSwagger } from "./docs/swagger";
import { authRouter } from "./routes/auth.routes";
import { instagramRouter } from "./routes/instagram.routes";

export const app = express();

// ✅ CORS primeiro
app.use(corsMiddleware);

// ✅ Preflight (OPTIONS) sem pattern "/*" ou "*" (evita path-to-regexp)
app.use((req, res, next) => {
  if (req.method === "OPTIONS") {
    // aplica CORS e encerra
    corsMiddleware(req, res, () => res.sendStatus(204));
    return;
  }
  next();
});

app.use(express.json());
app.use(cookieParser());

app.get("/", (_req, res) => {
  res.redirect("/swagger");
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

setupSwagger(app);

app.use("/api/auth", authRouter);
app.use("/api/instagram", instagramRouter);

// ✅ 404 fallback (sem "*")
app.use((req, res) => {
  res.status(404).json({ message: "Rota não encontrada", path: req.originalUrl });
});
