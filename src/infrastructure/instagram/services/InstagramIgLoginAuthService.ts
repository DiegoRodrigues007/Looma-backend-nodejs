import {
  IInstagramIgLoginAuthService,
  InstagramAuthReauthRequired,
  InstagramAuthResolved,
} from "../../../application/ports/instagram/IInstagramIgLoginAuthService";
import { InstagramIgLoginClient } from "../clients/InstagramIgLoginClient";

function s(v: unknown): string {
  return String(v ?? "").trim();
}

const REQUIRED_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_read_user_content",
  "instagram_basic",
  "instagram_manage_insights",
] as const;

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

  async refreshLong(longToken: string) {
    return this.client.refreshLong(longToken);
  }

  async resolveMeOrReauth(
    accessToken: string
  ): Promise<InstagramAuthResolved | InstagramAuthReauthRequired> {
    const token = s(accessToken);
    if (!token) {
      return {
        status: "reauth_required" as const,
        loginUrl: this.buildLoginUrl(`ig_reauth_${Date.now()}`, true),
        missingPermissions: [...REQUIRED_SCOPES],
      };
    }

    const granted = await this.client.getGrantedPermissions(token);

    const clientAny = this.client as any;
    const hasRequired =
      typeof clientAny?.hasRequiredPermissions === "function"
        ? !!clientAny.hasRequiredPermissions(granted)
        : REQUIRED_SCOPES.every((p) => granted?.has?.(p));

    if (!hasRequired) {
      const missing = REQUIRED_SCOPES.filter((p) => !granted?.has?.(p));

      return {
        status: "reauth_required" as const,
        loginUrl: this.buildLoginUrl(`ig_reauth_${Date.now()}`, true),
        missingPermissions: missing.length ? missing : [...REQUIRED_SCOPES],
      };
    }

    const candidates = await this.client.getCandidates(token);

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