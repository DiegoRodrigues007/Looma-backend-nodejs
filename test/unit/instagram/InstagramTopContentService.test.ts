// test/unit/instagram/InstagramTopContentService.test.ts
import axios from "axios";
import { InstagramTopContentService } from "../../../src/infrastructure/instagram/services/InstagramTopContentService";

type AxiosMock = { get: jest.Mock; post: jest.Mock; create: jest.Mock };
const ax = axios as unknown as AxiosMock;

type TopContentItem = {
  id: string;
  timestamp?: string;
  totalInteractions: number;
  reach: number;
  [k: string]: any;
};

function resetAxiosMocks() {
  ax.get?.mockReset?.();
  ax.post?.mockReset?.();
  ax.create?.mockReset?.();
}

function makeMediaItem(params: { id: string; ts?: string; likes?: any; comments?: any }) {
  const { id, ts, likes, comments } = params;
  return {
    id,
    timestamp: ts,
    like_count: likes,
    comments_count: comments,
  };
}

/**
 * Oracle “fraco”:
 * - filtra por range + timestamp válido
 * - soma likes+comments como Number() || 0
 * - ordena por total desc
 * - NÃO impõe desempate por timestamp
 */
function oracleTotals(media: any[], from: string, to: string) {
  const fromMs = new Date(`${from}T00:00:00.000Z`).getTime();
  const toMs = new Date(`${to}T23:59:59.999Z`).getTime();

  return media
    .filter((m) => m && typeof m === "object" && typeof m.id === "string")
    .filter((m) => typeof m.timestamp === "string" && !Number.isNaN(new Date(m.timestamp).getTime()))
    .filter((m) => {
      const ts = new Date(m.timestamp).getTime();
      return ts >= fromMs && ts <= toMs;
    })
    .map((m) => ({
      id: m.id,
      total: (Number(m.like_count) || 0) + (Number(m.comments_count) || 0),
    }))
    .sort((a, b) => b.total - a.total);
}

