import express from "express";
import type { Server } from "http";

/**
 * Fake Meta Graph API server (para testes de integração)
 * - Suporta rotas COM e SEM prefixo /v21.0
 * - Implementa endpoints mínimos usados pelo fluxo:
 *   /oauth/access_token
 *   /me
 *   /me/permissions
 *   /debug_token
 *   /me/accounts
 *   /me/businesses
 *   /:bizId/owned_pages
 *   /:bizId/client_pages
 *   /:pageId (fields=access_token,name + connected_instagram_account + instagram_business_account)
 *   /:igUserId (fields=id,username,account_type)
 *   /:igUserId/media
 *   /media/:mediaId
 *   /:mediaId/insights
 *
 * ✅ Correções:
 * - garante compat com o InstagramIgLoginClient:
 *   - getPageAccessToken chama /{pageId}?fields=access_token,name
 *   - getMe legacy chama /me?fields=id,username,account_type
 *   - refreshLong tenta grant_type=fb_long_lived_token e faz fallback pra fb_exchange_token
 * - singleton por processo + start/stop idempotentes com refCount
 *
 * ✅ Ajuste adicional (pra teu teste):
 * - /oauth/access_token agora SIMULA FALHA quando o fb_exchange_token contém:
 *   "INVALID" | "FAIL" | "REFRESH_FAIL" | "EXPIRED"
 *   => retorna 400 OAuthException code 190 (token inválido)
 */

type SingletonState = {
  server?: Server;
  app?: ReturnType<typeof express>;
  isRunning: boolean;
  port: number;
  startPromise?: Promise<void>;
  stopPromise?: Promise<void>;
  refCount: number;
};

let singleton: SingletonState | undefined;

