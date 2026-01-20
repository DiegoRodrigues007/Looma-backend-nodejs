import type { IPostInsightsProvider } from "../../../application/ports/insights/IPostInsightsProvider";
import { InstagramPostInsightsService } from "../services/InstagramPostInsightsService";

export class InstagramPostInsightsProvider implements IPostInsightsProvider {
  constructor(private readonly svc = new InstagramPostInsightsService()) {}

  fetchPostById(params: { accessToken: string; postId: string }) {
    return this.svc.fetchPostById(params);
  }

  fetchBaselineMedia(params: {
    accessToken: string;
    igUserId: string;
    from: string;
    to: string;
    limit: number;
  }) {
    return this.svc.fetchBaselineMedia(params);
  }
}
