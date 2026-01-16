export function isInstagramTokenInvalid(err: any): boolean {
  const data = err?.response?.data;
  const code = data?.error?.code;
  const subcode = data?.error?.error_subcode;
  const message = String(data?.error?.message ?? "").toLowerCase();

  if (code === 190) return true;
  if (typeof subcode === "number" && [458, 459, 460, 463, 464, 467].includes(subcode)) return true;
  if (message.includes("invalid oauth access token")) return true;
  if (message.includes("session has expired")) return true;
  if (message.includes("has been invalidated")) return true;

  return false;
}