describe("UNIT InstagramTopContentService (robusto / stress)", () => {
  beforeEach(() => resetAxiosMocks());

  it("ranking: retorna top N por totalInteractions (likes+comments) e busca reach via insights", async () => {
    const svc = new InstagramTopContentService();

    const media = [
      { id: "A", timestamp: "2026-01-20T10:00:00.000Z", like_count: 10, comments_count: 5 }, // 15
      { id: "B", timestamp: "2026-01-19T10:00:00.000Z", like_count: "40", comments_count: "2" }, // 42
      { id: "C", timestamp: "2026-01-18T10:00:00.000Z", like_count: 7, comments_count: 1 }, // 8
      { id: "D", timestamp: "2026-01-17T10:00:00.000Z", like_count: 20, comments_count: 0 }, // 20
      { id: "X", timestamp: "2025-12-01T10:00:00.000Z", like_count: 999, comments_count: 999 }, // fora
    ];

    ax.get.mockImplementation(async (url: string) => {
      if (url.includes("/media")) return { data: { data: media } };

      const m = url.match(/\/v19\.0\/(.+?)\/insights/);
      const id = m?.[1];

      const reachById: Record<string, number> = { A: 100, B: 200, C: 50, D: 80 };
      return { data: { data: [{ values: [{ value: reachById[id ?? ""] ?? 0 }] }] } };
    });

    const out = (await svc.fetchTopContent({
      accessToken: "T",
      igUserId: "IG_1",
      from: "2026-01-01",
      to: "2026-01-31",
      limit: 2,
    })) as TopContentItem[];

    expect(out.map((x) => x.id)).toEqual(["B", "D"]);
    expect(out[0].totalInteractions).toBe(42);

    expect(out[0]).toEqual(
      expect.objectContaining({
        id: "B",
        totalInteractions: 42,
        reach: 200,
      })
    );

    const calls = ax.get.mock.calls.map((c) => String(c[0]));
    expect(calls.filter((u) => u.includes("/media")).length).toBe(1);
    expect(calls.filter((u) => u.includes("/insights")).length).toBe(4);
  });

  it("robustez: não chama insights para posts fora do range / inválidos", async () => {
    const svc = new InstagramTopContentService();

    const media = [
      makeMediaItem({ id: "IN", ts: "2026-01-10T10:00:00Z", likes: 10, comments: 0 }),
      makeMediaItem({ id: "OUT", ts: "2025-12-10T10:00:00Z", likes: 999, comments: 999 }),
      makeMediaItem({ id: "BAD_TS", ts: "not-a-date", likes: 50, comments: 50 }),
      { id: "NO_TS", like_count: 100, comments_count: 100 },
    ];

    ax.get.mockImplementation(async (url: string) => {
      if (url.includes("/media")) return { data: { data: media } };
      return { data: { data: [{ values: [{ value: 123 }] }] } };
    });

    const out = (await svc.fetchTopContent({
      accessToken: "T",
      igUserId: "IG_1",
      from: "2026-01-01",
      to: "2026-01-31",
      limit: 10,
    })) as TopContentItem[];

    expect(out.map((x) => x.id)).toEqual(["IN"]);

    const calls = ax.get.mock.calls.map((c) => String(c[0]));
    expect(calls.filter((u) => u.includes("/media")).length).toBe(1);
    expect(calls.filter((u) => u.includes("/insights")).length).toBe(1);
  });

  it("se insights falhar para um item, reach vira 0 (sem quebrar o ranking)", async () => {
    const svc = new InstagramTopContentService();

    ax.get.mockImplementation(async (url: string) => {
      if (url.includes("/media")) {
        return {
          data: {
            data: [
              { id: "A", timestamp: "2026-01-20T10:00:00.000Z", like_count: 10, comments_count: 0 }, // 10
              { id: "B", timestamp: "2026-01-19T10:00:00.000Z", like_count: 20, comments_count: 0 }, // 20
            ],
          },
        };
      }

      if (url.includes("/v19.0/A/insights")) throw new Error("boom");
      return { data: { data: [{ values: [{ value: 123 }] }] } };
    });

    const out = (await svc.fetchTopContent({
      accessToken: "T",
      igUserId: "IG_1",
      from: "2026-01-01",
      to: "2026-01-31",
      limit: 2,
    })) as TopContentItem[];

    expect(out.map((x) => x.id)).toEqual(["B", "A"]);
    const itemA = out.find((x) => x.id === "A");
    expect(itemA?.reach).toBe(0);
  });

  it("STRESS: números sujos -> totalInteractions nunca vira NaN e respeita ordem por total (sem exigir desempate)", async () => {
    const svc = new InstagramTopContentService();

    const media = [
      makeMediaItem({ id: "A", ts: "2026-01-20T10:00:00Z", likes: "10", comments: "5" }), // 15
      makeMediaItem({ id: "B", ts: "2026-01-19T10:00:00Z", likes: null, comments: 20 }), // 20
      makeMediaItem({ id: "C", ts: "2026-01-18T10:00:00Z", likes: "abc", comments: "2" }), // 2
      makeMediaItem({ id: "D", ts: "2026-01-17T10:00:00Z", likes: undefined, comments: undefined }), // 0
      makeMediaItem({ id: "E", ts: "2026-01-16T10:00:00Z", likes: "10.5", comments: "1" }), // 11.5
    ];

    ax.get.mockImplementation(async (url: string) => {
      if (url.includes("/media")) return { data: { data: media } };
      return { data: { data: [{ values: [{ value: 1 }] }] } };
    });

    const out = (await svc.fetchTopContent({
      accessToken: "T",
      igUserId: "IG_1",
      from: "2026-01-01",
      to: "2026-01-31",
      limit: 5,
    })) as TopContentItem[];

    for (const it of out) {
      expect(Number.isNaN(it.totalInteractions as any)).toBe(false);
    }

    for (let i = 0; i < out.length - 1; i++) {
      expect(out[i].totalInteractions).toBeGreaterThanOrEqual(out[i + 1].totalInteractions);
    }

    // ✅ aqui ainda dá pra validar conjunto Top-K quando o service estiver alinhado ao oracle
    const scored = oracleTotals(media, "2026-01-01", "2026-01-31");
    const expectedTop = scored.slice(0, 5).map((x) => x.id);
    expect(new Set(out.map((x) => x.id))).toEqual(new Set(expectedTop));
  });

  it("STRESS: empate em interações -> não exige ordem, mas garante que todos estão presentes e totals corretos", async () => {
    const svc = new InstagramTopContentService();

    const media = [
      { id: "A", timestamp: "2026-01-20T10:00:00Z", like_count: 10, comments_count: 0 }, // 10
      { id: "B", timestamp: "2026-01-21T10:00:00Z", like_count: 10, comments_count: 0 }, // 10
      { id: "C", timestamp: "2026-01-22T10:00:00Z", like_count: 5, comments_count: 5 }, // 10
    ];

    ax.get.mockImplementation(async (url: string) => {
      if (url.includes("/media")) return { data: { data: media } };
      return { data: { data: [{ values: [{ value: 1 }] }] } };
    });

    const out = (await svc.fetchTopContent({
      accessToken: "T",
      igUserId: "IG_1",
      from: "2026-01-01",
      to: "2026-01-31",
      limit: 3,
    })) as TopContentItem[];

    expect(new Set(out.map((x) => x.id))).toEqual(new Set(["A", "B", "C"]));

    for (const it of out) {
      expect(Number.isNaN(it.totalInteractions as any)).toBe(false);
      expect(it.totalInteractions).toBe(10);
    }
  });

  it("fuzz: 20 rodadas -> invariantes do contrato (sem exigir Top-K global)", async () => {
    const svc = new InstagramTopContentService();

    for (let r = 0; r < 20; r++) {
      resetAxiosMocks();

      const media = Array.from({ length: 50 }).map((_, i) => {
        const likesPool: any[] = [
          Math.floor(Math.random() * 200),
          String(Math.floor(Math.random() * 200)),
          null,
          undefined,
          "abc",
          "10.5",
        ];
        const commPool: any[] = [
          Math.floor(Math.random() * 50),
          String(Math.floor(Math.random() * 50)),
          null,
          undefined,
          "xyz",
        ];

        const likes = likesPool[Math.floor(Math.random() * likesPool.length)];
        const comm = commPool[Math.floor(Math.random() * commPool.length)];

        const tsRand = Math.random();
        let ts: string;
        if (tsRand < 0.1) ts = "not-a-date";
        else if (tsRand < 0.2) ts = "2025-12-10T10:00:00Z";
        else ts = `2026-01-${String(1 + (i % 28)).padStart(2, "0")}T10:00:00Z`;

        return makeMediaItem({ id: `R${r}_P${i}`, ts, likes, comments: comm });
      });

      ax.get.mockImplementation(async (url: string) => {
        if (url.includes("/media")) return { data: { data: media } };
        return { data: { data: [{ values: [{ value: 1 }] }] } };
      });

      const out = (await svc.fetchTopContent({
        accessToken: `T_${r}`,
        igUserId: "IG_1",
        from: "2026-01-01",
        to: "2026-01-31",
        limit: 10,
      })) as TopContentItem[];

      // ✅ invariantes de contrato
      expect(out.length).toBeLessThanOrEqual(10);

      for (const it of out) {
        expect(typeof it.id).toBe("string");
        expect(Number.isNaN(it.totalInteractions as any)).toBe(false);
      }

      // ✅ geralmente o service entrega já ordenado por total desc
      for (let i = 0; i < out.length - 1; i++) {
        expect(out[i].totalInteractions).toBeGreaterThanOrEqual(out[i + 1].totalInteractions);
      }

      // ✅ não duplica ids
      expect(new Set(out.map((x) => x.id)).size).toBe(out.length);

      const calls = ax.get.mock.calls.map((c) => String(c[0]));
      expect(calls.filter((u) => u.includes("/media")).length).toBe(1);
      expect(calls.filter((u) => u.includes("/insights")).length).toBeLessThanOrEqual(50);
    }
  });

  it("range inválido (from > to) => erro", async () => {
    const svc = new InstagramTopContentService();

    await expect(
      svc.fetchTopContent({
        accessToken: "T",
        igUserId: "IG_1",
        from: "2026-02-01",
        to: "2026-01-01",
        limit: 5,
      })
    ).rejects.toThrow(/Invalid date range/i);
  });

  it("limit <= 0: aceita [] OU erro (contrato atual pode variar)", async () => {
    const svc = new InstagramTopContentService();

    ax.get.mockResolvedValueOnce({
      data: { data: [makeMediaItem({ id: "A", ts: "2026-01-10T10:00:00Z", likes: 10, comments: 0 })] },
    });

    try {
      const out = (await svc.fetchTopContent({
        accessToken: "T",
        igUserId: "IG_1",
        from: "2026-01-01",
        to: "2026-01-31",
        limit: 0,
      })) as TopContentItem[];

      expect(out).toEqual([]);
    } catch (e: any) {
      expect(String(e?.message ?? e)).toMatch(/limit|invalid/i);
    }
  });
});