export function startFakeMetaServer(port = 4111) {
  if (!singleton) {
    singleton = {
      server: undefined,
      app: undefined,
      isRunning: false,
      port,
      startPromise: undefined,
      stopPromise: undefined,
      refCount: 0,
    };
  } else {
    // mantém a primeira porta que foi escolhida (evita testes tentando trocar)
    singleton.port = singleton.port || port;
  }

  // ---------------------------
  // helpers
  // ---------------------------
  function nowIso() {
    return new Date().toISOString();
  }

  function okPermissions() {
    return {
      data: [
        { permission: "instagram_basic", status: "granted" },
        { permission: "instagram_manage_insights", status: "granted" },
        { permission: "pages_show_list", status: "granted" },
        { permission: "pages_read_engagement", status: "granted" },
        { permission: "pages_read_user_content", status: "granted" },
      ],
    };
  }

  function splitFields(fields: string): Set<string> {
    return new Set(
      String(fields ?? "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
    );
  }

  // ---------------------------
  // fake data
  // ---------------------------
  const SHORT_TOKEN_OK = "FAKE_SHORT_LIVED_TOKEN_OK";
  const SHORT_TOKEN_D_CODE = "FAKE_SHORT_LIVED_TOKEN_D_CODE";

  const LONG_TOKEN_OK = "FAKE_LONG_LIVED_TOKEN_OK";
  const LONG_TOKEN_D_CODE = "FAKE_LONG_LIVED_TOKEN_D_CODE";

  const PAGE_ID = "PAGE_1";
  const PAGE_TOKEN = "FAKE_PAGE_ACCESS_TOKEN_OK";

  const IG_USER_ID = "IG_USER_1";
  const IG_USERNAME = "fake_ig_user";
  const IG_ACCOUNT_TYPE = "BUSINESS";

  const BUSINESS_ID = "BUSINESS_1";

  // ---------------------------
  // build app once (singleton)
  // ---------------------------
  function buildApp() {
    const app = express();
    app.use(express.json());

    // ---------------------------
    // router base (sem prefixo)
    // ---------------------------
    const r = express.Router();

    r.get("/health", (_req, res) => res.json({ ok: true, at: nowIso() }));

    /**
     * OAuth token endpoint
     * - code => short token
     * - fb_exchange_token => long token (exchange short->long)
     * - fb_long_lived_token => long token (refresh)
     */
    r.get("/oauth/access_token", (req, res) => {
      const grantType = String(req.query.grant_type ?? "");
      const code = String(req.query.code ?? "");
      const fbExchange = String(req.query.fb_exchange_token ?? "");

      // 1) exchange code -> short token
      if (code) {
        const t = code.includes("D_CODE") || code.includes("CODE")
          ? SHORT_TOKEN_D_CODE
          : SHORT_TOKEN_OK;

        return res.json({
          access_token: t,
          token_type: "bearer",
          expires_in: 3600, // 1h
          user_id: "FAKE_USER_1",
        });
      }

      // 2) exchange short->long OR refresh long
      if (
        (grantType === "fb_exchange_token" ||
          grantType === "fb_long_lived_token") &&
        fbExchange
      ) {
        // ✅ IMPORTANTE: permite simular falha de refresh/exchange em testes
        // Ex.: accessToken "INVALID_LONG_TOKEN" -> backend deve exigir reauth
        const fbUpper = fbExchange.toUpperCase();
        if (
          fbUpper.includes("INVALID") ||
          fbUpper.includes("FAIL") ||
          fbUpper.includes("REFRESH_FAIL") ||
          fbUpper.includes("EXPIRED")
        ) {
          return res.status(400).json({
            error: {
              message: "Invalid OAuth access token.",
              type: "OAuthException",
              code: 190,
              error_subcode: 0,
              fbtrace_id: "FAKE_TRACE",
            },
          });
        }

        const token =
          fbExchange.includes("D_CODE") || fbExchange.includes("CODE")
            ? LONG_TOKEN_D_CODE
            : LONG_TOKEN_OK;

        return res.json({
          access_token: token,
          token_type: "bearer",
          expires_in: 5184000, // 60 dias
        });
      }

      return res.status(400).json({
        error: {
          message: "invalid_request",
          type: "OAuthException",
          code: 100,
          error_subcode: 0,
        },
      });
    });

    // Legacy /me (alguns fluxos chamam primeiro)
    r.get("/me", (_req, res) => {
      return res.json({
        id: IG_USER_ID,
        username: IG_USERNAME,
        account_type: IG_ACCOUNT_TYPE,
      });
    });

    r.get("/me/permissions", (_req, res) => res.json(okPermissions()));

    r.get("/debug_token", (req, res) => {
      return res.json({
        data: {
          app_id: "24251132131229008",
          type: "USER",
          application: "Fake App",
          data_access_expires_at:
            Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
          expires_at: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 60,
          is_valid: true,
          issued_at: Math.floor(Date.now() / 1000) - 60,
          scopes: [
            "instagram_basic",
            "instagram_manage_insights",
            "pages_show_list",
            "pages_read_engagement",
            "pages_read_user_content",
          ],
          granular_scopes: [
            {
              scope: "pages_show_list",
              target_ids: [PAGE_ID],
            },
          ],
          user_id: "FAKE_USER_1",
          input_token: String(req.query.input_token ?? ""),
        },
      });
    });

    r.get("/me/accounts", (_req, res) => {
      return res.json({
        data: [{ id: PAGE_ID, name: "Fake Page", access_token: PAGE_TOKEN }],
        paging: { cursors: { before: "0", after: "0" }, next: null },
      });
    });

    r.get("/me/businesses", (_req, res) => {
      return res.json({
        data: [{ id: BUSINESS_ID, name: "Fake Business" }],
        paging: { cursors: { before: "0", after: "0" }, next: null },
      });
    });

    // BM fallbacks
    r.get(`/${BUSINESS_ID}/owned_pages`, (_req, res) => {
      return res.json({
        data: [{ id: PAGE_ID, name: "Fake Page", access_token: PAGE_TOKEN }],
        paging: { cursors: { before: "0", after: "0" }, next: null },
      });
    });

    r.get(`/${BUSINESS_ID}/client_pages`, (_req, res) => {
      return res.json({
        data: [{ id: PAGE_ID, name: "Fake Page", access_token: PAGE_TOKEN }],
        paging: { cursors: { before: "0", after: "0" }, next: null },
      });
    });

    // Media detail
    r.get("/media/:mediaId", (req, res) => {
      const { mediaId } = req.params;
      return res.json({
        id: mediaId,
        caption: `caption_${mediaId}`,
        media_type: "IMAGE",
        timestamp: "2026-01-24T00:00:00+0000",
      });
    });

    // List media by IG user
    r.get("/:igUserId/media", (req, res) => {
      const { igUserId } = req.params;

      return res.json({
        data: [
          {
            id: `post_${igUserId}_1`,
            caption: "post 1",
            media_type: "IMAGE",
            timestamp: "2026-01-24T00:00:00+0000",
            permalink: "https://instagram.com/p/fake1",
            media_url: "https://example.com/fake1.jpg",
            thumbnail_url: "https://example.com/fake1-thumb.jpg",
          },
          {
            id: `post_${igUserId}_2`,
            caption: "post 2",
            media_type: "VIDEO",
            timestamp: "2026-01-23T00:00:00+0000",
            permalink: "https://instagram.com/p/fake2",
            media_url: "https://example.com/fake2.mp4",
            thumbnail_url: "https://example.com/fake2-thumb.jpg",
          },
        ],
        paging: { next: null },
      });
    });

    // Insights
    r.get("/:mediaId/insights", (req, res) => {
      const { mediaId } = req.params;
      return res.json({
        data: [
          { name: "reach", period: "lifetime", values: [{ value: 123 }] },
          { name: "impressions", period: "lifetime", values: [{ value: 456 }] },
        ],
        meta: { mediaId },
      });
    });

    /**
     * Page/IG detail (deixa por último)
     * - /{pageId}?fields=access_token,name => usado por getPageAccessToken()
     * - /{pageId}?fields=instagram_business_account,connected_instagram_account => usado por getCandidates()
     * - /{igUserId}?fields=id,username[,account_type] => usado pra buscar username
     */
    r.get("/:id", (req, res, next) => {
      const id = String(req.params.id ?? "");

      // evita colisão com rotas especiais
      if (
        id === "media" ||
        id === "me" ||
        id === "oauth" ||
        id === "debug_token"
      ) {
        return next();
      }

      const fieldsRaw = String(req.query.fields ?? "");
      const fields = splitFields(fieldsRaw);

      // PAGE
      if (id === PAGE_ID) {
        const out: any = { id: PAGE_ID };

        if (!fieldsRaw) {
          return res.json(out);
        }

        if (fields.has("name")) out.name = "Fake Page";
        if (fields.has("access_token")) out.access_token = PAGE_TOKEN;

        // link IG (BUSINESS/CREATOR)
        if (fields.has("connected_instagram_account")) {
          out.connected_instagram_account = { id: IG_USER_ID };
        }
        if (fields.has("instagram_business_account")) {
          out.instagram_business_account = { id: IG_USER_ID };
        }

        // fallback: se pedirem qualquer coisa e não tiver, devolve básico
        if (Object.keys(out).length === 1) {
          out.name = "Fake Page";
          out.access_token = PAGE_TOKEN;
          out.connected_instagram_account = { id: IG_USER_ID };
          out.instagram_business_account = { id: IG_USER_ID };
        }

        return res.json(out);
      }

      // IG USER
      if (id === IG_USER_ID || id.startsWith("IG_USER")) {
        const out: any = { id };

        if (!fieldsRaw) {
          out.username = IG_USERNAME;
          out.account_type = IG_ACCOUNT_TYPE;
          return res.json(out);
        }

        if (fields.has("id")) out.id = id;
        if (fields.has("username")) out.username = IG_USERNAME;
        if (fields.has("account_type")) out.account_type = IG_ACCOUNT_TYPE;

        // se pediram id,username e vier vazio, garante
        if (!out.username) out.username = IG_USERNAME;

        return res.json(out);
      }

      return res.status(404).json({
        ok: false,
        message: "FakeMetaServer: rota não implementada (id)",
        id,
        fields: fieldsRaw,
      });
    });

    // monta em / e /v21.0
    app.use("/", r);
    app.use("/v21.0", r);

    // 404 final
    app.use((req, res) => {
      return res.status(404).json({
        ok: false,
        message: "FakeMetaServer: rota não implementada",
        method: req.method,
        path: req.path,
        query: req.query,
      });
    });

    return app;
  }

  // cria o app uma vez e reusa
  if (!singleton.app) {
    singleton.app = buildApp();
  }

  return {
    start: () => {
      // ✅ refCount: marca "em uso"
      singleton!.refCount++;

      // já rodando
      if (singleton!.isRunning) return Promise.resolve();

      // já tem start em andamento
      if (singleton!.startPromise) return singleton!.startPromise;

      singleton!.startPromise = new Promise<void>((resolve, reject) => {
        const p = singleton!.port ?? port;

        const srv = singleton!.app!.listen(p, "127.0.0.1");

        srv.once("error", (err: any) => {
          // Porta em uso => outro teste já subiu. Considera OK.
          if (err?.code === "EADDRINUSE") {
            singleton!.isRunning = true;
            singleton!.server = undefined; // não guarda server "quebrado"
            singleton!.startPromise = undefined;
            return resolve();
          }

          singleton!.startPromise = undefined;
          return reject(err);
        });

        srv.once("listening", () => {
          singleton!.server = srv;
          singleton!.isRunning = true;
          singleton!.startPromise = undefined;
          return resolve();
        });
      });

      return singleton!.startPromise;
    },

    stop: () => {
      // ✅ refCount: libera "em uso"
      singleton!.refCount = Math.max(0, singleton!.refCount - 1);

      // se ainda tem alguém usando, NÃO fecha
      if (singleton!.refCount > 0) return Promise.resolve();

      // se nem tá rodando, ok
      if (!singleton!.isRunning) return Promise.resolve();

      if (singleton!.stopPromise) return singleton!.stopPromise;

      singleton!.stopPromise = new Promise<void>((resolve, reject) => {
        const srv = singleton!.server;

        // se foi marcado como "running" por EADDRINUSE (não temos handle), só reseta flags
        if (!srv) {
          singleton!.isRunning = false;
          singleton!.stopPromise = undefined;
          return resolve();
        }

        srv.close((err) => {
          singleton!.server = undefined;
          singleton!.isRunning = false;
          singleton!.stopPromise = undefined;

          if (err) return reject(err);
          return resolve();
        });
      });

      return singleton!.stopPromise;
    },


    reset: () => {
      if (!singleton) return;
      if (singleton.refCount > 0) return;

      singleton.server = undefined;
      singleton.app = undefined;
      singleton.isRunning = false;
      singleton.startPromise = undefined;
      singleton.stopPromise = undefined;
    },

    isRunning: () => Boolean(singleton!.isRunning),
    getPort: () => singleton!.port ?? port,
  };
}