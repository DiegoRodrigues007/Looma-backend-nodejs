
import type { IgUserId } from "../value-objects/IgUserId";

export type InstagramAccount = {
  id: string; 
  userId: string; 
  igUserId: IgUserId;
  username?: string | null;
  connectedAt: Date;
  isActive: boolean;
};
