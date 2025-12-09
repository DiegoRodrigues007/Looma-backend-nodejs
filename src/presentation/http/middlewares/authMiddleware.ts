import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../../../infrastructure/config/env";

declare global {
  namespace Express {
    interface Request {
      user?: { sub: string; email: string };
    }
  }
}

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Token não informado" });
  }

  const token = authHeader.substring("Bearer ".length);

  try {
    const payload = jwt.verify(token, env.jwt.secret, {
      issuer: env.jwt.issuer,
      audience: env.jwt.audience
    }) as any;

    req.user = { sub: payload.sub, email: payload.email };
    next();
  } catch {
    return res.status(401).json({ message: "Token inválido ou expirado" });
  }
}
