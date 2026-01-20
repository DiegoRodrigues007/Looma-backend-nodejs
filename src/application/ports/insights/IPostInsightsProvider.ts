export type IgMediaWithInsights = any; 

export interface IPostInsightsProvider {
  fetchPostById(params: { accessToken: string; postId: string }): Promise<any | null>;

  fetchBaselineMedia(params: {
    accessToken: string;
    igUserId: string;
    from: string; 
    to: string;   
    limit: number;
  }): Promise<IgMediaWithInsights[]>;
}
