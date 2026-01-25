import { prisma } from "../../../src/infrastructure/db/prismaClient";

export async function truncateAllTables() {
  // pega todas as tabelas do schema public
  const rows = await prisma.$queryRawUnsafe<
    Array<{ tablename: string }>
  >(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
  `);

  if (!rows.length) return;

  const tables = rows.map((r) => `"public"."${r.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE;`);
}