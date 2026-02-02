import { InstagramIgLoginClient } from "../../infrastructure/instagram/clients/InstagramIgLoginClient";
import { PrismaInstagramTokenStore } from "../../infrastructure/db/repositories/instagram/PrismaInstagramTokenStore";
import { PrismaInstagramAccountRepository } from "../../infrastructure/db/repositories/instagram/PrismaInstagramAccountRepository";
import { PrismaUserRepository } from "../../infrastructure/db/repositories/user/PrismaUserRepository";
import { PrismaInstagramDailyMetricsRepository } from "../../infrastructure/db/repositories/instagram/PrismaInstagramDailyMetricsRepository";
import { PrismaMetricsSnapshotRepository } from "../../infrastructure/db/repositories/metrics/PrismaMetricsSnapshotRepository";

import {
  CompleteIgLoginUseCase,
  InMemoryInstagramPendingSelectionStore,
} from "../../application/use-cases/instagram/CompleteIgLoginUseCase";
import { ListInstagramAccountsUseCase } from "../../application/use-cases/instagram/ListInstagramAccountsUseCase";
import { SetActiveInstagramAccountUseCase } from "../../application/use-cases/instagram/SetActiveInstagramAccountUseCase";
import {
  GetInstagramDashboardMetricsUseCase,
  type BackfillDaysFn,
} from "../../application/use-cases/instagram/GetInstagramDashboardMetricsUseCase";
import { RefreshInstagramTokenUseCase } from "../../application/use-cases/instagram/RefreshInstagramTokenUseCase";
import { RunInstagramBackfillUseCase } from "../../application/use-cases/instagram/RunInstagramBackfillUseCase";

import { InstagramAuthController } from "../http/controllers/InstagramAuthController";

import { AxiosInstagramGraphClient } from "../../infrastructure/instagram/clients/AxiosInstagramGraphClient";
import { InstagramTopContentService } from "../../application/services/instagram/InstagramTopContentService";

import { AxiosInstagramMetricsClient } from "../../infrastructure/instagram/clients/AxiosInstagramMetricsClient";
import { InstagramMetricsService } from "../../application/services/instagram/InstagramMetricsService";

import { InstagramIgLoginAuthService } from "../../application/services/instagram/InstagramIgLoginAuthService";

import { AxiosInstagramBackfillClient } from "../../infrastructure/instagram/clients/AxiosInstagramBackfillClient";
import { InstagramBackfillService } from "../../application/services/instagram/InstagramBackfillService";

// ✅ Importa a INTERFACE (tipo) do repo de auth
import type { IUserAuthRepository } from "../../application/interfaces/db/IUserAuthRepository";

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

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  return String(raw).toLowerCase() !== "false";
}

class GetInstagramTopContentUseCase {
  constructor(
    // ✅ agora tipa como interface correta
    private readonly userAuthRepo: IUserAuthRepository,
    private readonly tokenStore: PrismaInstagramTokenStore,
    private readonly topContentService: InstagramTopContentService
  ) {}

