import { makeAuthHeader } from "../../utils/jwt";

describe("Auth middleware - sanity", () => {
  it("makeAuthHeader deve gerar Bearer token", () => {
    const v = makeAuthHeader("user-1");
    expect(typeof v).toBe("string");
    expect(v.startsWith("Bearer ")).toBe(true);
    expect(v.length).toBeGreaterThan(20);
  });
});