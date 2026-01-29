export function normalizePercent(value: any): number {
  // 1) normaliza string pt-BR "25,5" -> "25.5"
  const raw =
    typeof value === "string" ? value.trim().replace(",", ".") : value;

  // 2) converte
  const v = typeof raw === "number" ? raw : Number(raw);

  // 3) defensivo
  if (!Number.isFinite(v)) return 0;

  // 4) negativos nunca
  if (v < 0) return 0;

  // 5) 0..1 vira 0..100
  if (v > 0 && v <= 1) return v * 100;

  // 6) já está em 0..100 (ou acima) -> mantém
  return v;
}