// test/integration.setup.ts (ou o nome do seu setup de integração)
import { prisma } from "../../src/infrastructure/db/prismaClient";
import { truncateAllTables } from "./helpers/db";

// ⚠️ Importante:
// - Integração deve usar Prisma REAL (sem jest.mock no prismaClient)
// - Limpeza por TRUNCATE é pesada; prefira beforeEach só nos testes de integração

beforeEach(async () => {
  await truncateAllTables(prisma);
});

afterAll(async () => {
  await prisma.$disconnect();
});