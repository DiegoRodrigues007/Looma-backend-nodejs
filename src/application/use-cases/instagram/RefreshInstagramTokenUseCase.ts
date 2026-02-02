import { IUserRepository } from "../../interfaces/db/IUserRepository";
import { IInstagramAccountRepository } from "../../interfaces/db/IInstagramAccountRepository";
import { IInstagramIgLoginAuthService } from "../../interfaces/instagram/IInstagramIgLoginAuthService";
import {
  normalizeInstagramToken,
  type RefreshProviderOutput,
} from "../../interfaces/instagram/InstagramTokenNormalizer";

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
    private readonly userRepo: IUserRepository,
    private readonly instagramAccountRepo: IInstagramAccountRepository,
    private readonly auth: IInstagramIgLoginAuthService
  ) {}

  private pickRefreshFn():
    | ((t: string) => Promise<RefreshProviderOutput>)
    | null {
    const authAny = this.auth as unknown as {
      refreshLongToken?: (t: string) => Promise<RefreshProviderOutput>;
      refreshLong?: (t: string) => Promise<RefreshProviderOutput>;
      refreshLongLivedToken?: (t: string) => Promise<RefreshProviderOutput>;
    };

    if (typeof authAny.refreshLongToken === "function") {
      return authAny.refreshLongToken.bind(this.auth);
    }
    if (typeof authAny.refreshLongLivedToken === "function") {
      return authAny.refreshLongLivedToken.bind(this.auth);
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
        "Auth service não implementa refreshLongToken/refreshLong/refreshLongLivedToken."
      );
    }

    const out = await fn(longToken);
    return normalizeInstagramToken(out, { fallbackDays: 60 });
  }

  private normalizeRefreshWindow(v: unknown): number {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return 60;
    return n;
  }

  async execute(input: RefreshInstagramTokenInput): Promise<RefreshInstagramTokenOutput> {
    const userId = s(input.userId);
    if (!userId) {
      return { ok: false, code: "UNAUTHENTICATED", message: "Não autenticado" };
    }

    const force = !!input.force;
    const refreshWindowMin = this.normalizeRefreshWindow(
      input.refreshIfExpiresBeforeMinutes ?? 60
    );

    // ✅ resolve instagramAccountId: body > active
    const activeId = await this.userRepo.getActiveInstagramAccountId(userId);
    const instagramAccountId = s(input.instagramAccountId) || s(activeId);

    if (!instagramAccountId) {
      return {
        ok: false,
        code: "NOT_FOUND",
        message: "Nenhuma conta ativa encontrada",
      };
    }

    // ✅ precisa buscar a conta MESMO que esteja desconectada (pra retornar NOT_CONNECTED)
    const acc = await this.instagramAccountRepo.findById(userId, instagramAccountId);

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

    const longToken = s(acc.accessToken) || s(input.currentAccessToken);
    if (!longToken) {
      return {
        ok: false,
        code: "NOT_CONNECTED",
        message:
          "Conta conectada sem accessToken salvo (long token). Refaça o login do Instagram.",
        needsReauth: true,
      };
    }

    const expiresAt = safeDate(acc.tokenExpiresAt) ?? safeDate(input.currentExpiresAt);

    const shouldRefresh = force || !expiresAt || expiresAt <= minutesFromNow(refreshWindowMin);

    if (!shouldRefresh) {
      return {
        ok: true,
        refreshed: false,
        instagramAccountId: acc.id,
        igUserId: s(acc.igUserId),
        expiresAt,
        reason: "not_needed",
      };
    }

    try {
      const refreshed = await this.refreshToken(longToken);

      // mesma lógica antiga: só sobrescreve page token se ele estiver vazio/invalidado
      const currentPage = s(acc.pageAccessToken);
      const shouldUpdatePageAccessToken =
        !currentPage ||
        currentPage.toUpperCase() === "EXPIRED_TOKEN" ||
        currentPage.toUpperCase() === "INVALID_TOKEN";

      await this.instagramAccountRepo.updateToken({
        instagramAccountId: acc.id,
        userId,
        accessToken: refreshed.accessToken,
        tokenExpiresAt: refreshed.expiresAt,
        pageAccessToken: shouldUpdatePageAccessToken ? refreshed.accessToken : (acc.pageAccessToken ?? null),
        lastRefreshedAt: new Date(),
      });

      return {
        ok: true,
        refreshed: true,
        instagramAccountId: acc.id,
        igUserId: s(acc.igUserId),
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
