export type PersistPostInsightResultParams = {
  userId: string;
  instagramAccountId?: string | null;
  igUserId: string;
  postId: string; //
  postDbId?: string | null; 
  baselineDays: number;
  payloadJson: any; 
};

export interface IPostInsightResultRepository {
  upsertResult(params: PersistPostInsightResultParams): Promise<void>;
}
