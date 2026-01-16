import { Request, Response } from "express";

export const IG_LOGIN_UID_COOKIE = "ig_login_uid";

export function setIgLoginCookie(res: Response, userId: string) {
  res.cookie(IG_LOGIN_UID_COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 10 * 60 * 1000,
    path: "/",
  });
}

export function getIgLoginCookie(req: Request): string | null {
  const anyReq = req as any;
  const v = anyReq?.cookies?.[IG_LOGIN_UID_COOKIE];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

export function clearIgLoginCookie(res: Response) {
  res.clearCookie(IG_LOGIN_UID_COOKIE, { path: "/" });
}
