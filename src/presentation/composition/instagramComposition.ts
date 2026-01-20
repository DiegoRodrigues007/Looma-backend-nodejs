import { prisma } from "../../infrastructure/db/prismaClient";

import { InstagramIgLoginClient } from "../../infrastructure/instagram/clients/InstagramIgLoginClient";
import { InstagramIgLoginAuthService } from "../../infrastructure/instagram/services/InstagramIgLoginAuthService";
import { PrismaInstagramTokenStore } from "../../infrastructure/db/PrismaInstagramTokenStore";
import { CompleteIgLoginUseCase } from "../../application/use-cases/instagram/CompleteIgLoginUseCase";
import { InstagramAuthController } from "../http/controllers/InstagramAuthController";

import { ListInstagramAccountsUseCase } from "../../application/use-cases/instagram/ListInstagramAccountsUseCase";
import { SetActiveInstagramAccountUseCase } from "../../application/use-cases/instagram/SetActiveInstagramAccountUseCase";

import {
  GetInstagramDashboardMetricsUseCase,
  type BackfillDaysFn,
} from "../../application/use-cases/instagram/GetInstagramDashboardMetricsUseCase";

export function makeInstagramAuthController(): InstagramAuthController {
  const client = new InstagramIgLoginClient();
  const authService = new InstagramIgLoginAuthService(client);

  const tokenStore = new PrismaInstagramTokenStore();
  const completeLogin = new CompleteIgLoginUseCase(authService, tokenStore);

  const listAccounts = new ListInstagramAccountsUseCase();
  const setActiveAccount = new SetActiveInstagramAccountUseCase();

  const backfillDays: BackfillDaysFn = async () => {
    throw new Error(
      "backfillDays não foi injetado. O controller deve fornecer a função (ou mover para um service)."
    );
  };

  const dashboardMetrics = new GetInstagramDashboardMetricsUseCase(
    prisma,
    backfillDays
  );

  return new InstagramAuthController(
    authService,
    completeLogin,
    listAccounts,
    setActiveAccount,
    dashboardMetrics
  );
}
