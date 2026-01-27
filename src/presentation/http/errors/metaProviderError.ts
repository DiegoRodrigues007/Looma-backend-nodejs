import axios from "axios";

export function mapMetaProviderError(err: unknown):
  | { status: number; body: any }
  | null {
  if (!axios.isAxiosError(err)) return null;

  // quando provider cai: não tem response e vem code tipo ECONNREFUSED
  const code = String(err.code ?? "").toUpperCase();
  const hasResponse = !!err.response;

  const providerDownCodes = new Set([
    "ECONNREFUSED",
    "ENOTFOUND",
    "ETIMEDOUT",
    "ECONNRESET",
    "EAI_AGAIN",
    "EHOSTUNREACH",
    "ENETUNREACH",
  ]);

  if (!hasResponse && providerDownCodes.has(code)) {
    return {
      status: 502,
      body: {
        ok: false,
        message: "Falha ao consultar a Meta (provider fora do ar).",
        provider: "meta",
        code,
      },
    };
  }

  // também trate timeout sem code (às vezes acontece)
  if (!hasResponse && /timeout/i.test(String(err.message ?? ""))) {
    return {
      status: 502,
      body: {
        ok: false,
        message: "Falha ao consultar a Meta (timeout).",
        provider: "meta",
      },
    };
  }

  return null;
}