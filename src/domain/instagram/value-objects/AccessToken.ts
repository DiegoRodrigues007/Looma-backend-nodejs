import { InstagramDomainError } from "../errors/InstagramDomainError";

export type AccessToken = string & { readonly __brand: "AccessToken" };

export function AccessToken(value: unknown): AccessToken {
  const s = String(value ?? "").trim();

  if (!s) {
    throw new InstagramDomainError({
      code: "INVALID_TOKEN",
      message: "Access token is required.",
      retryable: false,
    });
  }

  if (s.length < 10) {
    throw new InstagramDomainError({
      code: "INVALID_TOKEN",
      message: "Access token looks too short.",
      details: { length: s.length },
      retryable: false,
    });
  }

  return s as AccessToken;
}
