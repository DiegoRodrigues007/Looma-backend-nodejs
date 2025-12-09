import { IInstagramIgLoginAuthService } from "../../application/instagram/IInstagramIgLoginAuthService";
import { InstagramIgLoginClient } from "./InstagramIgLoginClient";

export class InstagramIgLoginAuthService implements IInstagramIgLoginAuthService {
  constructor(private readonly client: InstagramIgLoginClient) {}

  buildLoginUrl(state: string): string {
    return this.client.buildLoginUrl(state);
  }

  exchangeCodeForShortToken(code: string) {
    return this.client.exchangeCodeForShortToken(code);
  }

  exchangeShortForLong(shortToken: string) {
    return this.client.exchangeShortForLong(shortToken);
  }

  refreshLongToken(longToken: string) {
    return this.client.refreshLong(longToken);
  }

  getMe(accessToken: string) {
    return this.client.getMe(accessToken);
  }
}
