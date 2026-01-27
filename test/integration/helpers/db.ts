// test/integration/helpers/db.ts
import type { PrismaClient } from "@prisma/client";

/**
 * Trunca todas as tabelas do schema public (exceto _prisma_migrations).
 * ✅ Postgres only
 * ✅ RESTART IDENTITY + CASCADE
 */
export async function truncateAllTables(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
  `);

  const tables = (rows ?? [])
    .map((r) => String(r?.tablename ?? "").trim())
    .filter(Boolean);

  if (tables.length === 0) return;

  const quoted = tables
    .map((t) => `"public"."${t.replace(/"/g, '""')}"`)
    .join(", ");

  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE;`
  );
}