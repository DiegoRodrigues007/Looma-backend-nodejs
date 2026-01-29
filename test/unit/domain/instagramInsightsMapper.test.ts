import {
  toFiniteNumber,
  mapInsightByDayRobust,
} from "../../../src/domain/metrics/instagram/instagramInsightsMapper";

describe("domain instagramInsightsMapper", () => {
  function expectFiniteNonNegative(n: unknown) {
    expect(typeof n).toBe("number");
    expect(Number.isFinite(n as number)).toBe(true);
    expect((n as number) >= 0).toBe(true);
  }

  describe("toFiniteNumber", () => {
    it("deve lidar com number, string e inválidos", () => {
      expect(toFiniteNumber(10)).toBe(10);
      expect(toFiniteNumber("12")).toBe(12);
      expect(toFiniteNumber("12,5")).toBe(12.5);
      expect(toFiniteNumber("")).toBe(0);
      expect(toFiniteNumber("abc")).toBe(0);
      expect(toFiniteNumber(null)).toBe(0);
      expect(toFiniteNumber(undefined)).toBe(0);
    });

    it("deve desempacotar objetos (value/total_value/values)", () => {
      expect(toFiniteNumber({ value: 7 })).toBe(7);
      expect(toFiniteNumber({ total_value: 9 })).toBe(9);
      expect(toFiniteNumber({ values: [{ value: 3 }] })).toBe(3);
      expect(toFiniteNumber({ values: [{ value: "4" }] })).toBe(4);
      expect(toFiniteNumber({ values: [] })).toBe(0);
    });

    it("nunca deve retornar NaN/Infinity (stress com entradas insanas)", () => {
      const insane: any[] = [
        Number.NaN,
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
        "NaN",
        "Infinity",
        "-Infinity",
        "   ",
        "\n\t",
        "-10",
        "-10,5",
        "1e309",
        {},
        { value: Number.NaN },
        { value: "abc" },
        { total_value: Number.POSITIVE_INFINITY },
        { total_value: "-999999999999999999999999" },
        { values: [{ value: undefined }] },
        { values: [{ value: null }] },
        { values: [{ value: "12,3" }] },
        { values: [{ value: {} }] },
        { values: [{}] },
        { values: [] },
        { values: null },
        { values: "banana" },
        { value: { nested: 1 } },
      ];

      for (const v of insane) {
        const out = toFiniteNumber(v as any);
        expectFiniteNonNegative(out);
      }
    });

    it("deve ser idempotente: aplicar duas vezes não muda o resultado", () => {
      const samples: any[] = [
        0,
        10,
        "10",
        "10,5",
        "",
        "abc",
        null,
        undefined,
        { value: 7 },
        { total_value: 9 },
        { values: [{ value: 3 }] },
      ];

      for (const s of samples) {
        const a = toFiniteNumber(s);
        const b = toFiniteNumber(a);
        expect(b).toBe(a);
      }
    });

    it("negativos devem virar 0 (se sua função normaliza para não-negativo)", () => {
      const negatives: any[] = [
        -1,
        "-1",
        "-1,5",
        { value: -10 },
        { total_value: "-20" },
        { values: [{ value: -3 }] },
      ];

      for (const n of negatives) {
        const out = toFiniteNumber(n);
        expectFiniteNonNegative(out);
      }
    });
  });

  describe("mapInsightByDayRobust", () => {
    it("deve inicializar todos os dias com fallback", () => {
      const out = mapInsightByDayRobust(
        [],
        "reach",
        ["2026-01-10", "2026-01-11"],
        0,
      );
      expect(out).toEqual({ "2026-01-10": 0, "2026-01-11": 0 });
    });

    it("deve preencher por end_time quando existir values[]", () => {
      const insights = [
        {
          name: "reach",
          values: [
            { end_time: "2026-01-10T07:00:00+0000", value: 10 },
            { end_time: "2026-01-11T07:00:00+0000", value: "20" },
          ],
        },
      ];

      const out = mapInsightByDayRobust(
        insights as any,
        "reach",
        ["2026-01-10", "2026-01-11"],
        0,
      );
      expect(out).toEqual({ "2026-01-10": 10, "2026-01-11": 20 });
    });

    it("sem values[]: se houver total_value/value e só 1 dia, deve setar esse dia", () => {
      const insights = [{ name: "profile_views", total_value: 99 }];
      const out = mapInsightByDayRobust(
        insights as any,
        "profile_views",
        ["2026-01-10"],
        0,
      );
      expect(out).toEqual({ "2026-01-10": 99 });
    });

    it("se métrica não existir, mantém fallback", () => {
      const insights = [
        {
          name: "reach",
          values: [{ end_time: "2026-01-10T00:00:00Z", value: 10 }],
        },
      ];
      const out = mapInsightByDayRobust(
        insights as any,
        "comments",
        ["2026-01-10"],
        5,
      );
      expect(out).toEqual({ "2026-01-10": 5 });
    });

    it("nunca remove dias: sempre retorna exatamente as chaves do período", () => {
      const days = ["2026-01-10", "2026-01-11", "2026-01-12"];
      const out = mapInsightByDayRobust([], "reach", days, 7);

      expect(Object.keys(out).sort()).toEqual([...days].sort());
      for (const d of days) expect(out[d]).toBe(7);
    });

    it("deve ignorar valores fora da janela de days", () => {
      const insights = [
        {
          name: "reach",
          values: [
            { end_time: "2026-01-09T07:00:00+0000", value: 999 },
            { end_time: "2026-01-10T07:00:00+0000", value: 10 },
            { end_time: "2026-01-13T07:00:00+0000", value: 888 },
          ],
        },
      ];

      const out = mapInsightByDayRobust(
        insights as any,
        "reach",
        ["2026-01-10", "2026-01-11"],
        0,
      );
      expect(out).toEqual({ "2026-01-10": 10, "2026-01-11": 0 });
    });

    it("deve lidar com end_time em formatos diferentes (Z, +0000, com milissegundos)", () => {
      const insights = [
        {
          name: "reach",
          values: [
            { end_time: "2026-01-10T00:00:00Z", value: 1 },
            { end_time: "2026-01-11T23:59:59.999Z", value: 2 },
            { end_time: "2026-01-12T07:00:00+0000", value: 3 },
          ],
        },
      ];

      const out = mapInsightByDayRobust(
        insights as any,
        "reach",
        ["2026-01-10", "2026-01-11", "2026-01-12"],
        0,
      );
      expect(out).toEqual({
        "2026-01-10": 1,
        "2026-01-11": 2,
        "2026-01-12": 3,
      });
    });

    it("duplicados no mesmo dia: deve ser determinístico (último vence)", () => {
      const insights = [
        {
          name: "reach",
          values: [
            { end_time: "2026-01-10T07:00:00+0000", value: 10 },
            { end_time: "2026-01-10T08:00:00+0000", value: 20 },
          ],
        },
      ];

      const out = mapInsightByDayRobust(
        insights as any,
        "reach",
        ["2026-01-10"],
        0,
      );
      expect(out["2026-01-10"]).toBe(20);
    });

    it("valores inválidos dentro de values[] não devem virar NaN (fallback aplicado)", () => {
      const insights = [
        {
          name: "reach",
          values: [
            { end_time: "2026-01-10T07:00:00+0000", value: "abc" },
            { end_time: "2026-01-11T07:00:00+0000", value: Number.NaN },
            {
              end_time: "2026-01-12T07:00:00+0000",
              value: Number.POSITIVE_INFINITY,
            },
          ],
        },
      ];

      const out = mapInsightByDayRobust(
        insights as any,
        "reach",
        ["2026-01-10", "2026-01-11", "2026-01-12"],
        5,
      );

      expectFiniteNonNegative(out["2026-01-10"]);
      expectFiniteNonNegative(out["2026-01-11"]);
      expectFiniteNonNegative(out["2026-01-12"]);
    });

    it("stress: não deve explodir com volume alto e sempre retornar números finitos", () => {
      const days = Array.from({ length: 60 }, (_, i) => {
        const d = new Date(`2026-01-01T00:00:00.000Z`);
        d.setUTCDate(d.getUTCDate() + i);
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, "0");
        const dd = String(d.getUTCDate()).padStart(2, "0");
        return `${y}-${m}-${dd}`;
      });

      const values = days.map((d, i) => ({
        end_time: `${d}T07:00:00+0000`,
        value: i % 7 === 0 ? "abc" : String(i * 3),
      }));

      const insights = [{ name: "reach", values }];

      const out = mapInsightByDayRobust(insights as any, "reach", days, 0);

      expect(Object.keys(out).length).toBe(days.length);
      for (const d of days) {
        expectFiniteNonNegative(out[d]);
      }
    });

    it("quando days vier vazio, deve retornar objeto vazio (sem crash)", () => {
      const insights = [
        {
          name: "reach",
          values: [{ end_time: "2026-01-10T00:00:00Z", value: 10 }],
        },
      ];
      const out = mapInsightByDayRobust(insights as any, "reach", [], 0);
      expect(out).toEqual({});
    });
  });
});
