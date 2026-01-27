// test/jest.setup.integration.ts
import { prisma } from "../src/infrastructure/db/prismaClient";
import { truncateAllTables } from "./integration/helpers/db";
import { startFakeMetaServer } from "./integration/helpers/fakeMetaServer";

/**
 * ============================
 * 1) CONTROLE DE LOGS
 * ============================
 * Por padrão, silencia log/info/debug/warn (onde o client printa "client:init")
 * e mantém só console.error (pra você enxergar o erro real).
 *
 * Para habilitar logs completos:
 *   TEST_SHOW_LOGS=1 npm test
 */
const showLogs = process.env.TEST_SHOW_LOGS === "1";
if (!showLogs) {
  // eslint-disable-next-line no-console
  console.log = () => undefined;
  // eslint-disable-next-line no-console
  console.info = () => undefined;
  // eslint-disable-next-line no-console
  console.debug = () => undefined;
  // eslint-disable-next-line no-console
  console.warn = () => undefined;
}

// Opcional: se teu projeto respeita LOG_LEVEL
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? "error";
process.env.DEBUG_LOGS_ENABLED = process.env.DEBUG_LOGS_ENABLED ?? "false";
process.env.IG_DEBUG_LOGS = process.env.IG_DEBUG_LOGS ?? "false";

/**
 * ============================
 * 2) ENV TOP-LEVEL (ANTES DO APP)
 * ============================
 * Precisa estar fora do beforeAll porque alguns testes importam o app no topo.
 */
const oldGraphBaseUrl: string | undefined = process.env.INSTAGRAM_GRAPH_BASE_URL;

// força Graph API a ir pro fake server
process.env.INSTAGRAM_GRAPH_BASE_URL = "http://127.0.0.1:4111/v21.0";

/**
 * ============================
 * 3) FAKE SERVER SINGLETON
 * ============================
 * Seu helper já é idempotente/singleton, então start/stop aqui é seguro.
 */
const fakeMeta = startFakeMetaServer(4111);

beforeAll(async () => {
  // sobe o fake server uma vez
  await fakeMeta.start();
});

beforeEach(async () => {
  // limpa DB entre testes
  await truncateAllTables(prisma);
});

afterAll(async () => {
  // derruba o fake server (idempotente). Não deixa quebrar a suite.
  try {
    await fakeMeta.stop();
  } catch (err) {
    // mantém só erro (se você habilitar TEST_SHOW_LOGS=1, você vê tudo)
    // eslint-disable-next-line no-console
    console.error("[jest.setup.integration] erro ao parar fakeMeta:", err);
  }

  // restaura env
  if (oldGraphBaseUrl === undefined) delete process.env.INSTAGRAM_GRAPH_BASE_URL;
  else process.env.INSTAGRAM_GRAPH_BASE_URL = oldGraphBaseUrl;

  // encerra prisma
  await prisma.$disconnect();
});