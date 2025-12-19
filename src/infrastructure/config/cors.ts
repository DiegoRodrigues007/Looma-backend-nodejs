import cors, { type CorsOptions } from "cors";

function normalizeOrigin(value: string) {
  return value.trim().replace(/\/$/, "");
}

const envOrigins = String(process.env.FRONTEND_URL ?? "")
  .split(",")
  .map(normalizeOrigin)
  .filter(Boolean);

const allowedOrigins = new Set<string>([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  ...envOrigins,
]);

const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);

    const normalized = normalizeOrigin(origin);

    if (allowedOrigins.has(normalized)) return callback(null, true);

    return callback(new Error(`CORS bloqueado para origin: ${origin}`));
  },

  credentials: true,

  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "Cache-Control", "Pragma"],

  exposedHeaders: ["Set-Cookie"],

  preflightContinue: false,
  optionsSuccessStatus: 204,
};

export const corsMiddleware = cors(corsOptions);
