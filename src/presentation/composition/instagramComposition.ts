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
    singleton.pendingSelectionStore =
      new InMemoryInstagramPendingSelectionStore();
  }
  return singleton.pendingSelectionStore;
}

function makeAuthService() {
  return new InstagramIgLoginAuthService(makeIgClient());
}

function makeCompleteIgLoginUseCase() {
  return new CompleteIgLoginUseCase(
    makeAuthService(),
    makeTokenStore(),
    makePendingSelectionStore(),
    {
      chooseTtlMs: Number(process.env.IG_LOGIN_CHOOSE_TTL_MS ?? 10 * 60 * 1000),
      autoConfirmSingle:
        String(process.env.IG_LOGIN_AUTO_CONFIRM_SINGLE ?? "true") !== "false",
      requireState:
        String(process.env.IG_LOGIN_REQUIRE_STATE ?? "true") !== "false",
    },
  );
}

function makeListAccountsUseCase() {
  return new ListInstagramAccountsUseCase(
    makeUserRepository(),
    makeInstagramAccountRepository(),
  );
}

function makeSetActiveAccountUseCase() {
  return new SetActiveInstagramAccountUseCase(
    makeUserRepository(),
    makeInstagramAccountRepository(),
  );
}


export function makeInstagramOAuthController() {
  return new InstagramOAuthController(
    makeAuthService(),
    makeCompleteIgLoginUseCase(),
  );
}

export function makeInstagramCandidatesController() {
  return new InstagramCandidatesController(makeCompleteIgLoginUseCase());
}

export function makeInstagramAccountsController() {
  return new InstagramAccountsController(
    makeListAccountsUseCase(),
    makeSetActiveAccountUseCase(),
  );
}

export function makeInstagramMetricsController() {
  return new InstagramMetricsController();
}

export const makeInstagramActiveAccountController =
  makeInstagramAccountsController;

export const makeInstagramConfirmController =
  makeInstagramAccountsController;

export const makeInstagramDisconnectController =
  makeInstagramAccountsController;

export const makeInstagramRefreshController =
  makeInstagramMetricsController;

export const makeInstagramBackfillController =
  makeInstagramMetricsController;

export const makeInstagramTopContentController =
  makeInstagramMetricsController;
