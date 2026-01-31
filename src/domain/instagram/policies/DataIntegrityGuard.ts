import { InstagramDomainError } from "../errors/InstagramDomainError";

export type IntegrityIssue =
  | { kind: "non_finite_number"; field: string; value: unknown }
  | { kind: "negative_number"; field: string; value: number }
  | { kind: "missing_required"; field: string };

export type IntegrityResult<T> = {
  ok: true;
  value: T;
  issues: IntegrityIssue[];
} | {
  ok: false;
  issues: IntegrityIssue[];
  error: InstagramDomainError;
};

function toFiniteNonNegative(n: unknown): { value: number; issues: IntegrityIssue[] } {
  const issues: IntegrityIssue[] = [];
  const num = Number(n);
  if (!Number.isFinite(num)) {
    issues.push({ kind: "non_finite_number", field: "value", value: n });
    return { value: 0, issues };
  }
  if (num < 0) {
    issues.push({ kind: "negative_number", field: "value", value: num });
    return { value: 0, issues };
  }
  return { value: num, issues };
}

export const DataIntegrityGuard = {
  nonNegativeInt(field: string, v: unknown): { value: number; issues: IntegrityIssue[] } {
    const base = toFiniteNonNegative(v);
    const rounded = Math.floor(base.value);
    const issues = [...base.issues];

    if (!Number.isFinite(rounded)) {
      issues.push({ kind: "non_finite_number", field, value: v });
      return { value: 0, issues };
    }
    if (rounded < 0) {
      issues.push({ kind: "negative_number", field, value: rounded });
      return { value: 0, issues };
    }

    const fixedIssues = issues.map((i) => (i.kind === "non_finite_number" || i.kind === "negative_number"
      ? { ...i, field }
      : i
    ));

    return { value: rounded, issues: fixedIssues };
  },

  requireString(field: string, v: unknown): IntegrityResult<string> {
    const s = String(v ?? "").trim();
    if (!s) {
      const issues: IntegrityIssue[] = [{ kind: "missing_required", field }];
      return {
        ok: false,
        issues,
        error: InstagramDomainError.dataIntegrity(`Missing required field: ${field}`, { field }),
      };
    }
    return { ok: true, value: s, issues: [] };
  },
};
