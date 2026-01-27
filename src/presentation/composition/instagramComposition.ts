// src/presentation/composition/instagramComposition.ts

import { prisma } from "../../infrastructure/db/prismaClient";

import { InstagramIgLoginClient } from "../../infrastructure/instagram/clients/InstagramIgLoginClient";
import { InstagramIgLoginAuthService } from "../../infrastructure/instagram/services/InstagramIgLoginAuthService";
import { PrismaInstagramTokenStore } from "../../infrastructure/db/PrismaInstagramTokenStore";

import { CompleteIgLoginUseCase } from "../../application/use-cases/instagram/CompleteIgLoginUseCase";
import { ListInstagramAccountsUseCase } from "../../application/use-cases/instagram/ListInstagramAccountsUseCase";
import { SetActiveInstagramAccountUseCase } from "../../application/use-cases/instagram/SetActiveInstagramAccountUseCase";

import {
  GetInstagramDashboardMetricsUseCase,
  type BackfillDaysFn,
} from "../../application/use-cases/instagram/GetInstagramDashboardMetricsUseCase";

import { RefreshInstagramTokenUseCase } from "../../application/use-cases/instagram/RefreshInstagramTokenUseCase";
import { InstagramAuthController } from "../http/controllers/InstagramAuthController";

/**
 * Factory: AuthService (Graph API / OAuth)
 */
export function makeInstagramIgLoginAuthService() {
  const client = new InstagramIgLoginClient();
  return new InstagramIgLoginAuthService(client);
}

/**
 * Factory: TokenStore (persistência no Prisma)
 */
export function makeInstagramTokenStore() {
  return new PrismaInstagramTokenStore();
}

function getAuthenticatedUserId(req: any): string | null {
  const v =
    req?.user?.userId ||
    req?.user?.id ||
    req?.user?.sub ||
    req?.userId ||
    req?.header?.("x-test-user-id") ||
    req?.header?.("x-user-id") ||
    null;

  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number") return String(v);
  return null;
}

/**
 * Factory: Controller principal do Instagram.
 * Importante: aqui também plugamos o refresh.
 */
export function makeInstagramAuthController(): InstagramAuthController {
  const authService = makeInstagramIgLoginAuthService();
  const tokenStore = makeInstagramTokenStore();

  const completeLogin = new CompleteIgLoginUseCase(authService, tokenStore);

  const listAccounts = new ListInstagramAccountsUseCase();
  const setActiveAccount = new SetActiveInstagramAccountUseCase();

  const backfillDays: BackfillDaysFn = async () => {
    throw new Error(
      "backfillDays não foi injetado. O controller deve fornecer a função (ou mover para um service)."
    );
  };

  const dashboardMetrics = new GetInstagramDashboardMetricsUseCase(
    prisma,
    backfillDays
  );

  // ✅ Use-case real do refresh (agora com prisma + authService injetados)
  const refreshToken = new RefreshInstagramTokenUseCase(prisma, authService);

  /**
   * ✅ Tenta instanciar o controller já com refreshToken (se o construtor suportar).
   * Se não suportar (versão antiga), cai no fallback e adiciona method refresh.
   */
  let controller: any;

  try {
    // ✅ Se seu InstagramAuthController já aceita refreshToken no construtor, isso resolve o "undefined.client".
    controller = new (InstagramAuthController as any)(
      authService,
      completeLogin,
      listAccounts,
      setActiveAccount,
      dashboardMetrics,
      refreshToken // ✅ NOVO: injeta no controller, se suportado
    );
  } catch {
    // ✅ fallback pro construtor antigo
    controller = new (InstagramAuthController as any)(
      authService,
      completeLogin,
      listAccounts,
      setActiveAccount,
      dashboardMetrics
    );
  }

  // ✅ Se ainda não existir refresh, define aqui (fallback compat)
  if (typeof controller.refresh !== "function") {
    controller.refresh = async (req: any, res: any) => {
      try {
        const userId = getAuthenticatedUserId(req);

        if (!userId) {
          return res.status(401).json({
            ok: false,
            code: "UNAUTHENTICATED",
            message: "Não autenticado",
          });
        }

        const instagramAccountIdRaw = req.body?.instagramAccountId;
        const force = !!req.body?.force;

        const refreshIfExpiresBeforeMinutesRaw =
          req.body?.refreshIfExpiresBeforeMinutes;

        const refreshIfExpiresBeforeMinutes =
          typeof refreshIfExpiresBeforeMinutesRaw === "number"
            ? refreshIfExpiresBeforeMinutesRaw
            : undefined;

        // se não vier instagramAccountId, usa activeInstagramAccountId do usuário
        let instagramAccountId = String(instagramAccountIdRaw ?? "").trim();
        if (!instagramAccountId) {
          const u = await prisma.user.findUnique({
            where: { id: String(userId) },
            select: { activeInstagramAccountId: true },
          });

          instagramAccountId = String(u?.activeInstagramAccountId ?? "").trim();
        }

        if (!instagramAccountId) {
          return res.status(404).json({
            ok: false,
            code: "NOT_FOUND",
            message: "Usuário não possui conta Instagram ativa.",
          });
        }

        // ✅ chama o use-case oficial (ele valida ownership e atualiza o DB)
        const result = await refreshToken.execute({
          userId: String(userId),
          instagramAccountId,
          force,
          refreshIfExpiresBeforeMinutes,
        });

        if (!result.ok) {
          const status =
            result.code === "UNAUTHENTICATED"
              ? 401
              : result.code === "NOT_FOUND"
                ? 404
                : result.code === "INVALID_INPUT"
                  ? 400
                  : 403;

          return res.status(status).json(result);
        }

        return res.status(200).json(result);
      } catch (e: any) {
        // ✅ Se for bug interno (DI etc), não mascare como NOT_CONNECTED
        const msg = e?.message ? String(e.message) : String(e);
        return res.status(500).json({
          ok: false,
          code: "INTERNAL_ERROR",
          message: msg,
        });
      }
    };
  }

  return controller as InstagramAuthController;
}