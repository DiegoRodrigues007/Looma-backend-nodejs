import { prisma } from "../../src/infrastructure/db/prismaClient";
import { truncateAllTables } from "./helpers/db";

// Se você quiser rodar migrate automaticamente toda vez:
// - Recomendo rodar manualmente: npx prisma migrate deploy
// - Se quiser automatizar aqui, dá pra usar child_process.
// Por enquanto vamos só truncar.

beforeEach(async () => {
  await truncateAllTables();
});

afterAll(async () => {
  await prisma.$disconnect();
});