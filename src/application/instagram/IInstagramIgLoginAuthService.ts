/* =========================
   Core types
========================= */

/**
 * Representação mínima de uma conta IG resolvida
 * (usado apenas em fluxo legado)
 */
export type InstagramMe = {
  igUserId: string;
  username: string;
  accountType: string;
  facebookPageId?: string | null;
  pageAccessToken?: string | null;
};

/**
 * ✅ Candidato encontrado para conexão
 * Pode ser Business ou Creator
 */
export type IgCandidate = {
  igUserId: string;
  username: string;
  accountType: string;

  facebookPageId: string;
  facebookPageName?: string;

  pageAccessToken: string;

  source: "instagram_business_account" | "connected_instagram_account";
};

/**
 * ✅ Token válido + permissões OK
 * Retorna TODAS as contas IG acessíveis
 */
export type InstagramAuthResolved = {
  status: "ok";
  candidates: IgCandidate[];
};

/**
 * ❌ Token válido, mas permissões insuficientes
 * Frontend deve redirecionar para novo consentimento
 */
export type InstagramAuthReauthRequired = {
  status: "reauth_required";
  loginUrl: string;
  missingPermissions: string[];
};

/* =========================
   Auth Service Contract
========================= */

/**
 * Contrato do serviço de autenticação Instagram
 *
 * 🔐 Robusto contra:
 * - permissões antigas
 * - múltiplas páginas
 * - múltiplas contas IG
 * - business / creator
 */
export interface IInstagramIgLoginAuthService {
  /* =========================
     OAuth URL
  ========================= */

  /**
   * Gera URL de login do Facebook/Instagram
   * @param state string de segurança (csrf / userId / etc)
   * @param forceReRequest força novo consentimento
   */
  buildLoginUrl(state: string, forceReRequest?: boolean): string;

  /* =========================
     Token exchange
  ========================= */

  /**
   * Troca code do OAuth por short-lived token
   */
  exchangeCodeForShortToken(
    code: string
  ): Promise<{
    shortToken: string;
    userId?: string | null;
  }>;

  /**
   * Troca short-lived token por long-lived token
   */
  exchangeShortForLong(
    shortToken: string
  ): Promise<{
    longToken: string;
    expiresAt?: Date | null;
  }>;

  /**
   * Renova long-lived token
   */
  refreshLongToken(longToken: string): Promise<string>;

  /* =========================
     Main resolver (FLUXO NOVO)
  ========================= */

  /**
   * Resolve TODAS as contas do Instagram acessíveis pelo token.
   *
   * Fluxo:
   * - valida permissões reais
   * - se faltar algo → reauth_required
   * - se OK → lista de candidatos (multi-conta)
   */
  resolveMeOrReauth(
    accessToken: string
  ): Promise<InstagramAuthResolved | InstagramAuthReauthRequired>;

  /* =========================
     Backward compatibility
  ========================= */

  /**
   * ⚠️ USO LEGADO
   *
   * Retorna apenas o PRIMEIRO candidato encontrado.
   * NÃO usar em código novo.
   *
   * Mantido apenas para compatibilidade.
   */
  getMe(accessToken: string): Promise<InstagramMe>;
}
