// test/jest.setup.unit.ts

import { resetAllMocks } from "./mocks/resetMocks";

/**
 * ✅ IMPORTANTE (UNIT):
 * - Não usar jest.mock("axios") aqui, porque o jest.config.ts já redireciona via moduleNameMapper:
 *   "^axios$" -> "<rootDir>/test/mocks/axios.ts"
 *
 * - Não usar jest.mock("../src/infrastructure/db/prismaClient") aqui, porque o jest.config.ts
 *   já redireciona via moduleNameMapper:
 *   ".*infrastructure/db/prismaClient$" -> "<rootDir>/test/mocks/prismaClient.ts"
 *
 * Isso evita loop/stack overflow.
 */

beforeEach(() => {
  // limpa estados e mocks do prisma mockado/axios mockado
  resetAllMocks();

  // reforço defensivo (se tiver mocks locais em testes)
  jest.clearAllMocks();
});