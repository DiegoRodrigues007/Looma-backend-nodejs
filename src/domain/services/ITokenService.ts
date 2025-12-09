export interface TokenPayload {
  userId: string;
  email: string;
}

export interface AccessTokenResult {
  token: string;
  expiresAt: Date;
}

export interface ITokenService {
  createAccessToken(payload: TokenPayload): AccessTokenResult;
}
