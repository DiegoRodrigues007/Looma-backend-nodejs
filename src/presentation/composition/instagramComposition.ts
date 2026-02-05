import { InstagramIgLoginClient } from "../../infrastructure/instagram/clients/InstagramIgLoginClient";
import { PrismaInstagramTokenStore } from "../../infrastructure/db/repositories/instagram/PrismaInstagramTokenStore";
import { PrismaInstagramAccountRepository } from "../../infrastructure/db/repositories/instagram/PrismaInstagramAccountRepository";
import { PrismaUserRepository } from "../../infrastructure/db/repositories/user/PrismaUserRepository";

import { InstagramOAuthController } from "../../presentation/http/controllers/instagram/InstagramOAuthController";
import { InstagramCandidatesController } from "../../presentation/http/controllers/instagram/InstagramCandidatesController";
import { InstagramAccountsController } from "../../presentation/http/controllers/instagram/InstagramAccountsController";
import { InstagramMetricsController } from "../../presentation/http/controllers/instagram/InstagramMetricsController";

import {
  CompleteIgLoginUseCase,
  InMemoryInstagramPendingSelectionStore,
} from "../../application/use-cases/instagram/CompleteIgLoginUseCase";
import { ListInstagramAccountsUseCase } from "../../application/use-cases/instagram/ListInstagramAccountsUseCase";
import { SetActiveInstagramAccountUseCase } from "../../application/use-cases/instagram/SetActiveInstagramAccountUseCase";

import { InstagramIgLoginAuthService } from "../../application/services/instagram/InstagramIgLoginAuthService";

const singleton = {
  igClient: null as InstagramIgLoginClient | null,
  tokenStore: null as PrismaInstagramTokenStore | null,
  userRepo: null as PrismaUserRepository | null,
  accountRepo: null as PrismaInstagramAccountRepository | null,
  pendingSelectionStore: null as InMemoryInstagramPendingSelectionStore | null,

  // ✅ faltava manter esses singletons também
  authService: null as InstagramIgLoginAuthService | null,
  completeIgLoginUseCase: null as CompleteIgLoginUseCase | null,
  listAccountsUseCase: null as ListInstagramAccountsUseCase | null,
  setActiveAccountUseCase: null as SetActiveInstagramAccountUseCase | null,

  // controllers também podem ser singletons (opcional, mas evita recriar e garante consistência)
  oauthController: null as InstagramOAuthController | null,
  candidatesController: null as InstagramCandidatesController | null,
  accountsController: null as InstagramAccountsController | null,
  metricsController: null as InstagramMetricsController | null,
};

function makeIgClient() {
  if (!singleton.igClient) {
    singleton.igClient = new InstagramIgLoginClient();
  }
  return singleton.igClient;
}

function makeTokenStore() {
  if (!singleton.tokenStore) {
    singleton.tokenStore = new PrismaInstagramTokenStore();
  }
  return singleton.tokenStore;
}

function makeUserRepository() {
  if (!singleton.userRepo) {
    singleton.userRepo = new PrismaUserRepository();
  }
  return singleton.userRepo;
}

function makeInstagramAccountRepository() {
  if (!singleton.accountRepo) {
    singleton.accountRepo = new PrismaInstagramAccountRepository();
  }
  return singleton.accountRepo;
}

function makePendingSelectionStore() {
  if (!singleton.pendingSelectionStore) {
    singleton.pendingSelectionStore = new InMemoryInstagramPendingSelectionStore();
  }
  return singleton.pendingSelectionStore;
}

function makeAuthService() {
  if (!singleton.authService) {
    singleton.authService = new InstagramIgLoginAuthService(makeIgClient());
  }
  return singleton.authService;
}

function makeCompleteIgLoginUseCase() {
  if (!singleton.completeIgLoginUseCase) {
    singleton.completeIgLoginUseCase = new CompleteIgLoginUseCase(
      makeAuthService(),
      makeTokenStore(),
      makePendingSelectionStore(),
      {
        chooseTtlMs: Number(process.env.IG_LOGIN_CHOOSE_TTL_MS ?? 10 * 60 * 1000),
        autoConfirmSingle:
          String(process.env.IG_LOGIN_AUTO_CONFIRM_SINGLE ?? "true") !== "false",
        requireState:
          String(process.env.IG_LOGIN_REQUIRE_STATE ?? "true") !== "false",
      }
    );
  }
  return singleton.completeIgLoginUseCase;
}

function makeListAccountsUseCase() {
  if (!singleton.listAccountsUseCase) {
    singleton.listAccountsUseCase = new ListInstagramAccountsUseCase(
      makeUserRepository(),
      makeInstagramAccountRepository()
    );
  }
  return singleton.listAccountsUseCase;
}

function makeSetActiveAccountUseCase() {
  if (!singleton.setActiveAccountUseCase) {
    singleton.setActiveAccountUseCase = new SetActiveInstagramAccountUseCase(
      makeUserRepository(),
      makeInstagramAccountRepository()
    );
  }
  return singleton.setActiveAccountUseCase;
}

// =========================
// CONTROLLERS (singleton)
// =========================

export function makeInstagramOAuthController() {
  if (!singleton.oauthController) {
    singleton.oauthController = new InstagramOAuthController(
      makeAuthService(),
      makeCompleteIgLoginUseCase()
    );
  }
  return singleton.oauthController;
}

export function makeInstagramCandidatesController() {
  if (!singleton.candidatesController) {
    singleton.candidatesController = new InstagramCandidatesController(
      makeCompleteIgLoginUseCase()
    );
  }
  return singleton.candidatesController;
}

export function makeInstagramAccountsController() {
  if (!singleton.accountsController) {
    singleton.accountsController = new InstagramAccountsController(
      makeListAccountsUseCase(),
      makeSetActiveAccountUseCase()
    );
  }
  return singleton.accountsController;
}

export function makeInstagramMetricsController() {
  if (!singleton.metricsController) {
    singleton.metricsController = new InstagramMetricsController();
  }
  return singleton.metricsController;
}

// =========================
// ALIASES CORRETOS
// =========================

// “active account” / status / list / setActive / disconnect => AccountsController
export const makeInstagramActiveAccountController = makeInstagramAccountsController;
export const makeInstagramDisconnectController = makeInstagramAccountsController;

// confirm + candidates => CandidatesController (antes estava errado)
export const makeInstagramConfirmController = makeInstagramCandidatesController;

// refresh/backfill/topcontent => MetricsController (se essas rotas usam ele)
export const makeInstagramRefreshController = makeInstagramMetricsController;
export const makeInstagramBackfillController = makeInstagramMetricsController;
export const makeInstagramTopContentController = makeInstagramMetricsController;
