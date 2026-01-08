import { randomBytes, createHash } from "crypto";

export function generateRefreshToken() {
  return randomBytes(48).toString("hex"); // 96 chars
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function refreshCookieOptions() {
  const isProd = process.env.NODE_ENV === "production";

  return {
    httpOnly: true,
    secure: isProd,        // true em produção (https)
    sameSite: "lax" as const,
    path: "/api/auth/refresh",
  };
}
