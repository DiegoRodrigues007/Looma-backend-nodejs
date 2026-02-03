// src/presentation/http/controllers/InstagramRefreshController.ts
import type { Request, Response } from "express";
import { RefreshInstagramTokenUseCase } from "../../../../application/use-cases/instagram/RefreshInstagramTokenUseCase";

function s(v: unknown): string {
  return String(v ?? "").trim();
}

type AuthUserLike = { userId?: unknown; id?: unknown; sub?: unknown };

function getAuthenticatedUserId(req: Request): string | null {
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

function parseBool(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  const ss = String(value).toLowerCase();
  if (ss === "true" || ss === "1") return true;
  if (ss === "false" || ss === "0") return false;
  return undefined;
}

function parseIntSafe(v: unknown, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

export class InstagramRefreshController {
  constructor(private readonly refreshToken: RefreshInstagramTokenUseCase) {}

  async refresh(req: Request, res: Response) {
    res.setHeader("Cache-Control", "no-store");

    const userId = getAuthenticatedUserId(req);
    if (!userId) {
      return res.status(401).json({
        ok: false,
        code: "UNAUTHENTICATED",
        message: "Não autenticado",
      });
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const queryAny = (req.query ?? {}) as any;

    const instagramAccountIdFromBody = s(body.instagramAccountId);
    const instagramAccountIdFromQuery = s(queryAny.instagramAccountId);

    const instagramAccountId =
      instagramAccountIdFromBody || instagramAccountIdFromQuery || undefined;

    const force =
      parseBool(body.force) ?? parseBool(queryAny.force) ?? false;

    const refreshIfExpiresBeforeMinutes = parseIntSafe(
      body.refreshIfExpiresBeforeMinutes ?? queryAny.refreshIfExpiresBeforeMinutes,
      60
    );

    const out = await this.refreshToken.execute({
      userId,
      instagramAccountId,
      force,
      refreshIfExpiresBeforeMinutes,
    });

    // ✅ garante status correto e evita cair em 501 por "not implemented"
    if (!out || typeof (out as any).ok !== "boolean") {
      return res.status(500).json({
        ok: false,
        code: "INTERNAL_ERROR",
        message: "Resposta inválida do RefreshInstagramTokenUseCase",
      });
    }

    if (!out.ok) {
      const code = (out as any).code;

      // Mapeamento de HTTP bem previsível pros testes:
      // - auth -> 401
      // - scopes/permissões/reauth -> 403
      // - não encontrado -> 404
      // - não conectado/estado inválido -> 409
      // - resto -> 400
      const http =
        code === "UNAUTHENTICATED"
          ? 401
          : code === "MISSING_SCOPES" || code === "REAUTH_REQUIRED"
            ? 403
            : code === "NOT_FOUND"
              ? 404
              : code === "NOT_CONNECTED"
                ? 409
                : 400;

      return res.status(http).json(out);
    }

    return res.status(200).json(out);
  }
}