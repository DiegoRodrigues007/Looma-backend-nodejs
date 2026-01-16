import crypto from "crypto";

const STATE_SIGN_SECRET =
  process.env.IG_STATE_SIGN_SECRET ||
  process.env.JWT_SECRET ||
  "dev_secret_change_me";

export function signState(payload: string) {
  const h = crypto
    .createHmac("sha256", STATE_SIGN_SECRET)
    .update(payload)
    .digest("hex");

  return `${payload}.${h}`;
}

export function verifyState(signed: string): string | null {
  const idx = signed.lastIndexOf(".");
  if (idx <= 0) return null;

  const payload = signed.slice(0, idx);
  const sig = signed.slice(idx + 1);

  const expected = crypto
    .createHmac("sha256", STATE_SIGN_SECRET)
    .update(payload)
    .digest("hex");

  if (sig.length !== expected.length) return null;

  const ok = crypto.timingSafeEqual(
    Buffer.from(sig, "utf8"),
    Buffer.from(expected, "utf8")
  );

  return ok ? payload : null;
}

export function safeParseState(state: string): { uid?: string; returnTo?: string } {
  const verified = verifyState(state);
  if (!verified) return {};

  try {
    const parsed = JSON.parse(verified);
    return {
      uid: parsed?.uid != null ? String(parsed.uid) : undefined,
      returnTo: typeof parsed?.returnTo === "string" ? String(parsed.returnTo) : undefined,
    };
  } catch {
    return {};
  }
}
