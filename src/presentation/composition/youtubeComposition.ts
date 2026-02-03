import { GoogleYouTubeAuthService } from "../../infrastructure/youtube/GoogleYouTubeAuthService";
import { PrismaYouTubeTokenStore } from "../../infrastructure/db/repositories/youtube/PrismaYouTubeTokenStore";
import { CompleteYouTubeLoginUseCase } from "../../application/use-cases/youtube/CompleteYouTubeLoginUseCase";
import { YouTubeAuthController } from "../http/controllers/youtube/YouTubeAuthController";

export function makeYouTubeAuthController(): YouTubeAuthController {
  const authService = new GoogleYouTubeAuthService();
  const tokenStore = new PrismaYouTubeTokenStore();
  const completeLogin = new CompleteYouTubeLoginUseCase(authService, tokenStore);

  return new YouTubeAuthController(authService, completeLogin);
}
