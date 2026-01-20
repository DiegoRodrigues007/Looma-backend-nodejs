export function clean(s: unknown, max = 520): string {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

export function extractNumbers(text: string) {
  return text.match(/\b\d+(\.\d+)?\b/g) ?? [];
}

export function hasForbiddenNumbers(text: string, allowed: Set<string>) {
  for (const n of extractNumbers(text)) {
    if (!allowed.has(n)) return true;
  }
  return false;
}

export function stripForbiddenNumbers(text: string, allowed: Set<string>) {
  const out = String(text ?? "").replace(/\b\d+(\.\d+)?\b/g, (m) =>
    allowed.has(m) ? m : ""
  );
  return clean(out, 520);
}

export function safeConfidence(x: any): "low" | "medium" | "high" {
  const c = String(x ?? "").trim().toLowerCase();
  return c === "high" || c === "low" || c === "medium" ? (c as any) : "medium";
}
