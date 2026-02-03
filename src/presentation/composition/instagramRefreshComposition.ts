import { PrismaUserRepository } from "../../infrastructure/db/repositories/user/PrismaUserRepository";
import { PrismaInstagramAccountRepository } from "../../infrastructure/db/repositories/instagram/PrismaInstagramAccountRepository";

import { InstagramIgLoginClient } from "../../infrastructure/instagram/clients/InstagramIgLoginClient";
import { InstagramIgLoginAuthService } from "../../application/services/instagram/InstagramIgLoginAuthService";

import { RefreshInstagramTokenUseCase } from "../../application/use-cases/instagram/RefreshInstagramTokenUseCase";
import { InstagramRefreshController } from "../http/controllers/instagram/InstagramRefreshController";

export function makeInstagramRefreshController() {
  const userRepo = new PrismaUserRepository();
  const instagramAccountRepo = new PrismaInstagramAccountRepository();

  const igClient = new InstagramIgLoginClient();
  const authService = new InstagramIgLoginAuthService(igClient);

  const useCase = new RefreshInstagramTokenUseCase(
    userRepo,
    instagramAccountRepo,
    authService
  );

  return new InstagramRefreshController(useCase);
}
