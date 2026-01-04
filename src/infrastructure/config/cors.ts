import cors from "cors";

function normalizeOrigin(o: string) {
  return o.replace(/\/$/, "").trim();
}

const envOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map(normalizeOrigin);

const frontendUrl = process.env.FRONTEND_URL ? normalizeOrigin(process.env.FRONTEND_URL) : "";

// ✅ origins permitidos (inclui swagger/back)
const allowedOrigins = Array.from(
  new Set(
    [
      ...envOrigins,
      frontendUrl,
      "http://localhost:5173",
      "http://localhost:7031",
      "http://127.0.0.1:5173",
      "http://127.0.0.1:7031",
    ].filter(Boolean)
  )
);

export const corsMiddleware = cors({
  origin(origin, callback) {
    // ✅ sem origin (Postman/curl/server-to-server) -> permite
    if (!origin) return callback(null, true);

    const o = normalizeOrigin(origin);

    // ✅ se você deixou CORS_ORIGIN="*" no .env, libera tudo
    if (process.env.CORS_ORIGIN === "*") return callback(null, true);

    if (allowedOrigins.includes(o)) return callback(null, true);

    return callback(new Error(`CORS bloqueado para origin: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  exposedHeaders: ["Set-Cookie"],
});
