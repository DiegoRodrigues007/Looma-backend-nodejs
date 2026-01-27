// jest.config.ts
import type { Config } from "jest";

const config: Config = {
  // ✅ usa "projects" pra separar unit vs integration
  projects: [
    // =========================
    // ✅ UNIT (tudo mockado)
    // =========================
    {
      displayName: "unit",
      testEnvironment: "node",
      testMatch: ["<rootDir>/test/unit/**/*.test.ts"],
      clearMocks: true,
      setupFilesAfterEnv: ["<rootDir>/test/jest.setup.unit.ts"],

      transform: {
        "^.+\\.ts$": [
          "ts-jest",
          {
            tsconfig: "<rootDir>/tsconfig.jest.json",
            isolatedModules: true,
            diagnostics: false,
          },
        ],
      },

      // ✅ aqui sim: mocks globais (axios + prismaClient)
      moduleNameMapper: {
        "^axios$": "<rootDir>/test/mocks/axios.ts",
        ".*infrastructure/db/prismaClient$":
          "<rootDir>/test/mocks/prismaClient.ts",
      },
    },

    // =========================
    // ✅ INTEGRATION (Prisma REAL + DB REAL)
    // =========================
    {
      displayName: "integration",
      testEnvironment: "node",
      testMatch: ["<rootDir>/test/integration/**/*.test.ts"],
      clearMocks: true,
      setupFilesAfterEnv: ["<rootDir>/test/jest.setup.integration.ts"],

      transform: {
        "^.+\\.ts$": [
          "ts-jest",
          {
            tsconfig: "<rootDir>/tsconfig.jest.json",
            isolatedModules: true,
            diagnostics: false,
          },
        ],
      },

      // ❌ NÃO coloca moduleNameMapper aqui
      // senão você mata o prisma real e volta "user undefined"
    },
  ],
};

export default config;