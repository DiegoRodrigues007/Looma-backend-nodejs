// src/application/use-cases/instagram/CompleteIgLoginUseCase.ts
import { randomBytes, createHash } from "crypto";
import {
  IInstagramIgLoginAuthService,
  InstagramAuthReauthRequired,
  InstagramAuthResolved,
} from "../../ports/instagram/IInstagramIgLoginAuthService";
import { IInstagramTokenStore } from "../../instagram/IInstagramTokenStore";

/* =========================
   DTOs
========================= */

export type InstagramCandidateDTO = {
  igUserId: string;
  username: string;
  accountType: string;
  facebookPageId: string;
  facebookPageName?: string;
  source: "instagram_business_account" | "connected_instagram_account";
};

export type InstagramCandidateForDb = InstagramCandidateDTO & {
  pageAccessToken: string;
};

export interface InstagramLoginResult {
  igUserId: string;
  username: string;
  accountType: string;

  /** ✅ token do usuário IG (long token) */
  accessToken: string;
  expiresAt?: Date | null;

  facebookPageId?: string | null;
  /** ✅ token da página FB usada para endpoints IG */
  pageAccessToken?: string | null;
}

export type InstagramLoginReauthRequired = {
  status: "reauth_required";
  loginUrl: string;
  missingPermissions: string[];
};

export type InstagramLoginChooseRequired = {
  status: "choose_required";
  selectionId: string;
  candidates: InstagramCandidateDTO[];
};

export type InstagramLoginOk = {
  status: "ok";
};

export type InstagramConfirmSelectionInput = Array<{
  igUserId: string;
  facebookPageId: string;
}>;

type PendingSelection = {
  userId: string;
  longToken: string;
  expiresAt?: Date | null;
  createdAt: number;

  candidates: Array<InstagramCandidateForDb>;
};

/* =========================
   Helpers
========================= */

function s(v: any): string {
  return String(v ?? "").trim();
}

function isValidSource(v: any): v is InstagramCandidateDTO["source"] {
  return (
    v === "instagram_business_account" || v === "connected_instagram_account"
  );
}

function normalizeCandidateDTO(c: any): InstagramCandidateDTO {
  const sourceRaw = c?.source;

  return {
    igUserId: s(c?.igUserId),
    username: s(c?.username),
    accountType: s(c?.accountType),
    facebookPageId: s(c?.facebookPageId),
    facebookPageName: c?.facebookPageName ? s(c.facebookPageName) : undefined,
    source: isValidSource(sourceRaw)
      ? sourceRaw
      : "instagram_business_account", // fallback seguro
  };
}

/**
 * ✅ aceita várias chaves possíveis do Graph:
 * - pageAccessToken (camel)
 * - page_access_token (snake)
 * - access_token (quando o objeto é de page)
 */
function normalizeCandidateForDb(c: any): InstagramCandidateForDb {
  const sourceRaw = c?.source;

  const pageAccessToken = s(c?.pageAccessToken) || s(c?.page_access_token) || s(c?.access_token);

  const out: InstagramCandidateForDb = {
    igUserId: s(c?.igUserId),
    username: s(c?.username),
    accountType: s(c?.accountType),
    facebookPageId: s(c?.facebookPageId),
    facebookPageName: c?.facebookPageName ? s(c.facebookPageName) : undefined,
    source: isValidSource(sourceRaw)
      ? sourceRaw
      : "instagram_business_account",
    pageAccessToken, // ✅ obrigatório no DB
  };

  // ✅ Segurança pro fluxo real: já falha cedo se não veio token de página
  if (!out.pageAccessToken) {
    throw new Error(
      `pageAccessToken vazio no candidate (igUserId=${out.igUserId} pageId=${out.facebookPageId}). ` +
        "Sem token da página não é possível usar endpoints do Instagram Graph. " +
        "Isso normalmente indica falta de permissão de páginas, seleção de páginas no consentimento, ou a API não retornou access_token."
    );
  }

  return out;
}

function keyOf(igUserId: string, facebookPageId: string) {
  return `${s(igUserId)}|${s(facebookPageId)}`;
}

/* =========================
   UseCase
========================= */

export class CompleteIgLoginUseCase {
  constructor(
    private readonly auth: IInstagramIgLoginAuthService,
    private readonly tokenStore: IInstagramTokenStore
  ) {}

  private static readonly pending = new Map<string, PendingSelection>();
  private static readonly ttlMs = Number(
    process.env.IG_LOGIN_CHOOSE_TTL_MS ?? 10 * 60 * 1000
  );

