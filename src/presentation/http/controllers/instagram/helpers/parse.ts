export function parseBool(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;

  const s = String(value).toLowerCase();
  if (s === "true" || s === "1") return true;
  if (s === "false" || s === "0") return false;

  return undefined;
}
