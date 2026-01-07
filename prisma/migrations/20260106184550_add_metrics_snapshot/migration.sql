/*
 ====================================================
 1) Criar ENUM MetricsPlatform (caso não exista)
 ====================================================
 */
DO $$ BEGIN CREATE TYPE "MetricsPlatform" AS ENUM ('instagram', 'youtube');
EXCEPTION
WHEN duplicate_object THEN null;
END $$;
/*
 ====================================================
 2) Criar tabela MetricsSnapshots (caso não exista)
 ====================================================
 */
CREATE TABLE IF NOT EXISTS "MetricsSnapshots" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "followers" INTEGER NOT NULL,
    "reach" INTEGER NOT NULL,
    "totalInteractions" INTEGER NOT NULL,
    "engagementRate" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MetricsSnapshots_pkey" PRIMARY KEY ("id")
);
/*
 ====================================================
 3) Normalizar valores antigos de platform (segurança)
 ====================================================
 */
UPDATE "MetricsSnapshots"
SET "platform" = LOWER("platform")
WHERE "platform" IS NOT NULL;
/*
 ====================================================
 4) Converter platform TEXT -> ENUM MetricsPlatform
 ====================================================
 */
ALTER TABLE "MetricsSnapshots"
ALTER COLUMN "platform" TYPE "MetricsPlatform" USING ("platform"::"MetricsPlatform");
/*
 ====================================================
 5) Criar índices (se não existirem)
 ====================================================
 */
CREATE INDEX IF NOT EXISTS "MetricsSnapshots_userId_platform_date_idx" ON "MetricsSnapshots"("userId", "platform", "date");
CREATE UNIQUE INDEX IF NOT EXISTS "MetricsSnapshots_userId_platform_date_key" ON "MetricsSnapshots"("userId", "platform", "date");
/*
 ====================================================
 6) Remover default de updatedAt (Prisma controla)
 ====================================================
 */
ALTER TABLE "MetricsSnapshots"
ALTER COLUMN "updatedAt" DROP DEFAULT;