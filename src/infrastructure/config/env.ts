import "dotenv/config";

export const env = {
  port: Number(process.env.PORT ?? 7031),

  jwt: {
    secret: process.env.JWT_SECRET ?? "dev-secret",
    issuer: process.env.JWT_ISSUER ?? "InfluMetrics",
    audience: process.env.JWT_AUDIENCE ?? "InfluMetrics",
    accessMinutes: Number(process.env.JWT_ACCESS_TOKEN_MINUTES ?? 30),
    refreshDays: Number(process.env.JWT_REFRESH_TOKEN_DAYS ?? 7)
  }
};
