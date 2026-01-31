import { IUserRepository } from "../../ports/db/IUserRepository";
import {
  IInstagramAccountRepository,
  InstagramAccountListDTO,
} from "../../ports/db/IInstagramAccountRepository";

export type InstagramAccountListItem = InstagramAccountListDTO & {
  isActive: boolean;
};

export type ListInstagramAccountsResult = {
  ok: true;
  activeInstagramAccountId: string | null;
  total: number;
  accounts: InstagramAccountListItem[];
};

export class ListInstagramAccountsUseCase {
  constructor(
    private readonly userRepo: IUserRepository,
    private readonly instagramAccountRepo: IInstagramAccountRepository
  ) {}

  async execute(userId: string): Promise<ListInstagramAccountsResult> {
    const uid = String(userId ?? "").trim();

    if (!uid) {
      return {
        ok: true,
        activeInstagramAccountId: null,
        total: 0,
        accounts: [],
      };
    }

    const [activeFromUser, rows] = await Promise.all([
      this.userRepo.getActiveInstagramAccountId(uid),
      this.instagramAccountRepo.listByUser(uid),
    ]);

    let activeId = activeFromUser ?? null;

    const activeExistsInRows = activeId
      ? rows.some((r) => r.id === activeId)
      : false;

    if ((!activeId || !activeExistsInRows) && rows.length > 0) {
      activeId = rows[0].id;

      await this.userRepo.setActiveInstagramAccountId(uid, activeId);
    }

    return {
      ok: true,
      activeInstagramAccountId: activeId,
      total: rows.length,
      accounts: rows.map((r) => ({
        ...r,
        isActive: activeId ? r.id === activeId : false,
      })),
    };
  }
}
