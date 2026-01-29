import crypto from "crypto";

describe("instagramState (security) — robust/fuzz", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    process.env.IG_STATE_SIGN_SECRET = "test_secret_super_strong_123";
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  function load() {
    return require("../../../src/presentation/http/instagram/instagramState") as typeof import("../../../src/presentation/http/instagram/instagramState");
  }

  function randInt(min: number, max: number) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function randAscii(len: number) {
    const chars =
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-:/?&=.%";
    let out = "";
    for (let i = 0; i < len; i++) out += chars[randInt(0, chars.length - 1)];
    return out;
  }

  function randUnicode(len: number) {
    const samples = [
      "á",
      "ç",
      "漢",
      "字",
      "😀",
      "🚀",
      "✨",
      "€",
      "£",
      "ß",
      "Ø",
      "Ж",
    ];
    let out = "";
    for (let i = 0; i < len; i++) {
      const useAscii = Math.random() < 0.7;
      out += useAscii ? randAscii(1) : samples[randInt(0, samples.length - 1)];
    }
    return out;
  }

  function mutateOneChar(s: string) {
    if (!s) return s;
    const i = randInt(0, s.length - 1);
    const c = s[i];
    const replacement = c === "a" ? "b" : "a";
    return s.slice(0, i) + replacement + s.slice(i + 1);
  }

  it("roundtrip básico: signState -> verifyState retorna payload original", () => {
    const { signState, verifyState } = load();

    const payload = JSON.stringify({ uid: "user-1", returnTo: "/dashboard" });
    const signed = signState(payload);

    expect(typeof signed).toBe("string");
    expect(verifyState(signed)).toBe(payload);
  });

  it("determinismo: mesmo payload + mesmo secret => mesma assinatura", () => {
    const { signState } = load();

    const payload = JSON.stringify({ uid: "user-1", returnTo: "/a" });
    const a = signState(payload);
    const b = signState(payload);

    expect(a).toBe(b);
  });

  it("alteração mínima no payload invalida assinatura (ataque de tamper)", () => {
    const { signState, verifyState } = load();

    const payload = JSON.stringify({ uid: "user-1" });
    const signed = signState(payload);

    const [p, sig] = signed.split(".");
    const tamperedPayload = mutateOneChar(p);
    const tampered = `${tamperedPayload}.${sig}`;

    expect(verifyState(tampered)).toBeNull();
  });

  it("assinatura truncada/estendida deve falhar (evita bypass por parsing)", () => {
    const { signState, verifyState } = load();

    const payload = JSON.stringify({ uid: "user-1" });
    const signed = signState(payload);

    const [p, sig] = signed.split(".");
    expect(verifyState(`${p}.${sig.slice(0, 10)}`)).toBeNull();
    expect(verifyState(`${p}.${sig}00`)).toBeNull();
  });

  it("formatos inválidos não podem dar throw e devem retornar null/{}", () => {
    const { verifyState, safeParseState } = load();

    const invalids = [
      "",
      ".",
      "no-dot-separator",
      "....",
      "a.b.c",
      "{}",
      "{}.",
      ".deadbeef",
      "payload.",
      "payload.deadbeef\nSet-Cookie: hacked=1",
    ];

    for (const s of invalids) {
      expect(() => verifyState(s)).not.toThrow();
      expect(() => safeParseState(s)).not.toThrow();

      expect(verifyState(s)).toBeNull();
      expect(safeParseState(s)).toEqual({});
    }
  });

  it("safeParseState: JSON inválido (mas assinado) deve retornar {} e nunca quebrar", () => {
    const { signState, safeParseState } = load();

    const payload = "{invalid_json";
    const signed = signState(payload);

    expect(() => safeParseState(signed)).not.toThrow();
    expect(safeParseState(signed)).toEqual({});
  });

  it("Fuzz: 2000 payloads aleatórios válidos devem verificar e parsear corretamente", () => {
    const { signState, verifyState, safeParseState } = load();

    const N = 2000;
    for (let i = 0; i < N; i++) {
      const uid = randAscii(randInt(1, 40));
      const returnTo = "/" + randAscii(randInt(0, 60));
      const payload = JSON.stringify({
        uid,
        returnTo,
        nonce: crypto.randomBytes(6).toString("hex"),
        weird: randUnicode(randInt(0, 20)),
      });

      const signed = signState(payload);

      expect(verifyState(signed)).toBe(payload);

      const parsed = safeParseState(signed);
      expect(parsed).toEqual(
        expect.objectContaining({
          uid: String(uid),
          returnTo: String(returnTo),
        }),
      );
    }
  });

  it("Fuzz malicioso: 2000 states adulterados devem SEMPRE falhar (verify null, parse {})", () => {
    const { signState, verifyState, safeParseState } = load();

    const N = 2000;
    for (let i = 0; i < N; i++) {
      const payload = JSON.stringify({
        uid: randAscii(randInt(1, 20)),
        returnTo: "/" + randAscii(randInt(0, 20)),
      });

      const signed = signState(payload);

      const variants = [
        mutateOneChar(signed),
        signed.slice(1),
        signed + "x",
        signed.replace(".", ".."),
      ];

      for (const v of variants) {
        expect(() => verifyState(v)).not.toThrow();
        expect(() => safeParseState(v)).not.toThrow();
        expect(verifyState(v)).toBeNull();
        expect(safeParseState(v)).toEqual({});
      }
    }
  });

  it("payload gigante: deve assinar/verificar sem quebrar (stress de tamanho)", () => {
    const { signState, verifyState, safeParseState } = load();

    const huge = JSON.stringify({
      uid: "user-1",
      returnTo: "/x",
      blob: randAscii(200_000),
    });

    const signed = signState(huge);

    expect(() => verifyState(signed)).not.toThrow();
    expect(verifyState(signed)).toBe(huge);

    expect(safeParseState(signed)).toEqual({ uid: "user-1", returnTo: "/x" });
  });
});
