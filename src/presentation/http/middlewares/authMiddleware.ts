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
  const verifyInTest = process.env.AUTH_VERIFY_IN_TEST === "true";

  /**
   * =========================================================
   * 🧪 TEST MODE (NODE_ENV=test)
   * =========================================================
   * - Por padrão: modo flexível (compatível com testes antigos)
   * - Com AUTH_VERIFY_IN_TEST=true: força verificação REAL
   */
  if (process.env.NODE_ENV === "test" && !verifyInTest) {
    const forcedUserId = safeStr(req.header("x-test-user-id"));
    const forcedEmail = safeStr(req.header("x-test-email"));

    // ✅ override explícito (test helpers)
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

    // ⚠️ decode SEM validar assinatura (somente em test legacy)
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

  /**
   * =========================================================
   * 🔐 FLUXO REAL (prod / dev / test com AUTH_VERIFY_IN_TEST)
   * =========================================================
   */
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
      safeStr(payload?.sub) ||
      safeStr(payload?.userId) ||
      safeStr(payload?.id);

    const tokenEmail = safeStr(payload?.email);

    if (!tokenUserId && !tokenEmail) {
      return res
        .status(401)
        .json({ ok: false, message: "Token sem identificador (sub/email)" });
    }

    // ✅ Prioriza ID, fallback para email
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
      sub: user.id,
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