import { InstagramDomainError } from "../errors/InstagramDomainError";

export type IgUserId = string & { readonly __brand: "IgUserId" };

export function IgUserId(value: unknown): IgUserId {
  const s = String(value ?? "").trim();
  if (!s) {
    throw InstagramDomainError.invalidInput("IgUserId is required.");
  }
  if (!/^\d{3,30}$/.test(s)) {
    throw new InstagramDomainError({
      code: "INVALID_IG_USER_ID",
      message: "IgUserId must be a numeric string.",
      details: { value: s },
      retryable: false,
    });
  }
  return s as IgUserId;
}