  async execute(input: {
    userId: string;
    instagramAccountId?: string | null;
    from: string;
    to: string;
    limit?: number;
  }) {
    const userId = String(input.userId ?? "").trim();
    if (!userId) {
      return {
        ok: false as const,
        code: "UNAUTHENTICATED",
        message: "Não autenticado",
      };
    }

    let instagramAccountId = String(input.instagramAccountId ?? "").trim();
    if (!instagramAccountId) {
      const u = await this.userAuthRepo.getAuthDataById(userId);
      instagramAccountId = String(u?.activeInstagramAccountId ?? "").trim();
    }

    if (!instagramAccountId) {
      return {
        ok: false as const,
        code: "NOT_FOUND",
        message: "Usuário não possui conta Instagram ativa.",
      };
    }

    const tokenRec = await this.tokenStore.getByUserId(userId);

    const accessToken = String(tokenRec?.accessToken ?? "").trim();
    const igUserId = String(tokenRec?.igUserId ?? "").trim();

    if (!accessToken || !igUserId) {
      return {
        ok: false as const,
        code: "UNAUTHENTICATED",
        message: "Token/igUserId ausente. Reconecte o Instagram.",
      };
    }

    try {
      const items = await this.topContentService.fetchTopContent({
        accessToken,
        igUserId,
        from: String(input.from ?? "").trim(),
        to: String(input.to ?? "").trim(),
        limit: input.limit,
      });

      return { ok: true as const, items };
    } catch (e: any) {
      const msg = e?.message ? String(e.message) : String(e);
      if (/reauth required/i.test(msg)) {
        return { ok: false as const, code: "UNAUTHENTICATED", message: msg };
      }
      if (/provider down/i.test(msg)) {
        return { ok: false as const, code: "PROVIDER_DOWN", message: msg };
      }
      return { ok: false as const, code: "INTERNAL_ERROR", message: msg };
    }
  }
}

const singleton = {
  igLoginAuthService: null as InstagramIgLoginAuthService | null,
  tokenStore: null as PrismaInstagramTokenStore | null,

  // ✅ userAuthRepo agora é interface (mas pode ser implementado por PrismaUserRepository)
  userAuthRepo: null as IUserAuthRepository | null,

  userRepo: null as PrismaUserRepository | null,
  instagramAccountRepo: null as PrismaInstagramAccountRepository | null,

  dailyMetricsRepo: null as PrismaInstagramDailyMetricsRepository | null,
  metricsSnapshotRepo: null as PrismaMetricsSnapshotRepository | null,

  backfillClient: null as AxiosInstagramBackfillClient | null,
  backfillService: null as InstagramBackfillService | null,

  graphClient: null as AxiosInstagramGraphClient | null,
  topContentService: null as InstagramTopContentService | null,

  instagramMetricsClient: null as AxiosInstagramMetricsClient | null,
  instagramMetricsService: null as InstagramMetricsService | null,

  pendingSelectionStore: null as InMemoryInstagramPendingSelectionStore | null,
};

export function makeInstagramIgLoginAuthService() {
  if (!singleton.igLoginAuthService) {
    const client = new InstagramIgLoginClient();
    singleton.igLoginAuthService = new InstagramIgLoginAuthService(client);
  }
  return singleton.igLoginAuthService;
}

export function makeInstagramTokenStore() {
  if (!singleton.tokenStore) singleton.tokenStore = new PrismaInstagramTokenStore();
  return singleton.tokenStore;
}

/**
 * ✅ Aqui é o ponto principal:
 * Retorna um IUserAuthRepository (interface), mas instância real pode ser PrismaUserRepository
 */
export function makeUserAuthRepository(): IUserAuthRepository {
  if (!singleton.userAuthRepo) {
    // PrismaUserRepository precisa ter getAuthDataById(userId)
    singleton.userAuthRepo = new PrismaUserRepository() as unknown as IUserAuthRepository;
  }
  return singleton.userAuthRepo;
}

export function makeInstagramAccountRepository() {
  if (!singleton.instagramAccountRepo) {
    singleton.instagramAccountRepo = new PrismaInstagramAccountRepository();
  }
  return singleton.instagramAccountRepo;
}

export function makeUserRepository() {
  if (!singleton.userRepo) singleton.userRepo = new PrismaUserRepository();
  return singleton.userRepo;
}

export function makeInstagramDailyMetricsRepository() {
  if (!singleton.dailyMetricsRepo) {
    singleton.dailyMetricsRepo = new PrismaInstagramDailyMetricsRepository();
  }
  return singleton.dailyMetricsRepo;
}

export function makeMetricsSnapshotRepository() {
  if (!singleton.metricsSnapshotRepo) {
    singleton.metricsSnapshotRepo = new PrismaMetricsSnapshotRepository();
  }
  return singleton.metricsSnapshotRepo;
}

