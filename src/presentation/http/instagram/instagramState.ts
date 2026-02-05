import crypto from "crypto";

const STATE_SIGN_SECRET =
  process.env.IG_STATE_SIGN_SECRET ||
  process.env.JWT_SECRET ||
  "dev_secret_change_me";

/**
 * Tempo máximo (ms) que um state é aceito.
 * Ex.: 10 minutos = 600000
 */
const STATE_MAX_AGE_MS = Number(process.env.IG_STATE_MAX_AGE_MS ?? "600000"); // 10min default

function s(v: any): string {
  return String(v ?? "").trim();
}

function hmacHex(payload: string): string {
  return crypto.createHmac("sha256", STATE_SIGN_SECRET).update(payload).digest("hex");
}

/**
 * Assina um payload string (normalmente JSON) e retorna:
 *   "<payload>.<hex_hmac>"
 *
 * ✅ Mantém compatibilidade com seu formato atual.
 */
export function signState(payload: string) {
  const p = s(payload);
  const h = hmacHex(p);
  return `${p}.${h}`;
}

/**
 * Verifica assinatura e retorna payload original (string) ou null.
 */
export function verifyState(signed: string): string | null {
  const v = s(signed);
  const idx = v.lastIndexOf(".");
  if (idx <= 0) return null;

  const payload = v.slice(0, idx);
  const sig = v.slice(idx + 1);

  if (!payload || !sig) return null;

  const expected = hmacHex(payload);

  // ✅ timingSafeEqual só é seguro se os buffers tiverem mesmo tamanho
  const sigBuf = Buffer.from(sig, "utf8");
  const expBuf = Buffer.from(expected, "utf8");
  if (sigBuf.length !== expBuf.length) return null;

  const ok = crypto.timingSafeEqual(sigBuf, expBuf);
  return ok ? payload : null;
}

export type ParsedIgState = {
  uid?: string;
  returnTo?: string;
  ts?: number;
  nonce?: string;
  valid?: boolean;
  reason?: string;
};

/**
 * Parse seguro do state:
 * - valida assinatura
 * - tenta parsear JSON
 * - opcionalmente valida expiração por "ts"
 */
export function safeParseState(state: string): ParsedIgState {
  const verified = verifyState(state);
  if (!verified) return { valid: false, reason: "invalid_signature" };

  let parsed: any;
  try {
    parsed = JSON.parse(verified);
  } catch {
    return { valid: false, reason: "invalid_json" };
  }

  const uid = parsed?.uid != null ? String(parsed.uid) : undefined;
  const returnTo = typeof parsed?.returnTo === "string" ? String(parsed.returnTo) : undefined;

  const tsRaw = parsed?.ts;
  const ts = typeof tsRaw === "number" && Number.isFinite(tsRaw) ? tsRaw : undefined;

  const nonceRaw = parsed?.nonce;
  const nonce = typeof nonceRaw === "string" ? s(nonceRaw) : undefined;

  // ✅ valida expiração se existir ts
  if (STATE_MAX_AGE_MS > 0 && ts) {
    const age = Date.now() - ts;
    if (age < 0) {
      return { uid, returnTo, ts, nonce, valid: false, reason: "ts_in_future" };
    }
    if (age > STATE_MAX_AGE_MS) {
      return { uid, returnTo, ts, nonce, valid: false, reason: "expired" };
    }
  }

  // uid é o mínimo necessário pra amarrar ao usuário
  if (!uid) {
    return { uid, returnTo, ts, nonce, valid: false, reason: "missing_uid" };
  }

  return { uid, returnTo, ts, nonce, valid: true };
}
