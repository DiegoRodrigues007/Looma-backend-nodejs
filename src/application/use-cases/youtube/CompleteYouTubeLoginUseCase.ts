import { IYouTubeAuthService } from "../../ports/youtube/IYouTubeAuthService";
import { IYouTubeTokenStore } from "../../youtube/IYouTubeTokenStore";

export class CompleteYouTubeLoginUseCase {
  constructor(
    private readonly auth: IYouTubeAuthService,
    private readonly store: IYouTubeTokenStore
  ) {}

  async execute(input: { userId: string; code: string }) {
    const tokens = await this.auth.exchangeCodeForTokens(input.code);
    const me = await this.auth.getMyChannel(tokens.accessToken);

    await this.store.saveOrUpdate({
      userId: input.userId,
      channelId: me.channelId,
      channelTitle: me.title ?? null,
      channelHandle: me.handle ?? null,

      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? null,
      expiresAt: tokens.expiresAt ?? null,
      grantedScopes: tokens.scope ?? null,
      lastRefreshedAt: new Date(),
      isConnected: true,
    });

    return { channel: me };
  }
}
