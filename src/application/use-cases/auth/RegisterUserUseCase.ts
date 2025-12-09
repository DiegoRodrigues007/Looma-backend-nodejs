import { IUserRepository } from "../../../domain/repositories/IUserRepository";
import { IPasswordHasher } from "../../../domain/services/IPasswordHasher";
import { ITokenService } from "../../../domain/services/ITokenService";
import { RegisterUserDTO } from "../../dto/auth/RegisterUserDTO";
import { AuthResultDTO } from "../../dto/auth/AuthResultDTO";
import { Result } from "../../common/Result";
import { User } from "../../../domain/entities/User";
import { randomUUID } from "crypto";

export class RegisterUserUseCase {
  constructor(
    private readonly userRepo: IUserRepository,
    private readonly passwordHasher: IPasswordHasher,
    private readonly tokenService: ITokenService
  ) {}

  async execute(input: RegisterUserDTO): Promise<Result<AuthResultDTO>> {
    const existing = await this.userRepo.findByEmailOrUserName(input.email);
    if (existing) {
      return Result.fail<AuthResultDTO>("Email ou usuário já cadastrado");
    }

    const passwordHash = await this.passwordHasher.hash(input.password);

    const now = new Date();
    const id = randomUUID();

    const user = User.create(
      {
        email: input.email,
        userName: input.userName,
        name: input.name,
        passwordHash
      },
      id,
      now
    );

    await this.userRepo.create(user);

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
