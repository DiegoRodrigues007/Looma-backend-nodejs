// src/presentation/composition/instagramRefreshComposition.ts

import { prisma } from "../../infrastructure/db/prismaClient";

import { InstagramRefreshController } from "../http/controllers/InstagramRefreshController";
import { RefreshInstagramTokenUseCase } from "../../application/use-cases/instagram/RefreshInstagramTokenUseCase";
import { makeInstagramIgLoginAuthService } from "./instagramComposition";

export function makeInstagramRefreshController() {
  const auth = makeInstagramIgLoginAuthService();

  // ✅ agora precisa de (prisma, auth)
  const useCase = new RefreshInstagramTokenUseCase(prisma, auth);

  return new InstagramRefreshController(useCase);
}