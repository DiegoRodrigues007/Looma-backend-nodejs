import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",

  // Só roda os testes de integração
  testMatch: ["<rootDir>/test/integration/**/*.int.test.ts"],

  // Carrega .env.test ANTES de importar app/env/prisma
  setupFiles: ["<rootDir>/test/integration/jest.env.ts"],

  // Setup/teardown do DB e Prisma
  setupFilesAfterEnv: ["<rootDir>/test/integration/jest.setup.ts"],

  // Importante pra evitar conflitos
  clearMocks: true,
  restoreMocks: true,
  resetMocks: true,

  // Integração pode demorar mais
  testTimeout: 60000,

  // Deixa logs mais fáceis de ler
  verbose: true,
};

export default config;