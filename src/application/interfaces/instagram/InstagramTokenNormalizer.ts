function s(v: unknown): string {
  return String(v ?? "").trim();
}

function safeDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  const d = new Date(String(v));
  return Number.isFinite(d.getTime()) ? d : null;
}

function asNumber(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export type RefreshProviderOutput =
  | string
  | {
      accessToken?: string | null;
      access_token?: string | null;
      expiresAt?: Date | string | null;
      expiresIn?: number | string | null;
      expires_in?: number | string | null;
    };

export type NormalizedInstagramToken = {
  accessToken: string;
  expiresAt: Date | null;
};

export type NormalizeOptions = {
  fallbackDays?: number;
};

export function normalizeInstagramToken(
  out: RefreshProviderOutput,
  opts?: NormalizeOptions
): NormalizedInstagramToken {
  const fallbackDays = Number(opts?.fallbackDays ?? 60);

  const fallbackExpiresAt = () =>
    new Date(Date.now() + fallbackDays * 24 * 60 * 60 * 1000);

  if (typeof out === "string") {
    return { accessToken: out, expiresAt: fallbackExpiresAt() };
  }

  const accessToken = s(out?.accessToken ?? out?.access_token);
  if (!accessToken) {
    throw new Error("Refresh do token retornou vazio. Refaça o login.");
  }

  const expDate = safeDate(out?.expiresAt ?? null);
  if (expDate) return { accessToken, expiresAt: expDate };

  const expIn =
    asNumber(out?.expiresIn) ?? asNumber(out?.expires_in) ?? null;

  if (expIn != null && expIn > 0) {
    return { accessToken, expiresAt: new Date(Date.now() + expIn * 1000) };
  }

  return { accessToken, expiresAt: fallbackExpiresAt() };
}