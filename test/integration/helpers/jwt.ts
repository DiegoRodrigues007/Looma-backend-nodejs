import jwt from "jsonwebtoken";

/**
 * Lê uma variável de ambiente obrigatória.
 */
function mustEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Env ${name} não definido (verifique o .env.test)`);
  }
  return value;
}

/**
 * Gera o header Authorization no formato:
 *   Authorization: Bearer <token>
 *
 * ⚠️ REGRA CRÍTICA DO BACKEND:
 * - O authMiddleware resolve o usuário via `payload.sub`
 * - Portanto, `sub` PRECISA ser exatamente o `user.id` (UUID do banco)
 *
 * ❌ NÃO use email
 * ❌ NÃO use username
 * ✅ SEMPRE use user.id
 */
export function makeAuthHeader(userId: string): string {
  if (!userId || typeof userId !== "string") {
    throw new Error("makeAuthHeader requer um user.id válido (string UUID)");
  }

  const secret = mustEnv("JWT_SECRET");
  const issuer = mustEnv("JWT_ISSUER");
  const audience = mustEnv("JWT_AUDIENCE");

  const token = jwt.sign(
    {
      sub: userId, // 🔑 ponto central de tudo
    },
    secret,
    {
      issuer,
      audience,
      expiresIn: "1h",
    }
  );

  return `Bearer ${token}`;
}