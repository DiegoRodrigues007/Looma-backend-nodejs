import crypto from "crypto";

function base64url(input: Buffer | string) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export function signJwtHS256(payload: Record<string, any>, secret: string) {
  const header = { alg: "HS256", typ: "JWT" };
  const encHeader = base64url(JSON.stringify(header));
  const encPayload = base64url(JSON.stringify(payload));

  const data = `${encHeader}.${encPayload}`;
  const sig = crypto.createHmac("sha256", secret).update(data).digest();
  const encSig = base64url(sig);

  return `${data}.${encSig}`;
}

export function makeAuthHeader(userId = "test-user-1") {
  // ⚠️ Se seu authMiddleware usa outro env, ajuste aqui
  const secret = process.env.JWT_SECRET || "dev-secret";

  const token = signJwtHS256(
    {
      sub: userId,
      userId,
      iat: Math.floor(Date.now() / 1000),
    },
    secret
  );

  return `Bearer ${token}`;
}