export function makeInstagramGraphClient() {
  if (!singleton.graphClient) singleton.graphClient = new AxiosInstagramGraphClient();
  return singleton.graphClient;
}

export function makeInstagramTopContentService() {
  if (!singleton.topContentService) {
    const graph = makeInstagramGraphClient();
    singleton.topContentService = new InstagramTopContentService(graph);
  }
  return singleton.topContentService;
}

export function makeInstagramMetricsClient() {
  if (!singleton.instagramMetricsClient) {
    singleton.instagramMetricsClient = new AxiosInstagramMetricsClient();
  }
  return singleton.instagramMetricsClient;
}

export function makeInstagramMetricsService() {
  if (!singleton.instagramMetricsService) {
    const metricsClient = makeInstagramMetricsClient();
    singleton.instagramMetricsService = new InstagramMetricsService(metricsClient);
  }
  return singleton.instagramMetricsService;
}

export function makeInstagramBackfillClient() {
  if (!singleton.backfillClient) {
    singleton.backfillClient = new AxiosInstagramBackfillClient();
  }
  return singleton.backfillClient;
}

export function makeInstagramBackfillService() {
  if (!singleton.backfillService) {
    const client = makeInstagramBackfillClient();
    const dailyRepo = makeInstagramDailyMetricsRepository();
    singleton.backfillService = new InstagramBackfillService(client, dailyRepo);
  }
  return singleton.backfillService;
}

export function makeInstagramPendingSelectionStore() {
  if (!singleton.pendingSelectionStore) {
    singleton.pendingSelectionStore = new InMemoryInstagramPendingSelectionStore();
  }
  return singleton.pendingSelectionStore;
}

