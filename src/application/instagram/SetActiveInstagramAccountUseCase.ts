// src/application/instagram/SetActiveInstagramAccountUseCase.ts
import { prisma } from "../../infrastructure/db/prismaClient";

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
        username: string | null;
        accountType: string | null;
        facebookPageId: string | null;
        updatedAt: Date;
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

    const account = await prisma.instagramAccount.findFirst({
      where: {
        id: accId,
        userId: uid,
      },
      select: {
        id: true,
        igUserId: true,
        username: true,
        accountType: true,
        facebookPageId: true,
        isConnected: true,
        updatedAt: true,
        accessToken: true,
        pageAccessToken: true,
      },
    });

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

    await prisma.user.update({
      where: { id: uid },
      data: { activeInstagramAccountId: account.id },
    });

    return {
      ok: true,
      activeInstagramAccountId: account.id,
      account: {
        id: account.id,
        igUserId: account.igUserId,
        username: account.username ?? null,
        accountType: account.accountType ?? null,
        facebookPageId: account.facebookPageId ?? null,
        updatedAt: account.updatedAt,
      },
    };
  }
}
