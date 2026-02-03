import { Request, Response } from "express";

export function safeJson(res: Response, status: number, body: unknown) {
  if (!res.headersSent) return res.status(status).json(body);
  return undefined;
}

export function safeRedirect(res: Response, status: number, url: string) {
  if (!res.headersSent) return res.redirect(status, url);
  return undefined;
}

export function wantsJson(req: Request): boolean {
  const accept = String(req.header("accept") ?? "").toLowerCase();
  const xrw = String(req.header("x-requested-with") ?? "").toLowerCase();
  const qs = String(
    (req.query as Record<string, unknown>)?.format ?? "",
  ).toLowerCase();

  if (qs === "json") return true;
  if (accept.includes("application/json")) return true;
  if (xrw === "xmlhttprequest") return true;
  return false;
}
