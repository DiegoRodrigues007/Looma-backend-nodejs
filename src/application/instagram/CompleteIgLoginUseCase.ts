import { IInstagramIgLoginAuthService } from "./IInstagramIgLoginAuthService";
import { IInstagramTokenStore } from "./IInstagramTokenStore";

export interface InstagramLoginResult {
  igUserId: string;
  username: string;
  accountType: string;

  // token principal que você vai usar para métricas (idealmente o PageAccessToken)
  accessToken: string;
  expiresAt?: Date | null;

  // extras importantes para IG Graph
  facebookPageId?: string | null;
  pageAccessToken?: string | null;
}

export class CompleteIgLoginUseCase {
  constructor(
    private readonly auth: IInstagramIgLoginAuthService,
    private readonly tokenStore: IInstagramTokenStore
  ) {}

  async execute(code: string, _state: string): Promise<InstagramLoginResult> {
    // 1) troca code -> short user token
    const { shortToken } = await this.auth.exchangeCodeForShortToken(code);

    // 2) troca short -> long-lived user token
    const { longToken, expiresAt } = await this.auth.exchangeShortForLong(shortToken);

    // 3) pega dados do IG (retorna também facebookPageId + pageAccessToken quando existir)
    const me = await this.auth.getMe(longToken);

    const igUserId = me.igUserId;
    const username = me.username;
    const accountType = me.accountType;

    const facebookPageId = me.facebookPageId ?? null;
    const pageAccessToken = me.pageAccessToken ?? null;

    // Para métricas do IG Graph, geralmente o melhor é usar o PageAccessToken
    const tokenToUseForMetrics = pageAccessToken ?? longToken;

    // 4) salva/atualiza tudo no banco (sem any)
    await this.tokenStore.saveOrUpdate({
      igUserId,
      username,
      accountType,
      accessToken: longToken, 
      pageAccessToken,
      facebookPageId,
      expiresAt: expiresAt ?? null,
      lastRefreshedAt: new Date()
    });

    return {
      igUserId,
      username,
      accountType,
      accessToken: tokenToUseForMetrics,
      expiresAt: expiresAt ?? undefined,
      facebookPageId,
      pageAccessToken
    };
  }
}