  /**
   * ✅ quando só existe 1 candidate, podemos persistir direto no callback
   * (isso destrava teu teste "callback deve salvar conta" e melhora UX).
   * Default: true
   */
  private static readonly autoConfirmSingle =
    String(process.env.IG_LOGIN_AUTO_CONFIRM_SINGLE ?? "true").toLowerCase() !==
    "false";

  private static cleanupExpired() {
    const now = Date.now();
    for (const [key, val] of this.pending.entries()) {
      if (now - val.createdAt > this.ttlMs) this.pending.delete(key);
    }
  }

  private static createSelectionId(userId: string) {
    const nonce = randomBytes(18).toString("hex");
    const hash = createHash("sha256")
      .update(`${userId}|${Date.now()}|${nonce}`)
      .digest("hex")
      .slice(0, 32);
    return `igsel_${hash}`;
  }

  private static assertPendingOrThrow(selectionId: string, userId: string) {
    this.cleanupExpired();

    const pending = this.pending.get(selectionId);
    if (!pending) {
      throw new Error("Seleção expirada ou inválida. Refaça o login do Instagram.");
    }
    if (pending.userId !== userId) {
      throw new Error("Seleção não pertence a este usuário.");
    }

    const isExpired = Date.now() - pending.createdAt > this.ttlMs;
    if (isExpired) {
      this.pending.delete(selectionId);
      throw new Error("Seleção expirada. Refaça o login do Instagram.");
    }

    return pending;
  }

  private async persistSelections(params: {
    userId: string;
    pending: PendingSelection;
    selections: InstagramConfirmSelectionInput;
  }): Promise<InstagramLoginResult[]> {
    const userId = s(params.userId);
    const pending = params.pending;
    const selections = params.selections;

    const byKey = new Map<string, PendingSelection["candidates"][number]>();
    for (const c of pending.candidates) {
      byKey.set(keyOf(c.igUserId, c.facebookPageId), c);
    }

    const uniq = new Map<string, { igUserId: string; facebookPageId: string }>();
    for (const s0 of selections) {
      const igUserId = s((s0 as any)?.igUserId);
      const facebookPageId = s((s0 as any)?.facebookPageId);
      if (!igUserId || !facebookPageId) continue;
      uniq.set(keyOf(igUserId, facebookPageId), { igUserId, facebookPageId });
    }

    if (uniq.size === 0) {
      throw new Error("Seleções inválidas. Selecione ao menos uma conta.");
    }

    const results: InstagramLoginResult[] = [];

    for (const { igUserId, facebookPageId } of uniq.values()) {
      const c = byKey.get(keyOf(igUserId, facebookPageId));
      if (!c) {
        throw new Error(
          `Seleção não encontrada entre os candidates: igUserId=${igUserId} pageId=${facebookPageId}`
        );
      }

      const username = s(c.username);
      const accountType = s(c.accountType);
      const pageAccessToken = s(c.pageAccessToken);

      if (!username) throw new Error(`username vazio para igUserId=${igUserId}`);
      if (!accountType) throw new Error(`accountType vazio para igUserId=${igUserId}`);
      if (!pageAccessToken) {
        throw new Error(
          `pageAccessToken vazio para igUserId=${igUserId}. ` +
            "Isso normalmente indica que o token da página não foi retornado pelo Graph API."
        );
      }

      await this.tokenStore.saveOrUpdate({
        userId,
        igUserId,
        username,
        accountType,
        accessToken: pending.longToken, // ✅ long token do usuário
        pageAccessToken,                // ✅ token da página
        facebookPageId,
        expiresAt: pending.expiresAt ?? null,
        lastRefreshedAt: new Date(),
        isConnected: true,
      });

      results.push({
        igUserId,
        username,
        accountType,
        accessToken: pending.longToken,
        expiresAt: pending.expiresAt ?? null,
        facebookPageId,
        pageAccessToken,
      });
    }

    return results;
  }

