import { randomBytes, createHash } from "crypto";
import { IInstagramIgLoginAuthService } from "./IInstagramIgLoginAuthService";
import { IInstagramTokenStore } from "./IInstagramTokenStore";

/**
 * ✅ O frontend não precisa receber tokens.
 * Ele só precisa escolher qual IG/Page conectar.
 */
export type InstagramCandidateDTO = {
  igUserId: string;
  username: string;
  accountType: string;
  facebookPageId: string;
  facebookPageName?: string;
  source: "instagram_business_account" | "connected_instagram_account";
};

export interface InstagramLoginResult {
  igUserId: string;
  username: string;
  accountType: string;

  accessToken: string; // para uso interno/retorno (preferir pageAccessToken quando existir)
  expiresAt?: Date | null;

  facebookPageId?: string | null;
  pageAccessToken?: string | null;
}

export type InstagramLoginReauthRequired = {
  status: "reauth_required";
  loginUrl: string;
  missingPermissions: string[];
};

/**
 * ✅ Novo: quando o backend precisa que o usuário escolha
 */
export type InstagramLoginChooseRequired = {
  status: "choose_required";
  selectionId: string;
  candidates: InstagramCandidateDTO[];
};

/**
 * ✅ Confirm payload: usuário escolhe 1 ou várias contas
 */
export type InstagramConfirmSelectionInput = Array<{
  igUserId: string;
  facebookPageId: string;
}>;

/**
 * Internal (guardado no cache, não vai pro frontend)
 */
type PendingSelection = {
  userId: string;
  longToken: string;
  expiresAt?: Date | null;
  createdAt: number;

  // candidates completos (inclui pageAccessToken)
  candidates: Array<
    InstagramCandidateDTO & {
      pageAccessToken: string; // necessário pra salvar e usar API
    }
  >;
};

export class CompleteIgLoginUseCase {
  constructor(
    private readonly auth: IInstagramIgLoginAuthService,
    private readonly tokenStore: IInstagramTokenStore
  ) {}

  /* =========================
     Pending cache (in-memory)
     - depois você troca por Redis/DB
  ========================= */

  private static readonly pending = new Map<string, PendingSelection>();
  private static readonly ttlMs = Number(process.env.IG_LOGIN_CHOOSE_TTL_MS ?? 10 * 60 * 1000);

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

  /* =========================
     STEP A: callback -> candidates
  ========================= */

  /**
   * Completa o login do Instagram e devolve candidates pro frontend escolher:
   * - troca code -> short token
   * - troca short -> long token
   * - valida permissões reais
   * - se faltar algo → reauth_required
   * - resolve contas IG (Business/Creator) via Pages
   * - devolve candidates e guarda tokens temporariamente (cache)
   *
   * ⚠️ NÃO salva tokens definitivos aqui.
   */
  async execute(
    code: string,
    state: string,
    userId: string
  ): Promise<InstagramLoginChooseRequired | InstagramLoginReauthRequired> {
    if (!code || code.trim().length === 0) {
      throw new Error("code é obrigatório");
    }
    if (!userId || userId.trim().length === 0) {
      throw new Error("userId é obrigatório");
    }

    CompleteIgLoginUseCase.cleanupExpired();

    /* =========================
       1) code -> short token
    ========================= */
    const { shortToken } = await this.auth.exchangeCodeForShortToken(code);

    /* =========================
       2) short -> long token
    ========================= */
    const { longToken, expiresAt } = await this.auth.exchangeShortForLong(shortToken);

    /* =========================
       3) Resolver candidates OU reauth
    ========================= */
    // @ts-expect-error: se a interface ainda não tiver esse método, adicione nele também
    const resolved = await this.auth.resolveCandidatesOrReauth(longToken);

    if (resolved.status === "reauth_required") {
      return {
        status: "reauth_required",
        loginUrl: resolved.loginUrl,
        missingPermissions: resolved.missingPermissions,
      };
    }

    const candidatesRaw = resolved.candidates ?? [];

    if (!candidatesRaw.length) {
      throw new Error(
        "Nenhuma conta do Instagram foi encontrada para este login. " +
          "Verifique se o Instagram é Professional (Business/Creator) e está vinculado a uma Página do Facebook " +
          "que o usuário autenticado consegue acessar."
      );
    }

    // Monta DTO pro frontend (sem token)
    const candidates: InstagramCandidateDTO[] = candidatesRaw.map((c: any) => ({
      igUserId: String(c.igUserId),
      username: String(c.username),
      accountType: String(c.accountType),
      facebookPageId: String(c.facebookPageId),
      facebookPageName: c.facebookPageName ? String(c.facebookPageName) : undefined,
      source: c.source,
    }));

    // Guarda no cache (com pageAccessToken)
    const selectionId = CompleteIgLoginUseCase.createSelectionId(userId);

    const pending: PendingSelection = {
      userId,
      longToken,
      expiresAt: expiresAt ?? null,
      createdAt: Date.now(),
      candidates: candidatesRaw.map((c: any) => ({
        igUserId: String(c.igUserId),
        username: String(c.username),
        accountType: String(c.accountType),
        facebookPageId: String(c.facebookPageId),
        facebookPageName: c.facebookPageName ? String(c.facebookPageName) : undefined,
        source: c.source,
        pageAccessToken: String(c.pageAccessToken),
      })),
    };

    CompleteIgLoginUseCase.pending.set(selectionId, pending);

    return {
      status: "choose_required",
      selectionId,
      candidates,
    };
  }

