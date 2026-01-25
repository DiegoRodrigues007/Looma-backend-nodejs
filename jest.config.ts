import type { Config } from "jest";

const config: Config = {
  testEnvironment: "node",
  testMatch: ["**/test/**/*.test.ts"],
  clearMocks: true,
  setupFilesAfterEnv: ["<rootDir>/test/jest.setup.ts"],

  // ✅ novo formato recomendado pelo ts-jest
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

  moduleNameMapper: {
    "^axios$": "<rootDir>/test/mocks/axios.ts",
    ".*infrastructure/db/prismaClient$": "<rootDir>/test/mocks/prismaClient.ts",
  },
};

export default config;
