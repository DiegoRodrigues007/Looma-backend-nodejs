export interface InstagramTokenRecord {
  userId: string;
  igUserId: string;

  accessToken: string;
  pageAccessToken?: string | null;
  facebookPageId?: string | null;

  username?: string | null;
  accountType?: string | null;

  expiresAt?: Date | null;
  lastRefreshedAt?: Date | null;

  /**
   * Flag persistida no banco:
   * - true  => conta vinculada/conectada (OAuth concluído + tokens salvos)
   * - false => desconectada (tokens removidos/invalidado)
   */
  isConnected: boolean;

  grantedScopes?: string | null;
}

export interface SaveOrUpdateInstagramTokenInput {
  userId: string;
  igUserId: string;

  /**
   * Token principal (long token). No seu fluxo ele sempre existe.
   * Evita criar registro "conectado" sem token.
   */
  accessToken: string;

  /**
   * Token de página (quando existir). Geralmente é o preferido para métricas.
   */
  pageAccessToken?: string | null;

  facebookPageId?: string | null;

  username?: string | null;
  accountType?: string | null;

  expiresAt?: Date | null;
  lastRefreshedAt?: Date | null;

  /**
   * Obrigatório para não depender de default escondido.
   * - OAuth sucesso: true
   * - Disconnect: false
   */
  isConnected: boolean;

  /**
   * Escopos concedidos (se você optar por armazenar).
   */
  grantedScopes?: string | null;
}

export interface IInstagramTokenStore {
  getByUserId(userId: string): Promise<InstagramTokenRecord | null>;
  saveOrUpdate(input: SaveOrUpdateInstagramTokenInput): Promise<void>;
}
