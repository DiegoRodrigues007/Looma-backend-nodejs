import { Request } from "express";

export function s(v: unknown): string {
  return String(v ?? "").trim();
}

export function safeDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  const d = new Date(String(v));
  return Number.isFinite(d.getTime()) ? d : null;
}

type AuthUserLike = {
  userId?: unknown;
  id?: unknown;
  sub?: unknown;
};

export function getAuthenticatedUserId(req: Request): string | null {
  const anyReq = req as Request & { user?: AuthUserLike; userId?: unknown };

  const v =
    anyReq?.user?.userId ||
    anyReq?.user?.id ||
    anyReq?.user?.sub ||
    anyReq?.userId ||
    req.header("x-user-id") ||
    null;

  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number") return String(v);
  return null;
}
