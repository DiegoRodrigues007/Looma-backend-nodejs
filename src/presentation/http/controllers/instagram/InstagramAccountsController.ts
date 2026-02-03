import { Request, Response } from "express";
import { prisma } from "../../../../infrastructure/db/prismaClient";

import { ListInstagramAccountsUseCase } from "../../../../application/use-cases/instagram/ListInstagramAccountsUseCase";
import { SetActiveInstagramAccountUseCase } from "../../../../application/use-cases/instagram/SetActiveInstagramAccountUseCase";

import { s, getAuthenticatedUserId } from "./helpers/auth";
import { safeJson } from "./helpers/http";

function mapUseCaseCodeToHttp(code?: string): number {
  switch (code) {
    case "UNAUTHENTICATED":
      return 401;
    case "INVALID_INPUT":
      return 400;
    case "NOT_FOUND":
      return 404;
    case "NOT_CONNECTED":
      return 409;
    default:
      return 400;
  }
}

export class InstagramAccountsController {
  constructor(
    private readonly listAccounts: ListInstagramAccountsUseCase,
    private readonly setActiveAccount: SetActiveInstagramAccountUseCase,
  ) {}

  async status(req: Request, res: Response) {
    res.setHeader("Cache-Control", "no-store");

    const userId = getAuthenticatedUserId(req);
    if (!userId) {
      return safeJson(res, 401, { ok: false, message: "Não autenticado" });
    }

    const user = await prisma.user.findUnique({
      where: { id: s(userId) },
      select: { id: true, activeInstagramAccountId: true },
    });

    const accounts = await prisma.instagramAccount.findMany({
      where: { userId: s(userId), isConnected: true },
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

    let activeId = user?.activeInstagramAccountId ?? null;
    let active = activeId
      ? accounts.find((a) => a.id === activeId) ?? null
      : null;

    if ((!activeId || !active) && accounts.length > 0) {
      active = accounts[0];
      activeId = active.id;
      try {
        await prisma.user.update({
          where: { id: s(userId) },
          data: { activeInstagramAccountId: activeId },
        });
      } catch {}
    }

    return safeJson(res, 200, {
      ok: true,
      connected: accounts.length > 0,
      totalAccounts: accounts.length,
      activeInstagramAccountId: activeId,
      account: active
        ? {
            id: active.id,
            igUserId: active.igUserId,
            username: active.username ?? null,
            accountType: active.accountType ?? null,
            facebookPageId: active.facebookPageId ?? null,
            expiresAt: active.expiresAt ?? null,
            isConnected: active.isConnected,
            updatedAt: active.updatedAt,
          }
        : null,
    });
  }

  async accounts(req: Request, res: Response) {
    res.setHeader("Cache-Control", "no-store");

    const userId = getAuthenticatedUserId(req);
    if (!userId) {
      return safeJson(res, 401, { ok: false, message: "Não autenticado" });
    }

    if (this.listAccounts && typeof (this.listAccounts as any).execute === "function") {
      const out = await (this.listAccounts as any).execute(s(userId));
      return safeJson(res, 200, out);
    }

    const user = await prisma.user.findUnique({
      where: { id: s(userId) },
      select: { activeInstagramAccountId: true },
    });

    const rows = await prisma.instagramAccount.findMany({
      where: { userId: s(userId), isConnected: true },
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

    let activeId = user?.activeInstagramAccountId ?? null;
    const activeExists = activeId ? rows.some((r) => r.id === activeId) : false;

    if ((!activeId || !activeExists) && rows.length > 0) {
      activeId = rows[0].id;
      try {
        await prisma.user.update({
          where: { id: s(userId) },
          data: { activeInstagramAccountId: activeId },
        });
      } catch {}
    }

    return safeJson(res, 200, {
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
    });
  }

  async setActive(req: Request, res: Response) {
    res.setHeader("Cache-Control", "no-store");

    const userId = getAuthenticatedUserId(req);
    if (!userId) {
      return safeJson(res, 401, {
        ok: false,
        code: "UNAUTHENTICATED",
        message: "Não autenticado",
      });
    }

    const instagramAccountId = s(
      (req.body as Record<string, unknown>)?.instagramAccountId,
    );

    if (!instagramAccountId) {
      return safeJson(res, 400, {
        ok: false,
        code: "INVALID_INPUT",
        message: "instagramAccountId é obrigatório",
      });
    }

    if (
      this.setActiveAccount &&
      typeof (this.setActiveAccount as any).execute === "function"
    ) {
      const out = await (this.setActiveAccount as any).execute({
        userId: s(userId),
        instagramAccountId,
      });

      if (out && out.ok === false) {
        return safeJson(res, mapUseCaseCodeToHttp(out.code), out);
      }

      return safeJson(res, 200, { ok: true, ...out });
    }

    const exists = await prisma.instagramAccount.findFirst({
      where: {
        id: instagramAccountId,
        userId: s(userId),
        isConnected: true,
        OR: [{ pageAccessToken: { not: null } }, { accessToken: { not: null } }],
      },
      select: {
        id: true,
        igUserId: true,
        username: true,
        accountType: true,
        facebookPageId: true,
        updatedAt: true,
      },
    });

    if (!exists) {
      return safeJson(res, 404, {
        ok: false,
        code: "NOT_FOUND",
        message:
          "Conta Instagram não encontrada para este usuário (ou não está conectada).",
      });
    }

    await prisma.user.update({
      where: { id: s(userId) },
      data: { activeInstagramAccountId: exists.id },
    });

    return safeJson(res, 200, {
      ok: true,
      activeInstagramAccountId: exists.id,
      account: {
        id: exists.id,
        igUserId: exists.igUserId,
        username: exists.username ?? null,
        accountType: exists.accountType ?? null,
        facebookPageId: exists.facebookPageId ?? null,
        updatedAt: exists.updatedAt,
      },
    });
  }

  async disconnect(req: Request, res: Response) {
    res.setHeader("Cache-Control", "no-store");

    const userId = getAuthenticatedUserId(req);
    if (!userId) {
      return safeJson(res, 401, {
        ok: false,
        code: "UNAUTHENTICATED",
        message: "Não autenticado",
      });
    }

    const requestedId = s((req.body as Record<string, unknown>)?.instagramAccountId);

    const user = await prisma.user.findUnique({
      where: { id: s(userId) },
      select: { activeInstagramAccountId: true },
    });

    const instagramAccountId = requestedId || s(user?.activeInstagramAccountId);

    if (!instagramAccountId) {
      if (!res.headersSent) return res.status(204).send();
      return;
    }

    const acc = await prisma.instagramAccount.findFirst({
      where: { id: instagramAccountId, userId: s(userId) },
      select: { id: true },
    });

    if (!acc) {
      return safeJson(res, 404, {
        ok: false,
        code: "NOT_FOUND",
        message: "Conta não encontrada",
      });
    }

    await prisma.instagramAccount.update({
      where: { id: acc.id },
      data: {
        isConnected: false,
        accessToken: null,
        pageAccessToken: null,
        expiresAt: null,
        facebookPageId: null,
      },
    });

    await prisma.user.update({
      where: { id: s(userId) },
      data: { activeInstagramAccountId: null },
    });

    if (!res.headersSent) return res.status(204).send();
  }
}
