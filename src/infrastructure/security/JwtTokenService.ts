import jwt from "jsonwebtoken";
import { ITokenService, TokenPayload, AccessTokenResult } from "../../domain/services/ITokenService";
import { env } from "../config/env";

export class JwtTokenService implements ITokenService {
  createAccessToken(payload: TokenPayload): AccessTokenResult {
    const expiresInMinutes = Number(process.env.JWT_ACCESS_TOKEN_MINUTES ?? 30);

    const token = jwt.sign(
      { email: payload.email },
      env.jwt.secret,
      {
        subject: payload.userId,
        issuer: env.jwt.issuer,
        audience: env.jwt.audience,
        expiresIn: `${expiresInMinutes}m`
      }
    );

    const expiresAt = new Date(Date.now() + expiresInMinutes * 60_000);

    return { token, expiresAt };
  }
}
