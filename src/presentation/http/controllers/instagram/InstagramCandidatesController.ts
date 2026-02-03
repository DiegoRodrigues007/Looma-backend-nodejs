import { Request, Response } from "express";
import { prisma } from "../../../../infrastructure/db/prismaClient";

import { CompleteIgLoginUseCase } from "../../../../application/use-cases/instagram/CompleteIgLoginUseCase";

import { s, getAuthenticatedUserId, safeDate } from "./helpers/auth";
import { safeJson } from "./helpers/http";
import { candidatesOrderBy } from "./helpers/candidates";

export class InstagramCandidatesController {
  constructor(
    private readonly completeLogin: CompleteIgLoginUseCase,
  ) {}

  async candidates(req: Request, res: Response) {
    res.setHeader("Cache-Control", "no-store");

    const userId = getAuthenticatedUserId(req);
    if (!userId)
      return safeJson(res, 401, { ok: false, message: "Não autenticado" });

    let selectionId = s((req.query as any)?.selectionId);

    if (!selectionId) {
      const last = await prisma.instagramCandidate.findFirst({
        where: { userId: s(userId) },
        orderBy: candidatesOrderBy(),
        select: { selectionId: true },
      });
      selectionId = s(last?.selectionId);
    }

    const rows = await prisma.instagramCandidate.findMany({
      where: { userId: s(userId), ...(selectionId ? { selectionId } : {}) },
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
      selectionId: selectionId || null,
      total: rows.length,
      candidates: rows,
    });
  }

  async confirm(req: Request, res: Response) {
    res.setHeader("Cache-Control", "no-store");

    const userId = getAuthenticatedUserId(req);
    if (!userId) {
      return safeJson(res, 401, {
        ok: false,
        code: "UNAUTHENTICATED",
        message: "Não autenticado",
      });
    }

    const body = req.body as Record<string, unknown>;

    const selectionId = s(body.selectionId);
    const igUserIdsRaw = body.igUserIds;
    const candidateIdsRaw = body.candidateIds;

    const igUserIds: string[] = Array.isArray(igUserIdsRaw)
      ? igUserIdsRaw.map((x) => s(x)).filter(Boolean)
      : [];

    const candidateIds: string[] = Array.isArray(candidateIdsRaw)
      ? candidateIdsRaw.map((x) => s(x)).filter(Boolean)
      : [];

    if (!selectionId) {
      return safeJson(res, 400, {
        ok: false,
        code: "INVALID_INPUT",
        message: "selectionId é obrigatório",
      });
    }

    if (igUserIds.length === 0 && candidateIds.length === 0) {
      return safeJson(res, 400, {
        ok: false,
        code: "INVALID_INPUT",
        message: "Envie igUserIds[] (recomendado) ou candidateIds[]",
      });
    }

    const candidates = await prisma.instagramCandidate.findMany({
      where: { userId: s(userId), selectionId },
      orderBy: candidatesOrderBy(),
      take: 200,
    });

    const selected = candidates.filter((c) => {
      const byIg = igUserIds.length > 0 ? igUserIds.includes(s(c.igUserId)) : false;
      const byId = candidateIds.length > 0 ? candidateIds.includes(s(c.id)) : false;
      return byIg || byId;
    });

    if (selected.length === 0) {
      return safeJson(res, 404, {
        ok: false,
        code: "NOT_FOUND",
        message:
          "Nenhum candidato encontrado para confirmar (selectionId/seleção inválidos).",
      });
    }

    const selections = selected
      .map((c) => ({
        igUserId: s(c.igUserId),
        facebookPageId: s(c.facebookPageId),
      }))
      .filter((x) => x.igUserId && x.facebookPageId);

    if (selections.length === 0) {
      return safeJson(res, 400, {
        ok: false,
        code: "INVALID_INPUT",
        message:
          "Candidatos selecionados não têm igUserId/facebookPageId válidos.",
      });
    }

    let results: Array<{
      igUserId: string;
      username: string;
      accountType: string;
      accessToken: string;
      expiresAt?: Date | string | null;
      facebookPageId?: string | null;
      pageAccessToken?: string | null;
    }> = [];

    try {
      results = await this.completeLogin.confirmSelection({
        selectionId,
        userId: s(userId),
        selections,
      });
    } catch (e) {
      const err = e as { message?: string };
      return safeJson(res, 400, {
        ok: false,
        code: "INVALID_INPUT",
        message: s(err?.message ?? "Falha ao confirmar seleção"),
      });
    }

    if (!results.length) {
      return safeJson(res, 400, {
        ok: false,
        code: "INVALID_INPUT",
        message: "Falha ao confirmar seleção (resultado vazio).",
      });
    }

    const createdOrUpdated: Array<{
      id: string;
      igUserId: string;
      username: string | null;
      accountType: string | null;
      facebookPageId: string | null;
      isConnected: boolean;
      updatedAt: Date;
      expiresAt: Date | null;
    }> = [];

    for (const r of results) {
      const igUserId = s(r.igUserId);
      const facebookPageId = s(r.facebookPageId);
      const pageAccessToken = s(r.pageAccessToken);
      const accessToken = s(r.accessToken);

      if (!igUserId || !facebookPageId || !pageAccessToken || !accessToken) continue;

      const existing = await prisma.instagramAccount.findFirst({
        where: { userId: s(userId), igUserId },
        select: { id: true },
      });

      const expiresAt = safeDate(r.expiresAt);

      const dataToSet: any = {
        userId: s(userId),
        igUserId,
        facebookPageId,
        pageAccessToken,
        accessToken,
        expiresAt,
        username: r.username ? s(r.username) : null,
        accountType: r.accountType ? s(r.accountType) : null,
        isConnected: true,
      };

      const acc = existing?.id
        ? await prisma.instagramAccount.update({
            where: { id: existing.id },
            data: dataToSet,
            select: {
              id: true,
              igUserId: true,
              username: true,
              accountType: true,
              facebookPageId: true,
              isConnected: true,
              updatedAt: true,
              expiresAt: true,
            },
          })
        : await prisma.instagramAccount.create({
            data: dataToSet,
            select: {
              id: true,
              igUserId: true,
              username: true,
              accountType: true,
              facebookPageId: true,
              isConnected: true,
              updatedAt: true,
              expiresAt: true,
            },
          });

      createdOrUpdated.push(acc);

      try {
        await prisma.instagramCandidate.updateMany({
          where: { userId: s(userId), selectionId, igUserId },
          data: {
            selectedAt: new Date(),
            instagramAccountId: acc.id,
          },
        });
      } catch {}
    }

    if (createdOrUpdated.length === 0) {
      return safeJson(res, 400, {
        ok: false,
        code: "INVALID_INPUT",
        message:
          "Contas confirmadas não puderam ser persistidas (tokens inválidos/ausentes).",
      });
    }

    const user = await prisma.user.findUnique({
      where: { id: s(userId) },
      select: { activeInstagramAccountId: true },
    });

    let activeInstagramAccountId = user?.activeInstagramAccountId ?? null;

    if (!activeInstagramAccountId) {
      activeInstagramAccountId = createdOrUpdated[0].id;
      try {
        await prisma.user.update({
          where: { id: s(userId) },
          data: { activeInstagramAccountId },
        });
      } catch {}
    }

    return safeJson(res, 200, {
      ok: true,
      selectionId,
      activeInstagramAccountId,
      confirmed: createdOrUpdated,
    });
  }
}
