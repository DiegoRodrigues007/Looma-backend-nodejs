import { IInstagramIgLoginAuthService } from "./IInstagramIgLoginAuthService";
import { IInstagramTokenStore } from "./IInstagramTokenStore";

export interface InstagramLoginResult {
  igUserId: string;
  username: string;
  accountType: string;

  accessToken: string; // token principal (preferir pageAccessToken quando existir)
  expiresAt?: Date | null;

  facebookPageId?: string | null;
  pageAccessToken?: string | null;
}

export class CompleteIgLoginUseCase {
  constructor(
    private readonly auth: IInstagramIgLoginAuthService,
    private readonly tokenStore: IInstagramTokenStore
  ) {}

  /**
   * Completa o login do Instagram:
   * - troca code -> short token
   * - troca short -> long token
   * - busca dados da conta
   * - persiste tokens + marca como conectado (isConnected=true) vinculado ao userId
   */
  async execute(code: string, state: string, userId: string): Promise<InstagramLoginResult> {
    if (!code || code.trim().length === 0) {
      throw new Error("code é obrigatório");
    }
    if (!userId || userId.trim().length === 0) {
      throw new Error("userId é obrigatório");
    }

    // 1) troca code -> short token
    const { shortToken } = await this.auth.exchangeCodeForShortToken(code);

    // 2) troca short -> long token
    const { longToken, expiresAt } = await this.auth.exchangeShortForLong(shortToken);

    // 3) pega dados do usuário/conta
    const me = await this.auth.getMe(longToken);

    const igUserId = String(me.igUserId ?? "").trim();
    const username = String(me.username ?? "").trim();
    const accountType = String(me.accountType ?? "").trim();

    if (!igUserId) throw new Error("Não foi possível obter igUserId do Instagram");
    if (!username) throw new Error("Não foi possível obter username do Instagram");
    if (!accountType) throw new Error("Não foi possível obter accountType do Instagram");

    const facebookPageId = me.facebookPageId ? String(me.facebookPageId) : null;
    const pageAccessToken = me.pageAccessToken ? String(me.pageAccessToken) : null;

    // ✅ Para métricas, geralmente o PageAccessToken é o ideal
    const tokenToPersist = pageAccessToken ?? longToken;

    // 4) salva/atualiza no banco vinculado ao userId + marca conectado
    await this.tokenStore.saveOrUpdate({
      userId,
      igUserId,
      username,
      accountType,
      accessToken: longToken,
      pageAccessToken,
      facebookPageId,
      expiresAt: expiresAt ?? null,
      lastRefreshedAt: new Date(),

      // ✅ ESSENCIAL para o seu front renderizar "Conectado"
      isConnected: true,
    });

    return {
      igUserId,
      username,
      accountType,
      accessToken: tokenToPersist,
      expiresAt: expiresAt ?? null,
      facebookPageId,
      pageAccessToken,
    };
  }
}