  /* =========================
     STEP A.1: GET candidates by selectionId
  ========================= */

  /**
   * ✅ Novo:
   * O frontend pode chamar /candidates depois do callback com selectionId
   * para re-renderizar a lista sem repetir login.
   */
  async getCandidates(params: {
    selectionId: string;
    userId: string;
  }): Promise<InstagramCandidateDTO[]> {
    const selectionId = String(params.selectionId ?? "").trim();
    const userId = String(params.userId ?? "").trim();

    if (!selectionId) throw new Error("selectionId é obrigatório");
    if (!userId) throw new Error("userId é obrigatório");

    const pending = CompleteIgLoginUseCase.assertPendingOrThrow(selectionId, userId);

    // devolve apenas DTO (sem tokens)
    return pending.candidates.map((c) => ({
      igUserId: c.igUserId,
      username: c.username,
      accountType: c.accountType,
      facebookPageId: c.facebookPageId,
      facebookPageName: c.facebookPageName,
      source: c.source,
    }));
  }

  /* =========================
     STEP B: confirm -> persist 1..N
  ========================= */

  /**
   * Confirma as seleções feitas no frontend e salva 1 ou várias contas.
   *
   * - selections: [{igUserId, facebookPageId}, ...]
   * - persiste cada conta separadamente (multi-conta)
   */
  async confirmSelection(params: {
    selectionId: string;
    userId: string;
    selections: InstagramConfirmSelectionInput;
  }): Promise<InstagramLoginResult[]> {
    const selectionId = String(params.selectionId ?? "").trim();
    const userId = String(params.userId ?? "").trim();
    const selections = params.selections;

    if (!selectionId) throw new Error("selectionId é obrigatório");
    if (!userId) throw new Error("userId é obrigatório");
    if (!Array.isArray(selections) || selections.length === 0) {
      throw new Error("Selecione ao menos uma conta para conectar");
    }

    const pending = CompleteIgLoginUseCase.assertPendingOrThrow(selectionId, userId);

    // Index candidates
    const byKey = new Map<string, PendingSelection["candidates"][number]>();
    for (const c of pending.candidates) {
      byKey.set(`${c.igUserId}|${c.facebookPageId}`, c);
    }

    // dedup selections
    const uniq = new Map<string, { igUserId: string; facebookPageId: string }>();
    for (const s of selections) {
      const igUserId = String((s as any)?.igUserId ?? "").trim();
      const facebookPageId = String((s as any)?.facebookPageId ?? "").trim();
      if (!igUserId || !facebookPageId) continue;
      uniq.set(`${igUserId}|${facebookPageId}`, { igUserId, facebookPageId });
    }

    if (uniq.size === 0) {
      throw new Error("Seleções inválidas. Selecione ao menos uma conta.");
    }

    const results: InstagramLoginResult[] = [];

    for (const { igUserId, facebookPageId } of uniq.values()) {
      const c = byKey.get(`${igUserId}|${facebookPageId}`);
      if (!c) {
        throw new Error(
          `Seleção não encontrada entre os candidates: igUserId=${igUserId} pageId=${facebookPageId}`
        );
      }

      const username = String(c.username ?? "").trim();
      const accountType = String(c.accountType ?? "").trim();
      const pageAccessToken = String((c as any).pageAccessToken ?? "").trim();

      if (!username) throw new Error(`username vazio para igUserId=${igUserId}`);
      if (!accountType) throw new Error(`accountType vazio para igUserId=${igUserId}`);
      if (!pageAccessToken) throw new Error(`pageAccessToken vazio para igUserId=${igUserId}`);

      // ✅ Persistência: salva longToken + pageAccessToken + facebookPageId
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
        accessToken: pageAccessToken || pending.longToken,
        expiresAt: pending.expiresAt ?? null,
        facebookPageId,
        pageAccessToken,
      });
    }

    // limpa selection (uso único)
    CompleteIgLoginUseCase.pending.delete(selectionId);

    return results;
  }
}
