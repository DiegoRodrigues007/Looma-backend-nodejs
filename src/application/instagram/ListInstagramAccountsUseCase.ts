// src/application/instagram/ListInstagramAccountsUseCase.ts
import { prisma } from "../../infrastructure/db/prismaClient";

export type InstagramAccountListItem = {
  id: string;
  igUserId: string;
  username: string | null;
  accountType: string | null;
  facebookPageId: string | null;
  expiresAt: Date | null;
  isConnected: boolean;
  updatedAt: Date;
  isActive: boolean;
};

export type ListInstagramAccountsResult = {
  ok: true;
  activeInstagramAccountId: string | null;
  total: number;
  accounts: InstagramAccountListItem[];
};

export class ListInstagramAccountsUseCase {
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

    const user = await prisma.user.findUnique({
      where: { id: uid },
      select: { activeInstagramAccountId: true },
    });

    const rows = await prisma.instagramAccount.findMany({
      where: {
        userId: uid,
        isConnected: true,
        OR: [{ pageAccessToken: { not: null } }, { accessToken: { not: null } }],
      },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        igUserId: true,
        username: true,
        accountType: true,
        facebookPageId: true,
        expiresAt: true,
        isConnected: true,
        updatedAt: true,
      },
      take: 50,
    });

    // ✅ Se não tem ativa e tem contas, define a mais recente como ativa
    let activeId = user?.activeInstagramAccountId ?? null;

    // Se activeId existir mas não estiver mais na lista (ex: desconectou), recalcula
    const activeExistsInRows = activeId ? rows.some((r) => r.id === activeId) : false;

    if ((!activeId || !activeExistsInRows) && rows.length > 0) {
      activeId = rows[0].id;
      await prisma.user.update({
        where: { id: uid },
        data: { activeInstagramAccountId: activeId },
      });
    }

    return {
      ok: true,
      activeInstagramAccountId: activeId,
      total: rows.length,
      accounts: rows.map((r) => ({
        id: r.id,
        igUserId: r.igUserId,
        username: r.username ?? null,
        accountType: r.accountType ?? null,
        facebookPageId: r.facebookPageId ?? null,
        expiresAt: r.expiresAt ?? null,
        isConnected: r.isConnected,
        updatedAt: r.updatedAt,
        isActive: activeId ? r.id === activeId : false,
      })),
    };
  }
}
