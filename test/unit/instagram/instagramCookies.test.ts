import type { Request, Response } from "express";

describe("instagramCookies (session) — robust/fuzz", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  function makeRes() {
    const res = {
      cookie: jest.fn(),
      clearCookie: jest.fn(),
    } as unknown as Response;
    return res;
  }

  function randInt(min: number, max: number) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function randStr(len: number) {
    const chars =
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-:.@";
    let out = "";
    for (let i = 0; i < len; i++) out += chars[randInt(0, chars.length - 1)];
    return out;
  }

  it("setIgLoginCookie: deve setar cookie seguro (httpOnly, sameSite, path, maxAge)", () => {
    const {
      setIgLoginCookie,
      IG_LOGIN_UID_COOKIE,
    } = require("../../../src/presentation/http/instagram/instagramCookies");

    process.env.NODE_ENV = "development";
    const res = makeRes();

    setIgLoginCookie(res, "user-123");

    expect((res as any).cookie).toHaveBeenCalledTimes(1);

    const [name, value, opts] = (res as any).cookie.mock.calls[0];

    expect(name).toBe(IG_LOGIN_UID_COOKIE);
    expect(value).toBe("user-123");
    expect(opts).toEqual(
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        maxAge: 10 * 60 * 1000,
        path: "/",
      }),
    );
  });

  it("setIgLoginCookie: secure deve ser true em produção", () => {
    const {
      setIgLoginCookie,
    } = require("../../../src/presentation/http/instagram/instagramCookies");

    process.env.NODE_ENV = "production";
    const res = makeRes();

    setIgLoginCookie(res, "user-123");

    const [, , opts] = (res as any).cookie.mock.calls[0];
    expect(opts.secure).toBe(true);
  });

  it("getIgLoginCookie: deve ler req.cookies e retornar string trimada", () => {
    const {
      getIgLoginCookie,
      IG_LOGIN_UID_COOKIE,
    } = require("../../../src/presentation/http/instagram/instagramCookies");

    const req = {
      cookies: {
        [IG_LOGIN_UID_COOKIE]: "  user-999  ",
      },
    } as unknown as Request;

    expect(getIgLoginCookie(req)).toBe("user-999");
  });

  it("getIgLoginCookie: deve retornar null se cookie ausente/vazio/não-string", () => {
    const {
      getIgLoginCookie,
      IG_LOGIN_UID_COOKIE,
    } = require("../../../src/presentation/http/instagram/instagramCookies");

    const req1 = { cookies: {} } as unknown as Request;
    const req2 = {
      cookies: { [IG_LOGIN_UID_COOKIE]: "   " },
    } as unknown as Request;
    const req3 = {
      cookies: { [IG_LOGIN_UID_COOKIE]: 123 },
    } as unknown as Request;

    expect(getIgLoginCookie(req1)).toBeNull();
    expect(getIgLoginCookie(req2)).toBeNull();
    expect(getIgLoginCookie(req3)).toBeNull();
  });

  it("clearIgLoginCookie: deve limpar cookie com path '/'", () => {
    const {
      clearIgLoginCookie,
      IG_LOGIN_UID_COOKIE,
    } = require("../../../src/presentation/http/instagram/instagramCookies");

    const res = makeRes();
    clearIgLoginCookie(res);

    expect((res as any).clearCookie).toHaveBeenCalledWith(IG_LOGIN_UID_COOKIE, {
      path: "/",
    });
  });

  it("stress: 3000 valores diferentes devem sempre aplicar opções seguras (dev e prod)", () => {
    const {
      setIgLoginCookie,
      IG_LOGIN_UID_COOKIE,
    } = require("../../../src/presentation/http/instagram/instagramCookies");

    const res = makeRes();

    process.env.NODE_ENV = "development";
    for (let i = 0; i < 1500; i++) {
      (res as any).cookie.mockClear();

      const uid = randStr(randInt(1, 60));
      setIgLoginCookie(res, uid);

      const [name, value, opts] = (res as any).cookie.mock.calls[0];

      expect(name).toBe(IG_LOGIN_UID_COOKIE);
      expect(value).toBe(uid);
      expect(opts.httpOnly).toBe(true);
      expect(opts.sameSite).toBe("lax");
      expect(opts.path).toBe("/");
      expect(opts.maxAge).toBe(10 * 60 * 1000);
      expect(opts.secure).toBe(false);
    }

    process.env.NODE_ENV = "production";
    for (let i = 0; i < 1500; i++) {
      (res as any).cookie.mockClear();

      const uid = randStr(randInt(1, 60));
      setIgLoginCookie(res, uid);

      const [name, value, opts] = (res as any).cookie.mock.calls[0];

      expect(name).toBe(IG_LOGIN_UID_COOKIE);
      expect(value).toBe(uid);
      expect(opts.httpOnly).toBe(true);
      expect(opts.sameSite).toBe("lax");
      expect(opts.path).toBe("/");
      expect(opts.maxAge).toBe(10 * 60 * 1000);
      expect(opts.secure).toBe(true);
    }
  });

  it("stress: getIgLoginCookie nunca deve dar throw com cookies estranhos", () => {
    const {
      getIgLoginCookie,
      IG_LOGIN_UID_COOKIE,
    } = require("../../../src/presentation/http/instagram/instagramCookies");

    const weirdCookies: any[] = [
      null,
      undefined,
      0,
      1,
      true,
      false,
      [],
      {},
      { x: 1 },
      { [IG_LOGIN_UID_COOKIE]: null },
      { [IG_LOGIN_UID_COOKIE]: undefined },
      { [IG_LOGIN_UID_COOKIE]: "" },
      { [IG_LOGIN_UID_COOKIE]: "   " },
      { [IG_LOGIN_UID_COOKIE]: 999 },
      { [IG_LOGIN_UID_COOKIE]: { a: 1 } },
      { [IG_LOGIN_UID_COOKIE]: ["a"] },
      { [IG_LOGIN_UID_COOKIE]: " user " },
      { [IG_LOGIN_UID_COOKIE]: "\n\r\tuser\n" },
    ];

    for (const cookies of weirdCookies) {
      const req = { cookies } as any as Request;

      expect(() => getIgLoginCookie(req)).not.toThrow();

      const v = getIgLoginCookie(req);
      if (typeof cookies?.[IG_LOGIN_UID_COOKIE] === "string") {
        const trimmed = cookies[IG_LOGIN_UID_COOKIE].trim();
        expect(v).toBe(trimmed ? trimmed : null);
      } else {
        expect(v).toBeNull();
      }
    }
  });

  it("segurança: não deve permitir cookie 'injection' via valor (não muda as options)", () => {
    const {
      setIgLoginCookie,
    } = require("../../../src/presentation/http/instagram/instagramCookies");

    process.env.NODE_ENV = "production";
    const res = makeRes();

    const injected = "user-1\r\nSet-Cookie: hacked=1";
    setIgLoginCookie(res, injected);

    const [, value, opts] = (res as any).cookie.mock.calls[0];

    expect(value).toBe(injected);
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe("lax");
    expect(opts.secure).toBe(true);
    expect(opts.path).toBe("/");
  });
});
