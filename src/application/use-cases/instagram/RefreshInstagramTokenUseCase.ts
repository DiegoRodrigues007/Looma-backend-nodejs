import type { PrismaClient } from "@prisma/client";
import { IInstagramIgLoginAuthService } from "../../ports/instagram/IInstagramIgLoginAuthService";
import {
  normalizeInstagramToken,
  type RefreshProviderOutput,
} from "../../instagram/InstagramTokenNormalizer";

function s(v: unknown): string {
  return String(v ?? "").trim();
}

function minutesFromNow(min: number) {
  return new Date(Date.now() + min * 60 * 1000);
}

function safeDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  const d = new Date(String(v));
  return Number.isFinite(d.getTime()) ? d : null;
}

export type RefreshInstagramTokenInput = {
  userId: string;
  instagramAccountId?: string;
  force?: boolean;
  refreshIfExpiresBeforeMinutes?: number; 
  currentAccessToken?: string | null;
  currentExpiresAt?: Date | null;
};

export type RefreshInstagramTokenOutput =
  | {
      ok: true;
      refreshed: boolean;
      instagramAccountId: string;
      igUserId: string;
      expiresAt: Date | null;
      reason: "forced" | "near_expiry" | "not_needed";
    }
  | {
      ok: false;
      code: "UNAUTHENTICATED" | "NOT_FOUND" | "NOT_CONNECTED" | "INVALID_INPUT";
      message: string;
      needsReauth?: boolean;
    };

export class RefreshInstagramTokenUseCase {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auth: IInstagramIgLoginAuthService
  ) {}

  private pickRefreshFn():
    | ((t: string) => Promise<RefreshProviderOutput>)
    | null {
    const authAny = this.auth as unknown as {
      refreshLongToken?: (t: string) => Promise<RefreshProviderOutput>;
      refreshLong?: (t: string) => Promise<RefreshProviderOutput>;
    };

    if (typeof authAny.refreshLongToken === "function") {
      return authAny.refreshLongToken.bind(this.auth);
    }
    if (typeof authAny.refreshLong === "function") {
      return authAny.refreshLong.bind(this.auth);
    }
    return null;
  }

  private async refreshToken(longToken: string): Promise<{
    accessToken: string;
    expiresAt: Date | null;
  }> {
    const fn = this.pickRefreshFn();
    if (!fn) {
      throw new Error(
        "Auth service não implementa refreshLongToken/refreshLong. Ajuste a implementação do IInstagramIgLoginAuthService."
      );
    }

    const out = await fn(longToken);

    return normalizeInstagramToken(out, { fallbackDays: 60 });
  }

  async execute(input: RefreshInstagramTokenInput): Promise<RefreshInstagramTokenOutput> {
    const userId = s(input.userId);
    if (!userId) {
      return { ok: false, code: "UNAUTHENTICATED", message: "Não autenticado" };
    }

    const force = !!input.force;

    const refreshWindowMinRaw = Number(input.refreshIfExpiresBeforeMinutes ?? 60);
    const refreshWindowMin =
      Number.isFinite(refreshWindowMinRaw) && refreshWindowMinRaw >= 0
        ? refreshWindowMinRaw
        : 60;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { activeInstagramAccountId: true },
    });

    const instagramAccountId =
      s(input.instagramAccountId) || s(user?.activeInstagramAccountId);

    if (!instagramAccountId) {
      return {
        ok: false,
        code: "NOT_FOUND",
        message: "Nenhuma conta ativa encontrada",
      };
    }

    const acc = await this.prisma.instagramAccount.findFirst({
      where: { id: instagramAccountId, userId },
      select: {
        id: true,
        igUserId: true,
        accessToken: true,
        expiresAt: true,
        isConnected: true,
        pageAccessToken: true,
      } as any,
    });

    if (!acc) {
      return {
        ok: false,
        code: "NOT_FOUND",
        message: "Conta do Instagram não encontrada",
      };
    }

    if (!acc.isConnected) {
      return {
        ok: false,
        code: "NOT_CONNECTED",
        message: "Conta não está conectada",
        needsReauth: true,
      };
    }

    const longToken = s((acc as any).accessToken);
    if (!longToken) {
      return {
        ok: false,
        code: "NOT_CONNECTED",
        message:
          "Conta conectada sem accessToken salvo (long token). Refaça o login do Instagram.",
        needsReauth: true,
      };
    }

    const expiresAt = safeDate((acc as any).expiresAt);

    const shouldRefresh =
      force ||
      !expiresAt ||
      expiresAt <= minutesFromNow(refreshWindowMin);

    if (!shouldRefresh) {
      return {
        ok: true,
        refreshed: false,
        instagramAccountId: String((acc as any).id),
        igUserId: String((acc as any).igUserId),
        expiresAt,
        reason: "not_needed",
      };
    }

    try {
      const refreshed = await this.refreshToken(longToken);

      const currentPage = s((acc as any).pageAccessToken);
      const shouldUpdatePageAccessToken =
        !currentPage ||
        currentPage.toUpperCase() === "EXPIRED_TOKEN" ||
        currentPage.toUpperCase() === "INVALID_TOKEN";

      await this.prisma.instagramAccount.update({
        where: { id: String((acc as any).id) },
        data: {
          accessToken: refreshed.accessToken,
          pageAccessToken: shouldUpdatePageAccessToken
            ? refreshed.accessToken
            : (acc as any).pageAccessToken,
          expiresAt: refreshed.expiresAt,
          lastRefreshedAt: new Date(),
        } as any,
      });

      return {
        ok: true,
        refreshed: true,
        instagramAccountId: String((acc as any).id),
        igUserId: String((acc as any).igUserId),
        expiresAt: refreshed.expiresAt,
        reason: force ? "forced" : "near_expiry",
      };
    } catch (e: any) {
      const msg = s(e?.message ?? e);

      return {
        ok: false,
        code: "NOT_CONNECTED",
        message: msg || "Falha ao atualizar token do Instagram. Refaça o login.",
        needsReauth: true,
      };
    }
  }
}