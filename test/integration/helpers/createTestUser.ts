import crypto from "crypto";

export type TestUser = {
  userId: string; // id interno do seu app
  email: string;
  name: string;
  password: string;

  // se você quiser plugar no seu fluxo IG depois
  igUserId: string;
  facebookPageId: string;
  pageAccessToken: string;
  userAccessToken: string; // token "user" fake (se precisar simular)
};

type CreateTestUserOpts =
  Partial<Pick<TestUser, "userId" | "email" | "name" | "password">> &
  Partial<Pick<TestUser, "igUserId" | "facebookPageId">> & {
    /**
     * Prefixo pra facilitar debug no DB
     * ex: "it" | "e2e" | "local"
     */
    prefix?: string;
  };

function randHex(bytes = 6) {
  return crypto.randomBytes(bytes).toString("hex");
}

function normalizeEmailPrefix(s: string) {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ".")
    .replace(/[^a-z0-9._-]/g, "");
}

/**
 * ✅ Helper: createTestUser()
 * - gera usuário fake consistente pra testes
 * - te dá IDs + tokens fake pra plugar em mocks
 *
 * Uso:
 *   const u = createTestUser({ prefix: "e2e" });
 *   // u.userId, u.email, u.igUserId, etc...
 */
export function createTestUser(opts: CreateTestUserOpts = {}): TestUser {
  const prefix = normalizeEmailPrefix(opts.prefix ?? "test");
  const id = randHex(8);

  const userId = opts.userId ?? `user_${prefix}_${id}`;
  const name = opts.name ?? `Test User ${id.slice(0, 6)}`;
  const email = opts.email ?? `${prefix}.${id}@example.com`;
  const password = opts.password ?? "P@ssw0rd!";

  const igUserId = opts.igUserId ?? `ig_${id}`;
  const facebookPageId = opts.facebookPageId ?? `page_${id}`;

  // tokens fake (se seu código só precisa de "alguma string")
  const pageAccessToken = `PAGETOKEN_${randHex(12)}`;
  const userAccessToken = `USERTOKEN_${randHex(12)}`;

  return {
    userId,
    email,
    name,
    password,
    igUserId,
    facebookPageId,
    pageAccessToken,
    userAccessToken,
  };
}