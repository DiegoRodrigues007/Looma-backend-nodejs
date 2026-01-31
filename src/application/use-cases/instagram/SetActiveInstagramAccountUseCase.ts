import { IUserRepository } from "../../ports/db/IUserRepository";
import { IInstagramAccountRepository } from "../../ports/db/IInstagramAccountRepository";

export type SetActiveInstagramAccountInput = {
  userId: string;
  instagramAccountId: string;
};

export type SetActiveInstagramAccountResult =
  | {
      ok: true;
      activeInstagramAccountId: string;
      account: {
        id: string;
        igUserId: string;
      };
    }
  | {
      ok: false;
      message: string;
      code:
        | "UNAUTHENTICATED"
        | "INVALID_INPUT"
        | "NOT_FOUND"
        | "NOT_CONNECTED";
    };

export class SetActiveInstagramAccountUseCase {
  constructor(
    private readonly userRepo: IUserRepository,
    private readonly instagramAccountRepo: IInstagramAccountRepository
  ) {}

  async execute(
    input: SetActiveInstagramAccountInput
  ): Promise<SetActiveInstagramAccountResult> {
    const uid = String(input?.userId ?? "").trim();
    if (!uid) {
      return { ok: false, code: "UNAUTHENTICATED", message: "Não autenticado" };
    }

    const accId = String(input?.instagramAccountId ?? "").trim();
    if (!accId) {
      return {
        ok: false,
        code: "INVALID_INPUT",
        message: "instagramAccountId é obrigatório",
      };
    }

    const account = await this.instagramAccountRepo.findConnectedById(uid, accId);

    if (!account) {
      return {
        ok: false,
        code: "NOT_FOUND",
        message: "Conta Instagram não encontrada para este usuário",
      };
    }

    const hasToken = Boolean(account.pageAccessToken) || Boolean(account.accessToken);

    if (!account.isConnected || !hasToken) {
      return {
        ok: false,
        code: "NOT_CONNECTED",
        message: "Conta Instagram não está conectada",
      };
    }

    await this.userRepo.setActiveInstagramAccountId(uid, account.id);

    return {
      ok: true,
      activeInstagramAccountId: account.id,
      account: {
        id: account.id,
        igUserId: account.igUserId ?? "",
      },
    };
  }
}
