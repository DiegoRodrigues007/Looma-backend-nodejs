import { IUserRepository } from "../../../domain/repositories/IUserRepository";
import { IPasswordHasher } from "../../../domain/services/IPasswordHasher";
import { ITokenService } from "../../../domain/services/ITokenService";
import { LoginUserDTO } from "../../dto/auth/LoginUserDTO";
import { AuthResultDTO } from "../../dto/auth/AuthResultDTO";
import { Result } from "../../common/Result";
import { randomUUID } from "crypto";

export class LoginUserUseCase {
  constructor(
    private readonly userRepo: IUserRepository,
    private readonly passwordHasher: IPasswordHasher,
    private readonly tokenService: ITokenService
  ) {}

  async execute(input: LoginUserDTO): Promise<Result<AuthResultDTO>> {
    const user = await this.userRepo.findByEmailOrUserName(input.emailOrUserName);
    if (!user) return Result.fail<AuthResultDTO>("Credenciais inválidas");

    const ok = await this.passwordHasher.compare(input.password, user.passwordHash);
    if (!ok) return Result.fail<AuthResultDTO>("Credenciais inválidas");

    const access = this.tokenService.createAccessToken({
      userId: user.id,
      email: user.email
    });

    const refreshToken = randomUUID().replace(/-/g, "");

    return Result.ok<AuthResultDTO>({
      accessToken: access.token,
      expiresUtc: access.expiresAt.toISOString(),
      refreshToken
    });
  }
}
