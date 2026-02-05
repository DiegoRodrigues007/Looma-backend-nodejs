import { Request, Response } from "express";
import { prisma } from "../../../../infrastructure/db/prismaClient";

import { CompleteIgLoginUseCase } from "../../../../application/use-cases/instagram/CompleteIgLoginUseCase";

import { s, getAuthenticatedUserId, safeDate } from "./helpers/auth";
import { safeJson } from "./helpers/http";
import { candidatesOrderBy } from "./helpers/candidates";

import { safeParseState } from "../../instagram/instagramState";

export class InstagramCandidatesController {
  constructor(private readonly completeLogin: CompleteIgLoginUseCase) {}

  // =========================
  // LISTAR CANDIDATES
  // =========================
  async candidates(req: Request, res: Response) {
    res.setHeader("Cache-Control", "no-store");

    const userId = getAuthenticatedUserId(req);
    if (!userId) {
      return safeJson(res, 401, { ok: false, message: "Não autenticado" });
    }

    const selectionId = s((req.query as any)?.selectionId);
    if (!selectionId) {
      return safeJson(res, 400, {
        ok: false,
        message: "selectionId é obrigatório",
      });
    }

    // ✅ FORMA CORRETA: state é obrigatório quando requireState=true
    const state = s((req.query as any)?.state);
    if (!state) {
      return safeJson(res, 400, {
        ok: false,
        message: "state é obrigatório",
      });
    }

    // ✅ valida assinatura/expiração do state e garante que pertence ao mesmo usuário
    const parsed = safeParseState(state) as any;
    const uidFromState = parsed?.uid ? String(parsed.uid) : null;

    if (!uidFromState || uidFromState !== s(userId)) {
      return safeJson(res, 401, {
        ok: false,
        message: "state inválido ou não pertence ao usuário",
      });
    }

    const rows = await prisma.instagramCandidate.findMany({
      where: {
        userId: s(userId),
        selectionId,
      },
      orderBy: candidatesOrderBy(),
      take: 50,
      select: {
        id: true,
        igUserId: true,
        username: true,
        accountType: true,
        facebookPageId: true,
        facebookPageName: true,
        source: true,
        instagramAccountId: true,
        createdAt: true,
        selectedAt: true,
      },
    });

    return safeJson(res, 200, {
      ok: true,
      selectionId,
      total: rows.length,
      candidates: rows,
    });
  }

  // =========================
  // CONFIRMAR SELEÇÃO
  // =========================
  async confirm(req: Request, res: Response) {
    res.setHeader("Cache-Control", "no-store");

    const userId = getAuthenticatedUserId(req);
    if (!userId) {
      return safeJson(res, 401, {
        ok: false,
        message: "Não autenticado",
      });
    }

    const { selectionId, igUserIds, state } = req.body as {
      selectionId?: string;
      igUserIds?: string[];
      state?: string;
    };

    if (!selectionId || !Array.isArray(igUserIds) || igUserIds.length === 0) {
      return safeJson(res, 400, {
        ok: false,
        message: "selectionId e igUserIds[] são obrigatórios",
      });
    }

    // ✅ FORMA CORRETA: state obrigatório
    if (!state) {
      return safeJson(res, 400, {
        ok: false,
        message: "state é obrigatório",
      });
    }

    // ✅ valida assinatura/expiração e garante que pertence ao usuário logado
    const parsed = safeParseState(String(state)) as any;
    const uidFromState = parsed?.uid ? String(parsed.uid) : null;

    if (!uidFromState || uidFromState !== s(userId)) {
      return safeJson(res, 401, {
        ok: false,
        message: "state inválido ou não pertence ao usuário",
      });
    }

    const candidates = await prisma.instagramCandidate.findMany({
      where: {
        userId: s(userId),
        selectionId,
        igUserId: { in: igUserIds.map(s) },
      },
    });

    if (candidates.length === 0) {
      return safeJson(res, 404, {
        ok: false,
        message: "Nenhum candidato encontrado para confirmação",
      });
    }

    const selections = candidates.map((c) => ({
      igUserId: s(c.igUserId),
      facebookPageId: s(c.facebookPageId),
    }));

    // ✅ AJUSTE PRINCIPAL: passar state para bater com requireState=true
    const results = await this.completeLogin.confirmSelection({
      selectionId,
      userId: s(userId),
      selections,
      state: String(state),
    });

    if (!results.length) {
      return safeJson(res, 400, {
        ok: false,
        message: "Falha ao confirmar seleção",
      });
    }

    const confirmedAccounts: any[] = [];

    for (const r of results) {
      const igUserId = s(r.igUserId);
      const facebookPageId = s(r.facebookPageId);
      const accessToken = s(r.accessToken);
      const pageAccessToken = s(r.pageAccessToken);

      if (!igUserId || !facebookPageId || !accessToken || !pageAccessToken) {
        continue;
      }

      const expiresAt = safeDate(r.expiresAt);

      // ✅ BUSCA MANUAL (sem upsert inválido)
      const existing = await prisma.instagramAccount.findFirst({
        where: {
          userId: s(userId),
          igUserId,
          facebookPageId,
        },
        select: { id: true },
      });

      const data = {
        userId: s(userId),
        igUserId,
        facebookPageId,
        accessToken,
        pageAccessToken,
        expiresAt,
        username: r.username ? s(r.username) : null,
        accountType: r.accountType ? s(r.accountType) : null,
        isConnected: true,
      };

      const account = existing
        ? await prisma.instagramAccount.update({
            where: { id: existing.id },
            data,
          })
        : await prisma.instagramAccount.create({
            data,
          });

      confirmedAccounts.push(account);

      await prisma.instagramCandidate.updateMany({
        where: {
          userId: s(userId),
          selectionId,
          igUserId,
          facebookPageId,
        },
        data: {
          selectedAt: new Date(),
          instagramAccountId: account.id,
        },
      });
    }

    if (confirmedAccounts.length > 0) {
      await prisma.user.update({
        where: { id: s(userId) },
        data: { activeInstagramAccountId: confirmedAccounts[0].id },
      });
    }

    return safeJson(res, 200, {
      ok: true,
      selectionId,
      activeInstagramAccountId: confirmedAccounts[0]?.id ?? null,
      confirmed: confirmedAccounts,
    });
  }
}
