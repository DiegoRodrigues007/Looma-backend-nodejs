// src/application/use-cases/instagram/RefreshInstagramTokenUseCase.ts

import type { PrismaClient } from "@prisma/client";
import { IInstagramIgLoginAuthService } from "../../ports/instagram/IInstagramIgLoginAuthService";

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

function asNumber(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export type RefreshInstagramTokenInput = {
  /**
   * ✅ Obrigatório (segurança): garante que você só refresca token da conta do usuário autenticado
   */
  userId: string;

  /**
   * Se não vier, usa activeInstagramAccountId
   */
  instagramAccountId?: string;

  force?: boolean; // força refresh mesmo longe do vencimento
  refreshIfExpiresBeforeMinutes?: number; // default 60

  /**
   * ✅ Compat (ignorado por este use-case, mas evita TS2353 quando algum caller ainda envia isso)
   * OBS: o use-case SEMPRE lê do banco para evitar manipulação indevida.
   */
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

type RefreshProviderOutput =
  | string
  | {
      accessToken?: string | null;
      access_token?: string | null;
      expiresAt?: Date | string | null;
      expiresIn?: number | string | null;
      expires_in?: number | string | null;
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

    // ⚠️ importante: bind pra não perder "this" se o método usar contexto interno
    if (typeof authAny.refreshLongToken === "function") {
      return authAny.refreshLongToken.bind(this.auth);
    }
    if (typeof authAny.refreshLong === "function") {
      return authAny.refreshLong.bind(this.auth);
    }
    return null;
  }

  private normalizeRefreshOutput(out: RefreshProviderOutput): {
    accessToken: string;
    expiresAt: Date | null;
  } {
    // suporte a retorno "string"
    if (typeof out === "string") {
      const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000); // ~60 dias
      return { accessToken: out, expiresAt };
    }

    // suporta accessToken e access_token
    const accessToken = s(out?.accessToken ?? out?.access_token);
    if (!accessToken) {
      throw new Error("Refresh do token retornou vazio. Refaça o login.");
    }

    // 1) expiresAt direto
    const expRaw = out?.expiresAt ?? null;
    const expDate = safeDate(expRaw);
    if (expDate) return { accessToken, expiresAt: expDate };

    // 2) expiresIn / expires_in (segundos)
    const expIn =
      asNumber(out?.expiresIn) ??
      asNumber(out?.expires_in) ??
      null;

    if (expIn != null && expIn > 0) {
      return { accessToken, expiresAt: new Date(Date.now() + expIn * 1000) };
    }

    // 3) fallback seguro
    return {
      accessToken,
      expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
    };
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
    return this.normalizeRefreshOutput(out);
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

    // ✅ não usa $transaction aqui pra evitar virar array e bagunçar tipagem
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

      // ✅ só sobrescreve pageAccessToken se estiver vazio/flag inválida (testes/legado)
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
          // se existir no schema, ótimo; se não existir, o "as any" evita travar TS
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