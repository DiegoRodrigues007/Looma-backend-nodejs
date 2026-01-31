// src/domain/repositories/IMetricsSnapshotRepository.ts

import { MetricsSnapshot, MetricsPlatform } from "../entities/MetricsSnapshot";

export interface IMetricsSnapshotRepository {
  /**
   * Salva um snapshot completo (create).
   * Se você quiser suportar upsert no futuro, pode criar outro método específico.
   */
  save(snapshot: MetricsSnapshot): Promise<void>;

  /**
   * Busca snapshot exato de uma data (normalmente início do dia UTC).
   */
  findByDate(
    userId: string,
    platform: MetricsPlatform,
    date: Date
  ): Promise<MetricsSnapshot | null>;

  /**
   * Busca snapshots no intervalo [from, to]
   */
  findRange(
    userId: string,
    platform: MetricsPlatform,
    from: Date,
    to: Date
  ): Promise<MetricsSnapshot[]>;

  /**
   * Último snapshot do usuário/plataforma (mais recente).
   */
  findLatest(
    userId: string,
    platform: MetricsPlatform
  ): Promise<MetricsSnapshot | null>;

  /**
   * Snapshot imediatamente anterior a uma data (antes de beforeDate).
   */
  findPrevious(
    userId: string,
    platform: MetricsPlatform,
    beforeDate: Date
  ): Promise<MetricsSnapshot | null>;

  // ------------------------------------------------------
  // ✅ Métodos utilitários (compatibilidade com casos atuais)
  // ------------------------------------------------------

  /**
   * Retorna apenas followers para uma data específica (atalho).
   * Útil para KPIs e cálculos rápidos sem carregar tudo.
   */
  getFollowersByUserPlatformDate(args: {
    userId: string;
    platform: MetricsPlatform;
    date: Date;
  }): Promise<number | null>;

  /**
   * Upsert focado em followers (atalho).
   * Mantém os outros campos existentes e atualiza apenas followers.
   */
  upsertFollowersSnapshot(args: {
    userId: string;
    platform: MetricsPlatform;
    date: Date;
    followers: number;
  }): Promise<void>;
}
