import { randomBytes, createHash, timingSafeEqual } from "crypto";
import {
  IInstagramIgLoginAuthService,
  InstagramAuthReauthRequired,
  InstagramAuthResolved,
} from "../../../application/interfaces/instagram/IInstagramIgLoginAuthService";
import { IInstagramTokenStore } from "../../../application/interfaces/instagram/IInstagramTokenStore";

/**
 * ✅ Store de seleção pendente (porta)
 * - evita static Map (vazamento em testes / multi-instância)
 * - futuramente você pode trocar por Redis/DB sem mexer no use-case
 */
export interface IInstagramPendingSelectionStore {
  get(selectionId: string): PendingSelection | null;
  set(selectionId: string, value: PendingSelection): void;
  delete(selectionId: string): void;
  entries(): IterableIterator<[string, PendingSelection]>;
}

/**
 * ✅ Implementação default: in-memory por instância
 */
export class InMemoryInstagramPendingSelectionStore implements IInstagramPendingSelectionStore {
  private readonly map = new Map<string, PendingSelection>();

  get(selectionId: string): PendingSelection | null {
    return this.map.get(selectionId) ?? null;
  }
  set(selectionId: string, value: PendingSelection): void {
    this.map.set(selectionId, value);
  }
  delete(selectionId: string): void {
    this.map.delete(selectionId);
  }
  entries(): IterableIterator<[string, PendingSelection]> {
    return this.map.entries();
  }
}

/**
 * ✅ Erros tipados (para o controller mapear status code)
 */
export type CompleteIgLoginErrorCode =
  | "INVALID_INPUT"
  | "SELECTION_EXPIRED"
  | "SELECTION_NOT_OWNED"
  | "NO_CANDIDATES"
  | "PROVIDER_DOWN"
  | "REAUTH_REQUIRED"
  | "INTERNAL_ERROR";

export class CompleteIgLoginError extends Error {
  readonly code: CompleteIgLoginErrorCode;
  readonly details?: Record<string, unknown>;
  constructor(code: CompleteIgLoginErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "CompleteIgLoginError";
    this.code = code;
    this.details = details;
  }
}

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

  accessToken: string;
  expiresAt?: Date | null;

  facebookPageId?: string | null;
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

  /**
   * ✅ proteção de consistência
   * guarda um hash do "state" usado para iniciar esse fluxo
   * assim confirmSelection não aceita selectionId roubado
   */
  stateHash?: string | null;
};

export type CompleteIgLoginConfig = {
  chooseTtlMs: number;
  autoConfirmSingle: boolean;

  /**
   * ✅ validação de state opcional
   * Se true, exige state não vazio e amarra ao PendingSelection
   * Recomendo true em produção.
   */
  requireState: boolean;
};

function s(v: any): string {
  return String(v ?? "").trim();
}

function isValidSource(v: any): v is InstagramCandidateDTO["source"] {
  return v === "instagram_business_account" || v === "connected_instagram_account";
}

function normalizeCandidateDTO(c: any): InstagramCandidateDTO {
  const sourceRaw = c?.source;

  return {
    igUserId: s(c?.igUserId),
    username: s(c?.username),
    accountType: s(c?.accountType),
    facebookPageId: s(c?.facebookPageId),
    facebookPageName: c?.facebookPageName ? s(c.facebookPageName) : undefined,
    source: isValidSource(sourceRaw) ? sourceRaw : "instagram_business_account",
  };
}

