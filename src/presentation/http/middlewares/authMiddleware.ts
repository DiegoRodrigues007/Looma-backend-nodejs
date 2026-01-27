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

function safeStr(v: unknown) {
  return typeof v === "string" ? v.trim() : String(v ?? "").trim();
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  // ✅ TEST MODE (NODE_ENV=test)
  // - Permite autenticar via headers x-test-user-id/x-test-email
  // - OU via Authorization Bearer (decode sem verify) para aproveitar makeAuthHeader()
  if (process.env.NODE_ENV === "test") {
    const forcedUserId = safeStr(req.header("x-test-user-id"));
    const forcedEmail = safeStr(req.header("x-test-email"));

    if (forcedUserId || forcedEmail) {
      const uid = forcedUserId || "user-1";
      const eml = forcedEmail || "test@local";
      req.user = { sub: uid, email: eml, userId: uid };
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ ok: false, message: "Token não informado" });
    }

    const token = authHeader.substring("Bearer ".length).trim();

    // ✅ decode SEM validar assinatura (somente em test)
    const decoded = jwt.decode(token) as any;

    const sub =
      safeStr(decoded?.sub) ||
      safeStr(decoded?.userId) ||
      safeStr(decoded?.id) ||
      "user-1";

    const email = safeStr(decoded?.email) || "test@local";

    req.user = { sub, email, userId: sub };
    return next();
  }

  // ✅ Produção / dev: fluxo real (JWT verificado)
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ ok: false, message: "Token não informado" });
  }

  const token = authHeader.substring("Bearer ".length).trim();

  try {
    const payload = jwt.verify(token, env.jwt.secret, {
      issuer: env.jwt.issuer,
      audience: env.jwt.audience,
    }) as any;

    const tokenUserId =
      safeStr(payload?.sub) || safeStr(payload?.userId) || safeStr(payload?.id);

    const tokenEmail = safeStr(payload?.email);

    if (!tokenUserId && !tokenEmail) {
      return res
        .status(401)
        .json({ ok: false, message: "Token sem identificador (sub/email)" });
    }

    // ✅ Prioriza buscar por ID (sub), mas cai pra email se necessário
    const user = tokenUserId
      ? await prisma.user.findUnique({
          where: { id: tokenUserId },
          select: { id: true, email: true },
        })
      : await prisma.user.findUnique({
          where: { email: tokenEmail },
          select: { id: true, email: true },
        });

    if (!user) {
      return res
        .status(401)
        .json({ ok: false, message: "Usuário não encontrado no banco" });
    }

    req.user = {
      sub: user.id, // mantém o sub consistente com o user.id
      email: user.email,
      userId: user.id,
    };

    return next();
  } catch {
    return res
      .status(401)
      .json({ ok: false, message: "Token inválido ou expirado" });
  }
}