export function makeInstagramAuthController(): InstagramAuthController {
  const authService = makeInstagramIgLoginAuthService();
  const tokenStore = makeInstagramTokenStore();
  const userAuthRepo = makeUserAuthRepository();

  const userRepo = makeUserRepository();
  const instagramAccountRepo = makeInstagramAccountRepository();

  const dailyMetricsRepo = makeInstagramDailyMetricsRepository();
  const metricsSnapshotRepo = makeMetricsSnapshotRepository();

  const chooseTtlMs = envNumber("IG_LOGIN_CHOOSE_TTL_MS", 10 * 60 * 1000);
  const autoConfirmSingle = envBool("IG_LOGIN_AUTO_CONFIRM_SINGLE", true);
  const requireState = envBool("IG_LOGIN_REQUIRE_STATE", true);

  const pendingStore = makeInstagramPendingSelectionStore();

  const completeLogin = new CompleteIgLoginUseCase(authService, tokenStore, pendingStore, {
    chooseTtlMs,
    autoConfirmSingle,
    requireState,
  });

  const listAccounts = new ListInstagramAccountsUseCase(userRepo, instagramAccountRepo);
  const setActiveAccount = new SetActiveInstagramAccountUseCase(userRepo, instagramAccountRepo);

  const backfillDays: BackfillDaysFn = async () => {
    throw new Error(
      "backfillDays não foi injetado. O controller deve fornecer a função (ou mover para um service)."
    );
  };

  const dashboardMetrics = new GetInstagramDashboardMetricsUseCase(
    dailyMetricsRepo,
    metricsSnapshotRepo,
    backfillDays
  );

  const refreshToken = new RefreshInstagramTokenUseCase(
    userRepo,
    instagramAccountRepo,
    authService
  );

  const backfillService = makeInstagramBackfillService();

  const runBackfill = new RunInstagramBackfillUseCase(
    userRepo,
    instagramAccountRepo,
    dailyMetricsRepo,
    metricsSnapshotRepo,
    backfillService
  );

  const topContentService = makeInstagramTopContentService();
  const getTopContent = new GetInstagramTopContentUseCase(
    userAuthRepo,
    tokenStore,
    topContentService
  );

  let controller: any;

  try {
    controller = new (InstagramAuthController as any)(
      authService,
      completeLogin,
      listAccounts,
      setActiveAccount,
      dashboardMetrics,
      refreshToken,
      runBackfill,
      getTopContent
    );
  } catch {
    controller = new (InstagramAuthController as any)(
      authService,
      completeLogin,
      listAccounts,
      setActiveAccount,
      dashboardMetrics
    );
  }

  if (typeof controller.topContent !== "function") {
    controller.topContent = async (req: any, res: any) => {
      try {
        const userId = getAuthenticatedUserId(req);

        if (!userId) {
          return res.status(401).json({
            ok: false,
            code: "UNAUTHENTICATED",
            message: "Não autenticado",
          });
        }

        const from = String(req.body?.from ?? "").trim();
        const to = String(req.body?.to ?? "").trim();
        const limitRaw = req.body?.limit;
        const limit = typeof limitRaw === "number" ? limitRaw : undefined;

        if (!from || !to) {
          return res.status(400).json({
            ok: false,
            code: "INVALID_INPUT",
            message: "from e to são obrigatórios (YYYY-MM-DD)",
          });
        }

        const result = await getTopContent.execute({
          userId,
          instagramAccountId: req.body?.instagramAccountId ?? null,
          from,
          to,
          limit,
        });

        if (!result.ok) {
          const status =
            result.code === "UNAUTHENTICATED"
              ? 401
              : result.code === "NOT_FOUND"
              ? 404
              : result.code === "INVALID_INPUT"
              ? 400
              : result.code === "PROVIDER_DOWN"
              ? 503
              : 500;

          return res.status(status).json(result);
        }

        return res.status(200).json(result);
      } catch (e: any) {
        const msg = e?.message ? String(e.message) : String(e);
        return res.status(500).json({
          ok: false,
          code: "INTERNAL_ERROR",
          message: msg,
        });
      }
    };
  }

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

        const refreshIfExpiresBeforeMinutesRaw = req.body?.refreshIfExpiresBeforeMinutes;
        const refreshIfExpiresBeforeMinutes =
          typeof refreshIfExpiresBeforeMinutesRaw === "number"
            ? refreshIfExpiresBeforeMinutesRaw
            : undefined;

        let instagramAccountId = String(instagramAccountIdRaw ?? "").trim();

        if (!instagramAccountId) {
          const u = await userAuthRepo.getAuthDataById(String(userId));
          instagramAccountId = String(u?.activeInstagramAccountId ?? "").trim();
        }

        if (!instagramAccountId) {
          return res.status(404).json({
            ok: false,
            code: "NOT_FOUND",
            message: "Usuário não possui conta Instagram ativa.",
          });
        }

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
        const msg = e?.message ? String(e.message) : String(e);
        return res.status(500).json({
          ok: false,
          code: "INTERNAL_ERROR",
          message: msg,
        });
      }
    };
  }

  if (typeof controller.runBackfill !== "function") {
    controller.runBackfill = async (req: any, res: any) => {
      try {
        const userId = getAuthenticatedUserId(req);
        if (!userId) {
          return res.status(401).json({
            ok: false,
            code: "UNAUTHENTICATED",
            message: "Não autenticado",
          });
        }

        const from = String(req.body?.from ?? "").trim();
        const to = String(req.body?.to ?? "").trim();

        if (!from || !to) {
          return res.status(400).json({
            ok: false,
            code: "INVALID_INPUT",
            message: "from e to são obrigatórios (YYYY-MM-DD)",
          });
        }

        const result = await runBackfill.execute({
          userId,
          instagramAccountId: req.body?.instagramAccountId ?? null,
          from,
          to,
          force: !!req.body?.force,
          refillZeros: req.body?.refillZeros ?? true,
          alwaysRefetchLastDays: req.body?.alwaysRefetchLastDays,
          concurrency: req.body?.concurrency,
        });

        return res.status(200).json(result);
      } catch (e: any) {
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