function normalizeCandidateForDb(c: any): InstagramCandidateForDb {
  const sourceRaw = c?.source;

  const pageAccessToken =
    s(c?.pageAccessToken) || s(c?.page_access_token) || s(c?.access_token);

  const out: InstagramCandidateForDb = {
    igUserId: s(c?.igUserId),
    username: s(c?.username),
    accountType: s(c?.accountType),
    facebookPageId: s(c?.facebookPageId),
    facebookPageName: c?.facebookPageName ? s(c.facebookPageName) : undefined,
    source: isValidSource(sourceRaw) ? sourceRaw : "instagram_business_account",
    pageAccessToken,
  };

  if (!out.pageAccessToken) {
    throw new CompleteIgLoginError(
      "INVALID_INPUT",
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

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function safeEq(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) return false;
  return timingSafeEqual(aa, bb);
}

export class CompleteIgLoginUseCase {
  private readonly config: CompleteIgLoginConfig;

  constructor(
    private readonly auth: IInstagramIgLoginAuthService,
    private readonly tokenStore: IInstagramTokenStore,
    private readonly pendingStore: IInstagramPendingSelectionStore = new InMemoryInstagramPendingSelectionStore(),
    config?: Partial<CompleteIgLoginConfig>
  ) {
    this.config = {
      chooseTtlMs: 10 * 60 * 1000,
      autoConfirmSingle: true,
      requireState: true,
      ...config,
    };
  }

  private cleanupExpired() {
    const now = Date.now();
    for (const [key, val] of this.pendingStore.entries()) {
      if (now - val.createdAt > this.config.chooseTtlMs) {
        this.pendingStore.delete(key);
      }
    }
  }

  private createSelectionId(userId: string) {
    const nonce = randomBytes(18).toString("hex");
    const hash = sha256Hex(`${userId}|${Date.now()}|${nonce}`).slice(0, 32);
    return `igsel_${hash}`;
  }

  private assertPendingOrThrow(selectionId: string, userId: string, state?: string) {
    this.cleanupExpired();

    const pending = this.pendingStore.get(selectionId);
    if (!pending) {
      throw new CompleteIgLoginError(
        "SELECTION_EXPIRED",
        "Seleção expirada ou inválida. Refaça o login do Instagram."
      );
    }
    if (pending.userId !== userId) {
      throw new CompleteIgLoginError("SELECTION_NOT_OWNED", "Seleção não pertence a este usuário.");
    }

    const isExpired = Date.now() - pending.createdAt > this.config.chooseTtlMs;
    if (isExpired) {
      this.pendingStore.delete(selectionId);
      throw new CompleteIgLoginError("SELECTION_EXPIRED", "Seleção expirada. Refaça o login do Instagram.");
    }

    if (this.config.requireState) {
      const st = s(state);
      if (!st) {
        throw new CompleteIgLoginError("INVALID_INPUT", "state é obrigatório para confirmar seleção.");
      }
      const stHash = sha256Hex(st);
      const savedHash = s(pending.stateHash);
      if (!savedHash || !safeEq(savedHash, stHash)) {
        throw new CompleteIgLoginError(
          "INVALID_INPUT",
          "state inválido para esta seleção (possível seleção antiga ou troca de sessão)."
        );
      }
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
      throw new CompleteIgLoginError("INVALID_INPUT", "Seleções inválidas. Selecione ao menos uma conta.");
    }

    const results: InstagramLoginResult[] = [];

    for (const { igUserId, facebookPageId } of uniq.values()) {
      const c = byKey.get(keyOf(igUserId, facebookPageId));
      if (!c) {
        throw new CompleteIgLoginError(
          "INVALID_INPUT",
          `Seleção não encontrada entre os candidates: igUserId=${igUserId} pageId=${facebookPageId}`
        );
      }

      const username = s(c.username);
      const accountType = s(c.accountType);
      const pageAccessToken = s(c.pageAccessToken);

      if (!username) throw new CompleteIgLoginError("INVALID_INPUT", `username vazio para igUserId=${igUserId}`);
      if (!accountType) throw new CompleteIgLoginError("INVALID_INPUT", `accountType vazio para igUserId=${igUserId}`);
      if (!pageAccessToken) {
        throw new CompleteIgLoginError(
          "INVALID_INPUT",
          `pageAccessToken vazio para igUserId=${igUserId}. Isso normalmente indica que o token da página não foi retornado pelo Graph API.`
        );
      }

      await this.tokenStore.saveOrUpdate({
        userId,
        igUserId,
        username,
        accountType,
        accessToken: pending.longToken,
        pageAccessToken,
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
    const codeS = s(code);
    const userIdS = s(userId);
    const stateS = s(state);

    if (!codeS) throw new CompleteIgLoginError("INVALID_INPUT", "code é obrigatório");
    if (!userIdS) throw new CompleteIgLoginError("INVALID_INPUT", "userId é obrigatório");

    if (this.config.requireState && !stateS) {
      throw new CompleteIgLoginError("INVALID_INPUT", "state é obrigatório");
    }

    this.cleanupExpired();

    const { shortToken } = await this.auth.exchangeCodeForShortToken(codeS);
    const { longToken, expiresAt } = await this.auth.exchangeShortForLong(shortToken);

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
      throw new CompleteIgLoginError(
        "NO_CANDIDATES",
        "Nenhuma conta do Instagram foi encontrada para este login. " +
          "Verifique se o Instagram é Professional (Business/Creator) e está vinculado a uma Página do Facebook " +
          "que o usuário autenticado consegue acessar."
      );
    }

    const pending: PendingSelection = {
      userId: userIdS,
      longToken: s(longToken),
      expiresAt: expiresAt ?? null,
      createdAt: Date.now(),
      candidates: candidatesRaw.map(normalizeCandidateForDb),
      stateHash: stateS ? sha256Hex(stateS) : null,
    };

    // auto confirma
    if (this.config.autoConfirmSingle && pending.candidates.length === 1) {
      const only = pending.candidates[0];

      await this.persistSelections({
        userId: pending.userId,
        pending,
        selections: [{ igUserId: only.igUserId, facebookPageId: only.facebookPageId }],
      });

      return { status: "ok" };
    }

    const candidatesPublic: InstagramCandidateDTO[] = candidatesRaw.map(normalizeCandidateDTO);

    const selectionId = this.createSelectionId(userIdS);
    this.pendingStore.set(selectionId, pending);

    return {
      status: "choose_required",
      selectionId,
      candidates: candidatesPublic,
    };
  }

  getPendingForPersist(params: { selectionId: string; userId: string; state?: string }): PendingSelection {
    const selectionId = s(params.selectionId);
    const userId = s(params.userId);

    if (!selectionId) throw new CompleteIgLoginError("INVALID_INPUT", "selectionId é obrigatório");
    if (!userId) throw new CompleteIgLoginError("INVALID_INPUT", "userId é obrigatório");

    return this.assertPendingOrThrow(selectionId, userId, params.state);
  }

  getCandidatesForDb(params: { selectionId: string; userId: string; state?: string }): InstagramCandidateForDb[] {
    const pending = this.getPendingForPersist(params);
    return pending.candidates;
  }

  getCandidates(params: { selectionId: string; userId: string; state?: string }): InstagramCandidateDTO[] {
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
    state?: string;
  }): Promise<InstagramLoginResult[]> {
    const selectionId = s(params.selectionId);
    const userId = s(params.userId);
    const selections = params.selections;

    if (!selectionId) throw new CompleteIgLoginError("INVALID_INPUT", "selectionId é obrigatório");
    if (!userId) throw new CompleteIgLoginError("INVALID_INPUT", "userId é obrigatório");
    if (!Array.isArray(selections) || selections.length === 0) {
      throw new CompleteIgLoginError("INVALID_INPUT", "Selecione ao menos uma conta para conectar");
    }

    this.cleanupExpired();

    const pending = this.assertPendingOrThrow(selectionId, userId, params.state);

    const results = await this.persistSelections({
      userId,
      pending,
      selections,
    });

    this.pendingStore.delete(selectionId);
    return results;
  }
}
