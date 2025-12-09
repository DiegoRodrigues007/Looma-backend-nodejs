import { InstagramIgLoginClient } from "../../infrastructure/instagram/InstagramIgLoginClient";
import { InstagramIgLoginAuthService } from "../../infrastructure/instagram/InstagramIgLoginAuthService";
import { PrismaInstagramTokenStore } from "../../infrastructure/db/PrismaInstagramTokenStore";
import { CompleteIgLoginUseCase } from "../../application/instagram/CompleteIgLoginUseCase";
import { InstagramAuthController } from "../../presentation/http/controllers/InstagramAuthController";


export function makeInstagramAuthController(): InstagramAuthController {
  const client = new InstagramIgLoginClient();
  const authService = new InstagramIgLoginAuthService(client);
  const tokenStore = new PrismaInstagramTokenStore();
  const completeLogin = new CompleteIgLoginUseCase(authService, tokenStore);

  return new InstagramAuthController(authService, completeLogin);
}
