import { Request, Response } from "express";
import { RegisterUserUseCase } from "../../../application/use-cases/auth/RegisterUserUseCase";
import { LoginUserUseCase } from "../../../application/use-cases/auth/LoginUserUseCase";
import { GetCurrentUserUseCase } from "../../../application/use-cases/auth/GetCurrentUserUseCase";

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
    const result = await this.loginUseCase.execute(req.body);
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
