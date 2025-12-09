import { IInstagramIgLoginAuthService } from "./IInstagramIgLoginAuthService";
import { IInstagramTokenStore } from "./IInstagramTokenStore";

export interface InstagramLoginResult {
  igUserId: string;
  username: string;
  accountType: string;
  accessToken: string;
  expiresAt?: Date | null;
}

export class CompleteIgLoginUseCase {
  constructor(
    private readonly auth: IInstagramIgLoginAuthService,
    private readonly tokenStore: IInstagramTokenStore
  ) {}

  async execute(code: string, state: string): Promise<InstagramLoginResult> {
    // 1) troca code -> short token
    const { shortToken } = await this.auth.exchangeCodeForShortToken(code);

    // 2) troca short -> long token
    const { longToken, expiresAt } = await this.auth.exchangeShortForLong(shortToken);

    // 3) pega dados do usuário
    const me = await this.auth.getMe(longToken);

    // 4) salva/atualiza token no banco
    await this.tokenStore.saveOrUpdate(me.igUserId, longToken, expiresAt ?? undefined);

    return {
      igUserId: me.igUserId,
      username: me.username,
      accountType: me.accountType,
      accessToken: longToken,
      expiresAt: expiresAt ?? undefined
    };
  }
}
