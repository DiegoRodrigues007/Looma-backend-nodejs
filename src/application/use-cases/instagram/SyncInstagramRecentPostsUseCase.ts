import type { IUserRepository } from "../../interfaces/db/IUserRepository";
import type { IInstagramAccountRepository } from "../../interfaces/db/IInstagramAccountRepository";
import type { IInstagramPostRepository } from "../../interfaces/db/IInstagramPostRepository";
import type {
  IInstagramGraphClient,
  InstagramMediaItem,
} from "../../interfaces/instagram/IInstagramGraphClient";

function s(v: any): string {
  return String(v ?? "").trim();
}

function splitScopes(v: any): string[] {
  return s(v)
    .split(/[,\s]+/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

export type SyncRecentPostsParams = {
  userId: string;
  instagramAccountId?: string | null;
  limit?: number;
  deleteOldBeyondLimit?: boolean;
};

export type SyncRecentPostsResult = {
  ok: true;
  instagramAccountIdUsed: string;
  fetched: number;
  upserted: number;
  deletedOld: number;
};

export class SyncInstagramRecentPostsUseCase {
  constructor(
    private readonly userRepo: IUserRepository,
    private readonly accountRepo: IInstagramAccountRepository,
    private readonly postRepo: IInstagramPostRepository,
    private readonly igClient: IInstagramGraphClient
  ) {}

  async execute(params: SyncRecentPostsParams): Promise<SyncRecentPostsResult> {
    const userId = s(params.userId);
    if (!userId) throw new Error("userId é obrigatório");

    const limit = Math.max(1, Math.min(50, Number(params.limit ?? 20) || 20));
    const deleteOldBeyondLimit = params.deleteOldBeyondLimit ?? true;

    const user = await this.userRepo.getById(userId);
    const desiredAccountId =
      s(params.instagramAccountId ?? "") || s(user?.activeInstagramAccountId ?? "");

    const account =
      (desiredAccountId
        ? await this.accountRepo.findConnectedById(userId, desiredAccountId)
        : null) || (await this.accountRepo.findLatestConnected(userId));

    if (!account) {
      throw new Error("Conta do Instagram não encontrada");
    }

    const instagramAccountIdUsed = account.id;

    const igUserId = s(account.igUserId);
    const pageAccessToken = s(account.pageAccessToken) || s(account.accessToken);

    if (!igUserId || !pageAccessToken) {
      throw new Error("Conta IG sem igUserId/token válido. Refaça a conexão.");
    }

    const grantedRaw = account.grantedScopes;
    const granted = splitScopes(grantedRaw);

    if (grantedRaw != null && granted.length > 0) {
      const required = [
        "instagram_basic",
        "instagram_manage_insights",
        "pages_show_list",
        "pages_read_engagement",
        "pages_read_user_content",
      ];

      const missing = required.filter((r) => !granted.includes(r));
      if (missing.length > 0) {
        throw new Error(`reauth required: missing scopes: ${missing.join(", ")}`);
      }
    }

    const items: InstagramMediaItem[] = await this.igClient.getRecentMedia({
      igUserId,
      accessToken: pageAccessToken,
      limit,
    });

    if (items.length === 0) {
      return {
        ok: true,
        instagramAccountIdUsed,
        fetched: 0,
        upserted: 0,
        deletedOld: 0,
      };
    }

    const upserted = await this.postRepo.upsertRecentFromMediaItems({
      userId,
      instagramAccountId: instagramAccountIdUsed,
      items,
    });

    let deletedOld = 0;
    if (deleteOldBeyondLimit) {
      const keep = items.map((x) => s(x.id)).filter(Boolean);
      deletedOld = await this.postRepo.deleteOldBeyondKeepList({
        userId,
        instagramAccountId: instagramAccountIdUsed,
        keepIgMediaIds: keep,
      });
    }

    return {
      ok: true,
      instagramAccountIdUsed,
      fetched: items.length,
      upserted,
      deletedOld,
    };
  }
}
