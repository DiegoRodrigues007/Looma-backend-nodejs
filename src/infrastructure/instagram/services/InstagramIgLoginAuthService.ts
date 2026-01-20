import {
  IInstagramIgLoginAuthService,
  InstagramAuthReauthRequired,
  InstagramAuthResolved,
} from "../../../application/ports/instagram/IInstagramIgLoginAuthService";
import { InstagramIgLoginClient } from "../clients/InstagramIgLoginClient";

export class InstagramIgLoginAuthService implements IInstagramIgLoginAuthService {
  constructor(private readonly client: InstagramIgLoginClient) {}

  /**
   * 🔗 Gera URL de login
   * @param state
   * @param forceReRequest força o Meta a pedir permissões novamente
   */
  buildLoginUrl(state: string, forceReRequest = false): string {
    return this.client.buildLoginUrl(state, forceReRequest);
  }

  async exchangeCodeForShortToken(code: string) {
    return this.client.exchangeCodeForShortToken(code);
  }

  async exchangeShortForLong(shortToken: string) {
    return this.client.exchangeShortForLong(shortToken);
  }

  async refreshLongToken(longToken: string) {
    return this.client.refreshLong(longToken);
  }

  async resolveMeOrReauth(
    accessToken: string
  ): Promise<InstagramAuthResolved | InstagramAuthReauthRequired> {
    const granted = await this.client.getGrantedPermissions(accessToken);

    if (!this.client.hasRequiredPermissions(granted)) {
      const required = [
        "pages_show_list",
        "instagram_basic",
        "instagram_manage_insights",
      ];
      const missing = required.filter((p) => !granted.has(p));

      return {
        status: "reauth_required" as const,
        loginUrl: this.buildLoginUrl(`ig_reauth_${Date.now()}`, true),
        missingPermissions: missing,
      };
    }

    const candidates = await this.client.getCandidates(accessToken);

    return {
      status: "ok" as const,
      candidates,
    };
  }

  async resolveCandidatesOrReauth(accessToken: string) {
    return this.resolveMeOrReauth(accessToken);
  }


  async getMe(accessToken: string) {
    return this.client.getMe(accessToken);
  }

  async getCandidates(accessToken: string) {
    return this.client.getCandidates(accessToken);
  }
}
