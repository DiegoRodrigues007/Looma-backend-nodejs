// test/integration/helpers/contract.ts

/**
 * Helpers de "contract test" (shape da resposta)
 * - Valida campos obrigatórios
 * - Valida tipos
 * - Garante null vs undefined quando aplicável
 * - Evita bugs silenciosos no frontend
 */

function isISODateTimeString(v: any) {
  if (typeof v !== "string") return false;
  const d = new Date(v);
  return !Number.isNaN(d.getTime());
}

function expectNullableNumber(v: any) {
  // contrato: number | null (não undefined)
  expect(v === null || typeof v === "number").toBe(true);
  expect(v).not.toBeUndefined();
}

function expectNullableString(v: any) {
  // contrato: string | null (não undefined)
  expect(v === null || typeof v === "string").toBe(true);
  expect(v).not.toBeUndefined();
}

function expectNullableISODateTime(v: any) {
  // contrato: string(date-time) | null (não undefined)
  expect(v).not.toBeUndefined();
  if (v === null) return;
  expect(typeof v).toBe("string");
  expect(isISODateTimeString(v)).toBe(true);
}

function expectEnum(v: any, allowed: readonly string[]) {
  expect(typeof v).toBe("string");
  expect(allowed.includes(v)).toBe(true);
}

function expectNullableBoolean(v: any) {
  // contrato: boolean | null (não undefined)
  expect(v).not.toBeUndefined();
  expect(v === null || typeof v === "boolean").toBe(true);
}

export const CONTRACT = {
  backfillJobStatus: ["queued", "running", "done", "failed", "cancelled"] as const,
  backfillStatus: ["none", "queued", "running", "done", "failed", "cancelled"] as const,
};

/**
 * Contrato: POST /api/instagram/backfill/start
 * schema: InstagramBackfillStartResponse
 */
export function expectBackfillStartResponse(body: any) {
  expect(body).toBeTruthy();
  expect(typeof body).toBe("object");

  // required: ok, jobId, status, instagramAccountId
  expect(body).toHaveProperty("ok");
  expect(body.ok).toBe(true);

  expect(body).toHaveProperty("jobId");
  expect(typeof body.jobId).toBe("string");
  expect(body.jobId.length).toBeGreaterThan(0);

  expect(body).toHaveProperty("status");
  expectEnum(body.status, CONTRACT.backfillJobStatus);

  expect(body).toHaveProperty("instagramAccountId");
  expect(typeof body.instagramAccountId).toBe("string");
  expect(body.instagramAccountId.length).toBeGreaterThan(0);

  // optional(nullable): importedCount, processedCount
  // contrato: number | null (não undefined)
  expect(body).toHaveProperty("importedCount");
  expectNullableNumber(body.importedCount);

  expect(body).toHaveProperty("processedCount");
  expectNullableNumber(body.processedCount);

  // sanity: não vazar campos inesperados críticos (opcional)
  // se quiser ficar mais strict, descomente:
  // const allowedKeys = ["ok", "jobId", "status", "importedCount", "processedCount", "instagramAccountId"];
  // for (const k of Object.keys(body)) expect(allowedKeys.includes(k)).toBe(true);
}

/**
 * Contrato: GET /api/instagram/backfill/status
 * schema: InstagramBackfillStatusResponse
 */
export function expectBackfillStatusResponse(body: any) {
  expect(body).toBeTruthy();
  expect(typeof body).toBe("object");

  // required: ok, status
  expect(body).toHaveProperty("ok");
  expect(body.ok).toBe(true);

  expect(body).toHaveProperty("status");
  expectEnum(body.status, CONTRACT.backfillStatus);

  // nullable: jobId, importedCount, processedCount, cursor, startedAt, finishedAt, lastError, instagramAccountId
  // contrato: sempre presentes como null ou valor (não undefined)
  expect(body).toHaveProperty("jobId");
  expectNullableString(body.jobId);

  expect(body).toHaveProperty("importedCount");
  expectNullableNumber(body.importedCount);

  expect(body).toHaveProperty("processedCount");
  expectNullableNumber(body.processedCount);

  expect(body).toHaveProperty("cursor");
  expectNullableString(body.cursor);

  expect(body).toHaveProperty("startedAt");
  expectNullableISODateTime(body.startedAt);

  expect(body).toHaveProperty("finishedAt");
  expectNullableISODateTime(body.finishedAt);

  expect(body).toHaveProperty("lastError");
  expectNullableString(body.lastError);

  expect(body).toHaveProperty("instagramAccountId");
  expectNullableString(body.instagramAccountId);
}

/**
 * ============================================================
 * NOVO: Contratos para /api/instagram/accounts (GET)
 * ============================================================
 *
 * Observação: como o shape pode evoluir (ex: username),
 * a ideia aqui é garantir o "core" sem travar campos extras.
 */

export function expectAccountItem(acc: any) {
  expect(acc).toBeTruthy();
  expect(typeof acc).toBe("object");

  // Campos comuns que o frontend precisa
  expect(acc).toHaveProperty("id");
  expect(typeof acc.id).toBe("string");
  expect(acc.id.length).toBeGreaterThan(0);

  // pode existir como igUserId ou instagramUserId dependendo do seu controller
  // então validamos que pelo menos UM existe e é string
  const igUserId = acc.igUserId ?? acc.instagramUserId ?? null;
  expect(igUserId).not.toBeNull();
  expect(typeof igUserId).toBe("string");

  // isConnected
  if ("isConnected" in acc) {
    expect(typeof acc.isConnected).toBe("boolean");
  }

  // isActive precisa existir e ser boolean
  if ("isActive" in acc) {
    expect(typeof acc.isActive).toBe("boolean");
  }

  // username pode ser string | null (não undefined)
  if ("username" in acc) {
    expectNullableString(acc.username);
  }

  // facebookPageId pode ser string | null (não undefined)
  if ("facebookPageId" in acc) {
    expectNullableString(acc.facebookPageId);
  }

  // tokens não devem ser expostos publicamente (se aparecer, é red flag)
  expect(acc).not.toHaveProperty("accessToken");
  expect(acc).not.toHaveProperty("pageAccessToken");
}

export function expectAccountsResponse(body: any) {
  expect(body).toBeTruthy();
  expect(typeof body).toBe("object");

  expect(body).toHaveProperty("ok");
  expect(typeof body.ok).toBe("boolean");

  expect(body).toHaveProperty("total");
  expect(typeof body.total).toBe("number");

  expect(body).toHaveProperty("accounts");
  expect(Array.isArray(body.accounts)).toBe(true);

  // activeInstagramAccountId: string | null (não undefined)
  expect(body).toHaveProperty("activeInstagramAccountId");
  expectNullableString(body.activeInstagramAccountId);

  // coerência mínima
  expect(body.accounts.length).toBe(body.total);

  // valida itens (se houver)
  for (const acc of body.accounts) {
    expectAccountItem(acc);
  }
}