  async execute(
    code: string,
    state: string,
    userId: string
  ): Promise<InstagramLoginChooseRequired | InstagramLoginReauthRequired | InstagramLoginOk> {
    if (!code || s(code).length === 0) throw new Error("code é obrigatório");
    if (!userId || s(userId).length === 0) throw new Error("userId é obrigatório");

    // state pode ser validado no controller (cookie/assinatura). Aqui só evita lint:
    void state;

    CompleteIgLoginUseCase.cleanupExpired();

    const { shortToken } = await this.auth.exchangeCodeForShortToken(code);
    const { longToken, expiresAt } = await this.auth.exchangeShortForLong(shortToken);

    // ✅ Não depender do nome exato do tipo exportado do port (evita quebra por rename)
    const resolved = (await this.auth.resolveMeOrReauth(longToken)) as
      | InstagramAuthResolved
      | InstagramAuthReauthRequired
      | {
          status: "reauth_required";
          loginUrl: string;
          missingPermissions: string[];
        }
      | {
          status: "ok";
          candidates: any[];
        };

    if ((resolved as any).status === "reauth_required") {
      return {
        status: "reauth_required",
        loginUrl: (resolved as any).loginUrl,
        missingPermissions: (resolved as any).missingPermissions ?? [],
      };
    }

    const candidatesRaw = ((resolved as any).candidates ?? []) as any[];
    if (!candidatesRaw.length) {
      throw new Error(
        "Nenhuma conta do Instagram foi encontrada para este login. " +
          "Verifique se o Instagram é Professional (Business/Creator) e está vinculado a uma Página do Facebook " +
          "que o usuário autenticado consegue acessar."
      );
    }

    // ✅ pendência com token (pra persistir/confirmar depois)
    const pending: PendingSelection = {
      userId: s(userId),
      longToken: s(longToken),
      expiresAt: expiresAt ?? null,
      createdAt: Date.now(),
      candidates: candidatesRaw.map(normalizeCandidateForDb),
    };

    // ✅ UX + TEST: se só tem 1 candidate, persiste direto e retorna OK
    if (CompleteIgLoginUseCase.autoConfirmSingle && pending.candidates.length === 1) {
      const only = pending.candidates[0];

      await this.persistSelections({
        userId: pending.userId,
        pending,
        selections: [{ igUserId: only.igUserId, facebookPageId: only.facebookPageId }],
      });

      return { status: "ok" };
    }

    // ✅ lista “pública” (sem token)
    const candidatesPublic: InstagramCandidateDTO[] = candidatesRaw.map(
      normalizeCandidateDTO
    );

    const selectionId = CompleteIgLoginUseCase.createSelectionId(s(userId));
    CompleteIgLoginUseCase.pending.set(selectionId, pending);

    return {
      status: "choose_required",
      selectionId,
      candidates: candidatesPublic,
    };
  }

  /**
   * ✅ COMPAT: o seu controller estava chamando esse nome.
   * Retorna o pending inteiro (inclui longToken/expiresAt e candidates com pageAccessToken).
   */
  getPendingForPersist(params: { selectionId: string; userId: string }): PendingSelection {
    const selectionId = s(params.selectionId);
    const userId = s(params.userId);
    if (!selectionId) throw new Error("selectionId é obrigatório");
    if (!userId) throw new Error("userId é obrigatório");

    return CompleteIgLoginUseCase.assertPendingOrThrow(selectionId, userId);
  }

  /** ✅ candidates para persistir no banco (COM pageAccessToken) */
  getCandidatesForDb(params: { selectionId: string; userId: string }): InstagramCandidateForDb[] {
    const pending = this.getPendingForPersist(params);
    return pending.candidates;
  }

  getCandidates(params: { selectionId: string; userId: string }): InstagramCandidateDTO[] {
    const pending = this.getPendingForPersist(params);

    return pending.candidates.map((c) => ({
      igUserId: c.igUserId,
      username: c.username,
      accountType: c.accountType,
      facebookPageId: c.facebookPageId,
      facebookPageName: c.facebookPageName,
      source: c.source,
    }));
  }

  async confirmSelection(params: {
    selectionId: string;
    userId: string;
    selections: InstagramConfirmSelectionInput;
  }): Promise<InstagramLoginResult[]> {
    const selectionId = s(params.selectionId);
    const userId = s(params.userId);
    const selections = params.selections;

    if (!selectionId) throw new Error("selectionId é obrigatório");
    if (!userId) throw new Error("userId é obrigatório");
    if (!Array.isArray(selections) || selections.length === 0) {
      throw new Error("Selecione ao menos uma conta para conectar");
    }

    // ✅ garante que TTL é aplicado mesmo se alguém ficar chamando confirm depois de muito tempo
    CompleteIgLoginUseCase.cleanupExpired();

    const pending = CompleteIgLoginUseCase.assertPendingOrThrow(selectionId, userId);

    const results = await this.persistSelections({
      userId,
      pending,
      selections,
    });

    CompleteIgLoginUseCase.pending.delete(selectionId);
    return results;
  }
}