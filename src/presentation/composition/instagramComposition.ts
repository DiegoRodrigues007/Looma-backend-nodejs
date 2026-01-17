// src/presentation/composition/instagramComposition.ts
import { InstagramIgLoginClient } from "../../infrastructure/instagram/InstagramIgLoginClient";
import { InstagramIgLoginAuthService } from "../../infrastructure/instagram/InstagramIgLoginAuthService";
import { PrismaInstagramTokenStore } from "../../infrastructure/db/PrismaInstagramTokenStore";
import { CompleteIgLoginUseCase } from "../../application/instagram/CompleteIgLoginUseCase";
import { InstagramAuthController } from "../http/controllers/InstagramAuthController";

// ✅ NOVO: use cases multi-conta (conta ativa)
import { ListInstagramAccountsUseCase } from "../../application/instagram/ListInstagramAccountsUseCase";
import { SetActiveInstagramAccountUseCase } from "../../application/instagram/SetActiveInstagramAccountUseCase";

export function makeInstagramAuthController(): InstagramAuthController {
  const client = new InstagramIgLoginClient();
  const authService = new InstagramIgLoginAuthService(client);

  const tokenStore = new PrismaInstagramTokenStore();
  const completeLogin = new CompleteIgLoginUseCase(authService, tokenStore);

  // ✅ novos use cases (usam Prisma direto internamente)
  const listAccounts = new ListInstagramAccountsUseCase();
  const setActiveAccount = new SetActiveInstagramAccountUseCase();

  // ✅ controller agora recebe também os 2 use cases
  return new InstagramAuthController(
    authService,
    completeLogin,
    listAccounts,
    setActiveAccount
  );
}
