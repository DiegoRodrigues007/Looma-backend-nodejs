// test/unit/instagram/fetchDailyInteractionsByPosts.test.ts
import { fetchDailyInteractionsByPosts } from "../../../src/infrastructure/instagram/fetchDailyInteractionsByPosts";
import { mulberry32, randInt, ymdRange } from "../helpers/stress";

type GraphMock = {
  get: jest.Mock;
};

function mkMediaItem(id: string, tsIso: string, likes: any, comments: any) {
  return {
    id,
    timestamp: tsIso,
    like_count: likes,
    comments_count: comments,
  };
}

function mkInsights(shares: any, saved: any) {
  return {
    data: {
      data: [
        { name: "shares", values: [{ value: shares }] },
        { name: "saved", values: [{ value: saved }] },
      ],
    },
  };
}

function ymdFromIso(ts: string) {
  return String(ts).slice(0, 10);
}

function safeNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function safeRead(map: Record<string, number> | undefined, key: string): number {
  if (!map) return 0;
  const v = (map as any)[key];
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function sumObj(o: Record<string, number> | undefined) {
  if (!o) return 0;
  return Object.values(o).reduce((a, b) => a + safeNum(b), 0);
}

function isWithinRangeYmd(day: string, from: string, to: string) {
  return day >= from && day <= to;
}

/**
 * Pega "after" de:
 * - config.params.after (muito comum)
 * - querystring da URL (?after=CURSOR_1) (comum quando segue paging.next)
 */
function getAfter(url: string, config?: any): string | undefined {
  const p = config?.params?.after;
  if (p !== undefined && p !== null && String(p).length) return String(p);

  const u = String(url);
  const m = u.match(/[?&]after=([^&]+)/);
  if (m?.[1]) return decodeURIComponent(m[1]);

  return undefined;
}

/**
 * Mock robusto do Graph:
 * - /media paginado por cursor "after" (via params OU url)
 * - retorna também paging.next (muitos códigos seguem isso)
 * - /{mediaId}/insights retorna shares/saved do post
 *
 * ✅ Independente da ordem das chamadas
 * ✅ Compatível com paginação por params ou por paging.next
 */
function installGraphMock({
  graph,
  postsSortedDesc,
  pageSize,
  insightsById,
  failInsightsIds,
  mediaBaseUrl = "https://graph.facebook.com/v21.0/ig1/media",
}: {
  graph: GraphMock;
  postsSortedDesc: Array<{ id: string; ts: string; likes: any; comments: any }>;
  pageSize: number;
  insightsById: Record<string, { shares: any; saved: any }>;
  failInsightsIds?: Set<string>;
  mediaBaseUrl?: string;
}) {
  graph.get.mockImplementation(async (url: string, config?: any) => {
    const u = String(url);

    // 1) /media (pagina)
    if (u.includes("/media")) {
      const after = getAfter(u, config);
      const pageIndex = after ? Number(String(after).replace("CURSOR_", "")) : 0;

      const start = pageIndex * pageSize;
      const slice = postsSortedDesc.slice(start, start + pageSize);

      const hasNext = start + pageSize < postsSortedDesc.length;
      const nextCursor = hasNext ? `CURSOR_${pageIndex + 1}` : undefined;

      return {
        data: {
          data: slice.map((p) => mkMediaItem(p.id, p.ts, p.likes, p.comments)),
          paging: {
            cursors: nextCursor ? { after: nextCursor } : {},
            ...(nextCursor ? { next: `${mediaBaseUrl}?after=${encodeURIComponent(nextCursor)}` } : {}),
          },
        },
      };
    }

    // 2) /{mediaId}/insights
    if (u.includes("/insights")) {
      const m = u.match(/\/([^\/\?]+)\/insights/);
      const mediaId = m?.[1];

      if (mediaId && failInsightsIds?.has(mediaId)) {
        throw new Error("insights fail");
      }

      if (mediaId && insightsById[mediaId]) {
        const { shares, saved } = insightsById[mediaId];
        return mkInsights(shares, saved);
      }

      return mkInsights(0, 0);
    }

    return { data: {} };
  });
}

describe("fetchDailyInteractionsByPosts", () => {
  beforeEach(() => jest.clearAllMocks());

  it("pagina /media, filtra por range e agrega likes/comments/shares/saves por dia", async () => {
    const graph: GraphMock = { get: jest.fn() };

    graph.get.mockResolvedValueOnce({
      data: {
        data: [
          mkMediaItem("p1", "2026-01-02T10:00:00.000Z", 10, 2),
          mkMediaItem("p2", "2026-01-02T12:00:00.000Z", 5, 1),
        ],
        paging: { cursors: { after: "CURSOR2" } },
      },
    });

    graph.get.mockResolvedValueOnce({
      data: {
        data: [mkMediaItem("p3", "2026-01-01T09:00:00.000Z", 3, 0)],
        paging: { cursors: {} },
      },
    });

    graph.get
      .mockResolvedValueOnce(mkInsights(1, 2))
      .mockResolvedValueOnce(mkInsights(3, 0))
      .mockResolvedValueOnce(mkInsights(2, 1));

    const out = await fetchDailyInteractionsByPosts({
      igUserId: "ig1",
      accessToken: "t",
      from: "2026-01-01",
      to: "2026-01-02",
      graph: graph as any,
    });

    expect(out.likesByDay["2026-01-02"]).toBe(15);
    expect(out.commentsByDay["2026-01-02"]).toBe(3);

    expect(out.likesByDay["2026-01-01"]).toBe(3);
    expect(out.commentsByDay["2026-01-01"]).toBe(0);

    expect(out.sharesByDay["2026-01-02"]).toBe(1 + 3);
    expect(out.savesByDay["2026-01-02"]).toBe(2 + 0);

    expect(out.sharesByDay["2026-01-01"]).toBe(2);
    expect(out.savesByDay["2026-01-01"]).toBe(1);

    expect(out.totalByDay["2026-01-02"]).toBe(24);
    expect(out.totalByDay["2026-01-01"]).toBe(6);

    expect(graph.get).toHaveBeenCalledTimes(5);
  });

  it("se insights falhar, não deve quebrar (mantém likes/comments)", async () => {
    const graph: GraphMock = { get: jest.fn() };

    graph.get.mockResolvedValueOnce({
      data: {
        data: [mkMediaItem("p1", "2026-01-02T10:00:00.000Z", 10, 2)],
        paging: { cursors: {} },
      },
    });

    graph.get.mockRejectedValueOnce(new Error("Graph down"));

    const out = await fetchDailyInteractionsByPosts({
      igUserId: "ig1",
      accessToken: "t",
      from: "2026-01-02",
      to: "2026-01-02",
      graph: graph as any,
    });

    expect(out.likesByDay["2026-01-02"]).toBe(10);
    expect(out.commentsByDay["2026-01-02"]).toBe(2);

    expect(out.sharesByDay["2026-01-02"]).toBeUndefined();
    expect(out.savesByDay["2026-01-02"]).toBeUndefined();

    expect(out.totalByDay["2026-01-02"]).toBe(12);
  });

  describe("STRESS", () => {
    beforeAll(() => {
      jest.setTimeout(30000);
    });

    it("STRESS: 50 páginas x 25 posts (1250) com insights ok -> totais batem e nenhum NaN", async () => {
      const graph: GraphMock = { get: jest.fn() };
      const rng = mulberry32(123);

      const from = "2026-01-01";
      const to = "2026-01-31";
      const days = ymdRange(from, to);

      // 1250 posts distribuídos no range
      const posts: Array<{ id: string; ts: string; likes: any; comments: any; shares: any; saved: any }> = [];
      for (let i = 0; i < 1250; i++) {
        const d = days[randInt(rng, 0, days.length - 1)];
        const hour = randInt(rng, 0, 23);
        const minute = randInt(rng, 0, 59);
        const ts = `${d}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`;

        const likes = rng() < 0.1 ? String(randInt(rng, 0, 200)) : rng() < 0.05 ? null : randInt(rng, 0, 200);
        const comments =
          rng() < 0.1 ? String(randInt(rng, 0, 50)) : rng() < 0.05 ? null : randInt(rng, 0, 50);

        const shares = rng() < 0.1 ? String(randInt(rng, 0, 30)) : randInt(rng, 0, 30);
        const saved = rng() < 0.1 ? String(randInt(rng, 0, 30)) : randInt(rng, 0, 30);

        posts.push({ id: `p${i}`, ts, likes, comments, shares, saved });
      }

      // ✅ Graph /media vem do mais recente pro mais antigo
      const postsSortedDesc = [...posts].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));

      const pageSize = 25;

      // esperado por dia
      const expLikes: Record<string, number> = {};
      const expComments: Record<string, number> = {};
      const expShares: Record<string, number> = {};
      const expSaves: Record<string, number> = {};
      const expTotal: Record<string, number> = {};

      for (const p of postsSortedDesc) {
        const day = ymdFromIso(p.ts);
        if (!isWithinRangeYmd(day, from, to)) continue;

        expLikes[day] = (expLikes[day] ?? 0) + safeNum(p.likes);
        expComments[day] = (expComments[day] ?? 0) + safeNum(p.comments);
        expShares[day] = (expShares[day] ?? 0) + safeNum(p.shares);
        expSaves[day] = (expSaves[day] ?? 0) + safeNum(p.saved);
      }
      for (const day of Object.keys(expLikes)) {
        expTotal[day] =
          (expLikes[day] ?? 0) + (expComments[day] ?? 0) + (expShares[day] ?? 0) + (expSaves[day] ?? 0);
      }

      // insightsById (por id)
      const insightsById: Record<string, { shares: any; saved: any }> = {};
      for (const p of postsSortedDesc) {
        insightsById[p.id] = { shares: p.shares, saved: p.saved };
      }

      installGraphMock({
        graph,
        postsSortedDesc: postsSortedDesc.map((p) => ({ id: p.id, ts: p.ts, likes: p.likes, comments: p.comments })),
        pageSize,
        insightsById,
        mediaBaseUrl: "https://graph.facebook.com/v21.0/ig1/media",
      });

      const out = await fetchDailyInteractionsByPosts({
        igUserId: "ig1",
        accessToken: "t",
        from,
        to,
        graph: graph as any,
      });

      // invariantes finitos/não-negativos (para dias do range)
      for (const day of days) {
        const L = safeRead(out.likesByDay, day);
        const C = safeRead(out.commentsByDay, day);
        const Sh = safeRead(out.sharesByDay, day);
        const Sa = safeRead(out.savesByDay, day);
        const T = safeRead(out.totalByDay, day);

        expect(Number.isFinite(L)).toBe(true);
        expect(Number.isFinite(C)).toBe(true);
        expect(Number.isFinite(Sh)).toBe(true);
        expect(Number.isFinite(Sa)).toBe(true);
        expect(Number.isFinite(T)).toBe(true);

        expect(L).toBeGreaterThanOrEqual(0);
        expect(C).toBeGreaterThanOrEqual(0);
        expect(Sh).toBeGreaterThanOrEqual(0);
        expect(Sa).toBeGreaterThanOrEqual(0);
        expect(T).toBeGreaterThanOrEqual(0);
      }

      // totais por dia batem
      for (const day of Object.keys(expTotal)) {
        expect(safeRead(out.likesByDay, day)).toBe(expLikes[day] ?? 0);
        expect(safeRead(out.commentsByDay, day)).toBe(expComments[day] ?? 0);
        expect(safeRead(out.sharesByDay, day)).toBe(expShares[day] ?? 0);
        expect(safeRead(out.savesByDay, day)).toBe(expSaves[day] ?? 0);
        expect(safeRead(out.totalByDay, day)).toBe(expTotal[day] ?? 0);
      }

      // sanity global
      expect(sumObj(out.likesByDay)).toBe(sumObj(expLikes));
      expect(sumObj(out.commentsByDay)).toBe(sumObj(expComments));
      expect(sumObj(out.sharesByDay)).toBe(sumObj(expShares));
      expect(sumObj(out.savesByDay)).toBe(sumObj(expSaves));
      expect(sumObj(out.totalByDay)).toBe(sumObj(expTotal));

      // ✅ robusto: não fixa número exato de calls, mas garante que houve paginação + insights suficiente
      expect(graph.get.mock.calls.length).toBeGreaterThanOrEqual(1); // pelo menos /media
      // se teu código pede insights por post, isso vai ficar bem alto:
      expect(graph.get.mock.calls.length).toBeGreaterThanOrEqual(20);
    });

    it("STRESS: insights falhando em 30% dos posts não quebra; totalByDay considera só likes/comments + insights que vieram", async () => {
      const graph: GraphMock = { get: jest.fn() };
      const rng = mulberry32(777);

      const from = "2026-01-01";
      const to = "2026-01-07";
      const days = ymdRange(from, to);

      const posts: Array<{
        id: string;
        ts: string;
        likes: number;
        comments: number;
        shares: number;
        saved: number;
        fail: boolean;
      }> = [];

      for (let i = 0; i < 120; i++) {
        const d = days[randInt(rng, 0, days.length - 1)];
        const ts = `${d}T10:00:00.000Z`;
        const likes = randInt(rng, 0, 50);
        const comments = randInt(rng, 0, 20);
        const shares = randInt(rng, 0, 10);
        const saved = randInt(rng, 0, 10);
        const fail = rng() < 0.3;
        posts.push({ id: `p${i}`, ts, likes, comments, shares, saved, fail });
      }

      const postsSortedDesc = [...posts].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));

      const expLikes: Record<string, number> = {};
      const expComments: Record<string, number> = {};
      const expShares: Record<string, number> = {};
      const expSaves: Record<string, number> = {};
      const expTotal: Record<string, number> = {};

      for (const p of postsSortedDesc) {
        const day = ymdFromIso(p.ts);
        expLikes[day] = (expLikes[day] ?? 0) + p.likes;
        expComments[day] = (expComments[day] ?? 0) + p.comments;

        if (!p.fail) {
          expShares[day] = (expShares[day] ?? 0) + p.shares;
          expSaves[day] = (expSaves[day] ?? 0) + p.saved;
        }
      }
      for (const d of days) {
        expTotal[d] = (expLikes[d] ?? 0) + (expComments[d] ?? 0) + (expShares[d] ?? 0) + (expSaves[d] ?? 0);
      }

      const insightsById: Record<string, { shares: any; saved: any }> = {};
      const failIds = new Set<string>();
      for (const p of postsSortedDesc) {
        insightsById[p.id] = { shares: p.shares, saved: p.saved };
        if (p.fail) failIds.add(p.id);
      }

      installGraphMock({
        graph,
        postsSortedDesc: postsSortedDesc.map((p) => ({ id: p.id, ts: p.ts, likes: p.likes, comments: p.comments })),
        pageSize: 9999,
        insightsById,
        failInsightsIds: failIds,
        mediaBaseUrl: "https://graph.facebook.com/v21.0/ig1/media",
      });

      const out = await fetchDailyInteractionsByPosts({
        igUserId: "ig1",
        accessToken: "t",
        from,
        to,
        graph: graph as any,
      });

      for (const d of days) {
        expect(safeRead(out.likesByDay, d)).toBe(expLikes[d] ?? 0);
        expect(safeRead(out.commentsByDay, d)).toBe(expComments[d] ?? 0);
        expect(safeRead(out.sharesByDay, d)).toBe(expShares[d] ?? 0);
        expect(safeRead(out.savesByDay, d)).toBe(expSaves[d] ?? 0);
        expect(safeRead(out.totalByDay, d)).toBe(expTotal[d] ?? 0);
        expect(Number.isFinite(safeRead(out.totalByDay, d))).toBe(true);
      }
    });
  });
});
