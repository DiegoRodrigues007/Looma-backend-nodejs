import { Request, Response } from "express";
import { RegisterUserUseCase } from "../../../application/use-cases/auth/RegisterUserUseCase";
import { LoginUserUseCase } from "../../../application/use-cases/auth/LoginUserUseCase";
import { GetCurrentUserUseCase } from "../../../application/use-cases/auth/GetCurrentUserUseCase";

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

  // Se parecer email, normaliza
  if (value.includes("@")) return value.toLowerCase();

  return value;
}

export class AuthController {
  constructor(
    private readonly registerUseCase: RegisterUserUseCase,
    private readonly loginUseCase: LoginUserUseCase,
    private readonly meUseCase: GetCurrentUserUseCase
  ) {}

  register = async (req: Request, res: Response) => {
    const result = await this.registerUseCase.execute(req.body);
    if (!result.isSuccess) return res.status(400).json({ message: result.error });

    return res.status(201).json(result.value);
  };

  login = async (req: Request, res: Response) => {
    const emailOrUserName = pickEmailOrUserName(req.body);
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    if (!emailOrUserName || !password) {
      return res.status(400).json({ message: "Dados inválidos" });
    }

    // ✅ mantém compatibilidade com o use case atual
    const payload = { ...req.body, emailOrUserName, password };

    const result = await this.loginUseCase.execute(payload);
    if (!result.isSuccess) return res.status(400).json({ message: result.error });

    return res.json(result.value);
  };

  me = async (req: Request, res: Response) => {
    const userId = req.user?.sub;
    if (!userId) return res.status(401).json({ message: "Não autenticado" });

    const result = await this.meUseCase.execute({ userId });
    if (!result.isSuccess) return res.status(404).json({ message: result.error });

    return res.json(result.value);
  };
}
