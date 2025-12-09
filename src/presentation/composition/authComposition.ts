import { PrismaUserRepository } from "../../infrastructure/db/PrismaUserRepository";
import { BcryptPasswordHasher } from "../../infrastructure/security/BcryptPasswordHasher";
import { JwtTokenService } from "../../infrastructure/security/JwtTokenService";
import { RegisterUserUseCase } from "../../application/use-cases/auth/RegisterUserUseCase";
import { LoginUserUseCase } from "../../application/use-cases/auth/LoginUserUseCase";
import { GetCurrentUserUseCase } from "../../application/use-cases/auth/GetCurrentUserUseCase";
import { AuthController } from "../http/controllers/AuthController";

export function makeAuthController() {
  const userRepo = new PrismaUserRepository();
  const hasher = new BcryptPasswordHasher();
  const tokenService = new JwtTokenService();

  const registerUseCase = new RegisterUserUseCase(userRepo, hasher, tokenService);
  const loginUseCase = new LoginUserUseCase(userRepo, hasher, tokenService);
  const meUseCase = new GetCurrentUserUseCase(userRepo);

  return new AuthController(registerUseCase, loginUseCase, meUseCase);
}
