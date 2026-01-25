import type { AnyObj } from "./types";

export function pickItems(body: AnyObj): any[] {
  if (!body || typeof body !== "object") return [];
  const candidates = [
    body.items,
    body.data,
    body.posts,
    body.results,
    body?.payload?.items,
    body?.payload?.data,
  ];
  const found = candidates.find((v) => Array.isArray(v));
  return Array.isArray(found) ? found : [];
}

export function pickJob(body: AnyObj): AnyObj | null {
  if (!body || typeof body !== "object") return null;
  const candidates = [body.job, body.data, body.payload, body];
  const found = candidates.find((v) => v && typeof v === "object");
  return (found as AnyObj) ?? null;
}

export function pickStatus(body: AnyObj): string | null {
  const job = pickJob(body);
  const s =
    (job?.status as string) ??
    (body?.status as string) ??
    (body?.data?.status as string);
  return typeof s === "string" ? s : null;
}

export function assertBasicJsonOk(body: AnyObj) {
  // “ok” pode existir ou não, então a validação é flexível mas forte:
  // - body deve ser objeto
  // - se existir "ok", deve ser boolean
  expect(body).toBeTruthy();
  expect(typeof body).toBe("object");
  if ("ok" in body) {
    expect(typeof (body as AnyObj).ok).toBe("boolean");
  }
}

export function assertHasRequestIdMaybe(body: AnyObj) {
  // se você tiver requestId/correlationId algum dia, já fica coberto
  const v =
    body.requestId ??
    body.correlationId ??
    body.traceId ??
    body.meta?.requestId;
  if (v !== undefined) {
    expect(typeof v).toBe("string");
    expect(v.length).toBeGreaterThan(6);
  }
}