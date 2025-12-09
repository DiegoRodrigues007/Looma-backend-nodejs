import { IUserRepository } from "../../../domain/repositories/IUserRepository";
import { Result } from "../../common/Result";

export interface GetCurrentUserInput {
  userId: string;
}

export interface CurrentUserDTO {
  id: string;
  email: string;
  userName?: string | null;
  name: string;
  createdAt: string;
}

export class GetCurrentUserUseCase {
  constructor(private readonly userRepo: IUserRepository) {}

  async execute(input: GetCurrentUserInput): Promise<Result<CurrentUserDTO>> {
    const user = await this.userRepo.findById(input.userId);
    if (!user) return Result.fail<CurrentUserDTO>("Usuário não encontrado");

    return Result.ok<CurrentUserDTO>({
      id: user.id,
      email: user.email,
      userName: user.userName,
      name: user.name,
      createdAt: user.createdAt.toISOString()
    });
  }
}
