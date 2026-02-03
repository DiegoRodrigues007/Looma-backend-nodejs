import { Request, Response } from "express";
import crypto from "crypto";
import { prisma } from "../../../../infrastructure/db/prismaClient";

import { IInstagramIgLoginAuthService } from "../../../../application/interfaces/instagram/IInstagramIgLoginAuthService";
import { CompleteIgLoginUseCase } from "../../../../application/use-cases/instagram/CompleteIgLoginUseCase";

import {
  setIgLoginCookie,
  getIgLoginCookie,
  clearIgLoginCookie,
} from "../../instagram/instagramCookies";
import { signState, safeParseState } from "../../instagram/instagramState";

import { s, getAuthenticatedUserId } from "./helpers/auth";
import { safeJson, safeRedirect, wantsJson } from "./helpers/http";
import { parseBool } from "./helpers/parse";

const FRONT_URL = String(
  process.env.FRONTEND_URL ?? process.env.FRONT_URL ?? "http://localhost:5173",
).replace(/\/$/, "");

const IG_RETURN_PATH = String(process.env.IG_RETURN_PATH ?? "/settings");

function buildFrontUrl(params: Record<string, string | undefined | null>) {
  const path = IG_RETURN_PATH.startsWith("/") ? IG_RETURN_PATH : `/${IG_RETURN_PATH}`;
  const u = new URL(`${FRONT_URL}${path}`);

  for (const [k, v] of Object.entries(params)) {
    const val = s(v);
    if (val) u.searchParams.set(k, val);
  }
  return u.toString();
}

export class InstagramOAuthController {
  constructor(
    private readonly authService: IInstagramIgLoginAuthService,
    private readonly completeLogin: CompleteIgLoginUseCase,
  ) {}

  async start(req: Request, res: Response) {
    const userId = getAuthenticatedUserId(req);
    if (!userId)
      return safeJson(res, 401, { ok: false, message: "Não autenticado" });

    const returnTo =
      s((req.query as Record<string, unknown>)?.returnTo) || IG_RETURN_PATH;

    const rawState = JSON.stringify({
      uid: userId,
      nonce: crypto.randomBytes(12).toString("hex"),
      ts: Date.now(),
      returnTo,
    });

    const signedState = signState(rawState);
    setIgLoginCookie(res, userId);

    const url = this.authService.buildLoginUrl(signedState, false);

    const redirect = parseBool((req.query as Record<string, unknown>)?.redirect);
    if (redirect) return safeRedirect(res, 302, url);

    return safeJson(res, 200, { ok: true, url });
  }

  async callback(req: Request, res: Response) {
    const code = String(req.query.code ?? "");
    const state = String(req.query.state ?? "");

    if (!code)
      return safeJson(res, 400, { ok: false, message: "code é obrigatório" });

    let userId = getIgLoginCookie(req);
    let returnToFromState: string | null = null;

    if (state) {
      const parsed = safeParseState(state) as any;
      if (!userId && parsed?.uid) userId = String(parsed.uid);
      if (parsed?.returnTo) returnToFromState = String(parsed.returnTo);
    }

    if (!userId) {
      clearIgLoginCookie(res);

      if (!wantsJson(req)) {
        return safeRedirect(res, 302, buildFrontUrl({ ig: "error", reason: "session_expired" }));
      }

      return safeJson(res, 401, { ok: false, message: "Sessão expirada" });
    }

    const returnTo = returnToFromState || IG_RETURN_PATH;

    try {
      const result = await this.completeLogin.execute(code, state, userId);

      if ((result as any)?.status === "reauth_required") {
        clearIgLoginCookie(res);
        if (!wantsJson(req)) {
          const url = new URL(`${FRONT_URL}${returnTo}`);
          url.searchParams.set("ig", "reauth");
          return safeRedirect(res, 302, url.toString());
        }
        return safeJson(res, 200, { ok: true, ...result });
      }

      if ((result as any)?.status === "choose_required") {
        const selectionId = s((result as any)?.selectionId);

        try {
          const candidatesForDb = await this.completeLogin.getCandidatesForDb({
            selectionId,
            userId: s(userId),
          });

          await prisma.instagramCandidate.deleteMany({
            where: { userId: s(userId), selectionId },
          });

          await prisma.instagramCandidate.createMany({
            data: candidatesForDb.map((c: any) => ({
              userId: s(userId),
              selectionId,
              igUserId: s(c.igUserId),
              username: c.username ? s(c.username) : null,
              accountType: c.accountType ? s(c.accountType) : null,
              facebookPageId: s(c.facebookPageId),
              facebookPageName: c.facebookPageName ? s(c.facebookPageName) : null,
              pageAccessToken: s(c.pageAccessToken),
              source: s(c.source),
              instagramAccountId: null,
            })),
            skipDuplicates: true,
          });
        } catch {}

        clearIgLoginCookie(res);

        if (!wantsJson(req)) {
          const url = new URL(`${FRONT_URL}${returnTo}`);
          url.searchParams.set("ig", "choose");
          url.searchParams.set("selectionId", selectionId);
          return safeRedirect(res, 302, url.toString());
        }

        return safeJson(res, 200, { ok: true, ...result });
      }

      clearIgLoginCookie(res);

      if (!wantsJson(req)) {
        const url = new URL(`${FRONT_URL}${returnTo}`);
        url.searchParams.set("ig", "ok");
        return safeRedirect(res, 302, url.toString());
      }

      return safeJson(res, 200, { ok: true });
    } catch (e: any) {
      clearIgLoginCookie(res);

      if (!wantsJson(req)) {
        const url = new URL(`${FRONT_URL}${returnTo}`);
        url.searchParams.set("ig", "error");
        url.searchParams.set("reason", s(e?.message).slice(0, 140));
        return safeRedirect(res, 302, url.toString());
      }

      return safeJson(res, 500, { ok: false, message: e?.message });
    }
  }
}
