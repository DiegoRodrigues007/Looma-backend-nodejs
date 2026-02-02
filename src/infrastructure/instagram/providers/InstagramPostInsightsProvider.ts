import type { IPostInsightsProvider } from "../../../application/interfaces/insights/IPostInsightsProvider";
import type { IInstagramGraphClient } from "../../../application/interfaces/instagram/IInstagramGraphClient";
import { InstagramPostInsightsService } from "../../../application/services/instagram/InstagramPostInsightsService";

export class InstagramPostInsightsProvider implements IPostInsightsProvider {
  private readonly svc: InstagramPostInsightsService;

  constructor(igClient: IInstagramGraphClient) {
    this.svc = new InstagramPostInsightsService(igClient);
  }

  fetchPostById(params: { accessToken: string; postId: string; igUserId: string }) {
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
