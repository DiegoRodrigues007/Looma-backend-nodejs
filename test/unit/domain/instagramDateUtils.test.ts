import {
  ymd,
  parseYmd,
  addDaysYmd,
  listDays,
} from "../../../src/shared/date/instagramDateUtils";

describe("domain/utils instagramDateUtils", () => {
  it("ymd deve retornar YYYY-MM-DD em UTC independentemente da hora", () => {
    const dates = [
      new Date("2026-01-10T00:00:00.000Z"),
      new Date("2026-01-10T12:34:56.000Z"),
      new Date("2026-01-10T23:59:59.999Z"),
    ];

    for (const d of dates) {
      expect(ymd(d)).toBe("2026-01-10");
    }
  });

  it("ymd nunca deve retornar string inválida", () => {
    for (let h = 0; h < 24; h++) {
      const d = new Date(`2026-01-10T${String(h).padStart(2, "0")}:00:00.000Z`);
      const out = ymd(d);

      expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(() => new Date(`${out}T00:00:00.000Z`).getTime()).not.toBeNaN();
    }
  });

  it("parseYmd deve validar formato e data real", () => {
    expect(parseYmd("2026-01-10").toISOString()).toBe(
      "2026-01-10T00:00:00.000Z",
    );

    const invalid = [
      "2026-1-10",
      "2026-01-1",
      "banana",
      "2026/01/10",
      "10-01-2026",
      "2026-02-30",
      "2026-13-01",
      "2026-00-10",
    ];

    for (const v of invalid) {
      expect(() => parseYmd(v)).toThrow();
    }
  });

  it("parseYmd sempre gera data UTC no início do dia", () => {
    const d = parseYmd("2026-05-20");
    expect(d.getUTCHours()).toBe(0);
    expect(d.getUTCMinutes()).toBe(0);
    expect(d.getUTCSeconds()).toBe(0);
    expect(d.getUTCMilliseconds()).toBe(0);
  });

  it("addDaysYmd deve somar dias atravessando mês e ano corretamente", () => {
    expect(addDaysYmd("2026-01-10", 1)).toBe("2026-01-11");
    expect(addDaysYmd("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDaysYmd("2025-12-31", 1)).toBe("2026-01-01");
    expect(addDaysYmd("2026-01-10", -10)).toBe("2025-12-31");
  });

  it("addDaysYmd deve ser reversível (ida e volta)", () => {
    const base = "2026-01-10";

    for (let i = -365; i <= 365; i += 7) {
      const forward = addDaysYmd(base, i);
      const back = addDaysYmd(forward, -i);
      expect(back).toBe(base);
    }
  });

  it("addDaysYmd nunca deve gerar data inválida mesmo sob stress", () => {
    for (let i = -1000; i <= 1000; i++) {
      const d = addDaysYmd("2026-01-10", i);
      expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(() => new Date(`${d}T00:00:00.000Z`).getTime()).not.toBeNaN();
    }
  });

  it("listDays deve ser inclusivo", () => {
    expect(listDays("2026-01-10", "2026-01-12")).toEqual([
      "2026-01-10",
      "2026-01-11",
      "2026-01-12",
    ]);
  });

  it("listDays deve retornar vazio se from > to", () => {
    expect(listDays("2026-01-12", "2026-01-10")).toEqual([]);
  });

  it("listDays sempre retorna dias ordenados e únicos", () => {
    const days = listDays("2026-01-01", "2026-12-31");

    const sorted = [...days].sort();
    const unique = new Set(days);

    expect(days).toEqual(sorted);
    expect(unique.size).toBe(days.length);
  });

  it("listDays mantém consistência com addDaysYmd", () => {
    const days = listDays("2026-03-01", "2026-03-10");

    for (let i = 0; i < days.length; i++) {
      expect(days[i]).toBe(addDaysYmd("2026-03-01", i));
    }
  });

  it("listDays não explode com ranges grandes", () => {
    const days = listDays("2025-01-01", "2026-12-31");

    expect(days.length).toBeGreaterThan(700);
    expect(days[0]).toBe("2025-01-01");
    expect(days[days.length - 1]).toBe("2026-12-31");
  });
});
