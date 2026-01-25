import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../../../infrastructure/config/env";
import { prisma } from "../../../infrastructure/db/prismaClient";

declare global {
  namespace Express {
    interface Request {
      user?: { sub: string; email: string; userId: string };
    }
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  // ✅ Em testes: bypass do JWT + Prisma (mantém rotas testáveis)
  if (process.env.NODE_ENV === "test") {
    const authHeader = req.headers.authorization;

    // se o teste nem mandou Bearer, continua bloqueando (boa prática)
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ ok: false, message: "Token não informado" });
    }

    // Permite que o teste controle userId/email se quiser
    const forcedUserId =
      String(req.header("x-test-user-id") ?? "").trim() || "user-1";
    const forcedEmail =
      String(req.header("x-test-email") ?? "").trim() || "test@local";

    req.user = { sub: forcedUserId, email: forcedEmail, userId: forcedUserId };
    return next();
  }

  // ✅ Produção / dev: fluxo real
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ ok: false, message: "Token não informado" });
  }

  const token = authHeader.substring("Bearer ".length);

  try {
    const payload = jwt.verify(token, env.jwt.secret, {
      issuer: env.jwt.issuer,
      audience: env.jwt.audience,
    }) as any;

    const email = String(payload?.email ?? "").trim();
    const sub = String(payload?.sub ?? "").trim();

    if (!email) {
      return res.status(401).json({ ok: false, message: "Token sem email" });
    }

    // ✅ Busca o usuário REAL (id interno UUID) no seu banco
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true },
    });

    if (!user) {
      return res
        .status(401)
        .json({ ok: false, message: "Usuário não encontrado no banco" });
    }

    // ✅ Agora o backend sempre tem o UUID do banco disponível
    req.user = { sub, email: user.email, userId: user.id };

    return next();
  } catch {
    return res
      .status(401)
      .json({ ok: false, message: "Token inválido ou expirado" });
  }
}