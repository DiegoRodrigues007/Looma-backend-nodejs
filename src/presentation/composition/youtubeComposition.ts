import { GoogleYouTubeAuthService } from "../../infrastructure/youtube/GoogleYouTubeAuthService";
import { PrismaYouTubeTokenStore } from "../../infrastructure/db/PrismaYouTubeTokenStore";
import { CompleteYouTubeLoginUseCase } from "../../application/youtube/CompleteYouTubeLoginUseCase";
import { YouTubeAuthController } from "../http/controllers/YouTubeAuthController";

export function makeYouTubeAuthController(): YouTubeAuthController {
  const authService = new GoogleYouTubeAuthService();
  const tokenStore = new PrismaYouTubeTokenStore();
  const completeLogin = new CompleteYouTubeLoginUseCase(authService, tokenStore);

  return new YouTubeAuthController(authService, completeLogin);
}
