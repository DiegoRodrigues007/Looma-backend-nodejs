import { Request, Response } from "express";
import { randomBytes, createHash } from "crypto";
import * as jwt from "jsonwebtoken";

import { RegisterUserUseCase } from "../../../application/use-cases/auth/RegisterUserUseCase";
import { LoginUserUseCase } from "../../../application/use-cases/auth/LoginUserUseCase";
import { GetCurrentUserUseCase } from "../../../application/use-cases/auth/GetCurrentUserUseCase";

import { prisma } from "../../../infrastructure/db/prismaClient";

/* =========================
   Helpers
========================= */

function pickEmailOrUserName(body: any): string | undefined {
  const raw =
    body?.emailOrUserName ??
    body?.email ??
    body?.login ??
    body?.username ??
    body?.userName;

  if (raw === undefined || raw === null) return undefined;

  const value = String(raw).trim();
  if (!value) return undefined;

  if (value.includes("@")) return value.toLowerCase();
  return value;
}

function pickName(body: any): string | undefined {
  const raw = body?.name ?? body?.fullName ?? body?.nome;
  if (raw === undefined || raw === null) return undefined;

  const value = String(raw).trim();
  if (!value) return undefined;

  return value;
}

function generateRefreshToken() {
  return randomBytes(48).toString("hex");
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function getRefreshDays(): number {
  const raw = process.env.REFRESH_TOKEN_DAYS;
  const n = raw ? Number(raw) : 30;
  return Number.isFinite(n) && n > 0 ? n : 30;
}

function getJwtSecret(): jwt.Secret {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET não configurado");
  return s;
}

function getJwtExpiresIn(): jwt.SignOptions["expiresIn"] {
  // mantém compatível com seu .env atual
  const raw = process.env.JWT_EXPIRES_IN;
  return (raw as jwt.SignOptions["expiresIn"]) ?? "30m";
}

function getJwtIssuer(): string {
  // use o MESMO issuer do authMiddleware/JwtTokenService
  // ajuste o nome da env se no seu projeto for diferente
  const v = process.env.JWT_ISSUER;
  if (!v) throw new Error("JWT_ISSUER não configurado");
  return v;
}

function getJwtAudience(): string {
  // use o MESMO audience do authMiddleware/JwtTokenService
  const v = process.env.JWT_AUDIENCE;
  if (!v) throw new Error("JWT_AUDIENCE não configurado");
  return v;
}

function refreshCookieOptions() {
  const isProd = process.env.NODE_ENV === "production";
  const refreshDays = getRefreshDays();

  return {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax" as const,
    // importante: manter consistente com seus endpoints
    path: "/api/auth/refresh",
    maxAge: refreshDays * 24 * 60 * 60 * 1000,
  };
}

function isInvalidCredentialsMessage(msg: unknown): boolean {
  const s = typeof msg === "string" ? msg.toLowerCase() : "";
  return s.includes("credenciais") || s.includes("inválid") || s.includes("invalid");
}

type ReqUser = { sub: string } | undefined;

export class AuthController {
  constructor(
    private readonly registerUseCase: RegisterUserUseCase,
    private readonly loginUseCase: LoginUserUseCase,
    private readonly meUseCase: GetCurrentUserUseCase
  ) {}

  register = async (req: Request, res: Response) => {
    // ✅ validação defensiva pra não estourar 500 por .trim() em undefined
    const email = pickEmailOrUserName(req.body);
    const name = pickName(req.body);
    const password = typeof req.body?.password === "string" ? req.body.password.trim() : "";

    // register deve ser email de verdade
    const isEmail = !!email && email.includes("@");

    if (!isEmail || !name || !password) {
      return res.status(400).json({ message: "Dados inválidos" });
    }

    // garante payload no formato esperado pelo UC
    const payload = { ...req.body, email, name, password };

    const result = await this.registerUseCase.execute(payload);
    if (!result.isSuccess) return res.status(400).json({ message: result.error });

    return res.status(201).json(result.value);
  };

  login = async (req: Request, res: Response) => {
    const emailOrUserName = pickEmailOrUserName(req.body);
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    if (!emailOrUserName || !password) {
      return res.status(400).json({ message: "Dados inválidos" });
    }

    const payload = { ...req.body, emailOrUserName, password };

    const result = await this.loginUseCase.execute(payload);

    // ✅ aqui é a diferença: credenciais inválidas => 401 (seu teste espera isso)
    if (!result.isSuccess) {
      const msg = result.error;
      if (isInvalidCredentialsMessage(msg)) {
        return res.status(401).json({ message: msg });
      }
      return res.status(400).json({ message: msg });
    }

    const accessToken = (result.value as any)?.accessToken as string | undefined;
    if (!accessToken) {
      return res.status(500).json({ message: "Login sem accessToken (erro interno)." });
    }

    // ⚠️ decode não valida assinatura; mas aqui você só quer pegar o sub.
    const decoded = jwt.decode(accessToken) as jwt.JwtPayload | null;
    const userId = (decoded?.sub as string | undefined) ?? undefined;

    if (!userId) {
      return res
        .status(500)
        .json({ message: "Token sem sub (userId). Ajuste a geração do JWT." });
    }

    const refreshToken = generateRefreshToken();
    const refreshHash = hashToken(refreshToken);
    const refreshExpiresAt = new Date(Date.now() + getRefreshDays() * 24 * 60 * 60 * 1000);

    await prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: refreshHash,
        expiresAt: refreshExpiresAt,
      },
    });

    res.cookie("refresh_token", refreshToken, refreshCookieOptions());

    // ✅ Mantive refreshToken no body pra não quebrar seu front/testes.
    return res.json({
      ...result.value,
      refreshToken,
    });
  };

  me = async (req: Request, res: Response) => {
    const userId = (req.user as ReqUser)?.sub;
    if (!userId) return res.status(401).json({ message: "Não autenticado" });

    const result = await this.meUseCase.execute({ userId });
    if (!result.isSuccess) return res.status(404).json({ message: result.error });

    return res.json(result.value);
  };

  refresh = async (req: Request, res: Response) => {
    const rt = (req as any).cookies?.refresh_token as string | undefined;
    if (!rt) return res.status(401).json({ message: "Refresh token ausente" });

    const rtHash = hashToken(rt);

    const stored = await prisma.refreshToken.findFirst({
      where: {
        tokenHash: rtHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    if (!stored) {
      return res.status(401).json({ message: "Refresh token inválido/expirado" });
    }

    // ✅ busca o email para assinar o JWT no mesmo padrão do resto do sistema
    const user = await prisma.user.findUnique({
      where: { id: stored.userId },
      select: { email: true },
    });

    if (!user?.email) {
      return res.status(401).json({ message: "Usuário não encontrado" });
    }

    // revoga o refresh atual
    await prisma.refreshToken.updateMany({
      where: { tokenHash: rtHash },
      data: { revokedAt: new Date() },
    });

    // emite novo refresh
    const newRefresh = generateRefreshToken();
    const newRefreshHash = hashToken(newRefresh);
    const newRefreshExpiresAt = new Date(Date.now() + getRefreshDays() * 24 * 60 * 60 * 1000);

    await prisma.refreshToken.create({
      data: {
        userId: stored.userId,
        tokenHash: newRefreshHash,
        expiresAt: newRefreshExpiresAt,
      },
    });

    res.cookie("refresh_token", newRefresh, refreshCookieOptions());

    // ✅ assina accessToken no padrão esperado pelo authMiddleware (issuer/audience/subject)
    const secret = getJwtSecret();
    const expiresIn = getJwtExpiresIn();
    const issuer = getJwtIssuer();
    const audience = getJwtAudience();

    const newAccessToken = jwt.sign(
      { email: user.email }, // payload consistente
      secret,
      {
        expiresIn,
        issuer,
        audience,
        subject: stored.userId, // sub vai aqui (padrão jwt)
      }
    );

    const decodedAccess = jwt.decode(newAccessToken) as jwt.JwtPayload | null;
    const expMs = decodedAccess?.exp ? decodedAccess.exp * 1000 : Date.now();
    const expiresUtc = new Date(expMs).toISOString();

    return res.json({
      accessToken: newAccessToken,
      expiresUtc,
    });
  };

  logout = async (req: Request, res: Response) => {
    const rt = (req as any).cookies?.refresh_token as string | undefined;

    if (rt) {
      const rtHash = hashToken(rt);
      await prisma.refreshToken.updateMany({
        where: { tokenHash: rtHash },
        data: { revokedAt: new Date() },
      });
    }

    // precisa ser o mesmo path/options pra limpar
    res.clearCookie("refresh_token", refreshCookieOptions());
    return res.json({ ok: true });
  };
}