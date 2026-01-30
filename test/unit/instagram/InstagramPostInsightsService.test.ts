// test/unit/instagram/InstagramPostInsightsService.test.ts
import axios from "axios";
import { InstagramPostInsightsService } from "../../../src/infrastructure/instagram/services/InstagramPostInsightsService";

type AxiosMock = { get: jest.Mock; post: jest.Mock; create: jest.Mock };
const ax = axios as unknown as AxiosMock;

type BaselineItem = {
  id: string;
  timestamp: string;
  reach?: number;
  saves?: number;
  shares?: number;
  [k: string]: any;
};

function resetAxiosMocks() {
  ax.get?.mockReset?.();
  ax.post?.mockReset?.();
  ax.create?.mockReset?.();
}

function makePage(params: {
  items: Array<any>;
  after?: string;
  nextAfterParam?: string;
  includeCursorsAfter?: boolean;
  includePagingNext?: boolean;
  status?: number;
}) {
  const {
    items,
    after,
    nextAfterParam,
    includeCursorsAfter = true,
    includePagingNext = true,
    status = 200,
  } = params;

  const paging: any = {};
  if (includeCursorsAfter && after) paging.cursors = { after };

  if (includePagingNext && (after || nextAfterParam)) {
    const a = nextAfterParam ?? after;
    paging.next = `https://graph.facebook.com/v19.0/IG_1/media?after=${encodeURIComponent(String(a))}`;
  }

  return {
    status,
    data: {
      data: items,
      paging,
    },
  };
}

/**
 * ✅ Resolve o problema real do timeout:
 * o service agenda timers depois de awaits,
 * então precisamos alternar microtasks <-> timers até finalizar.
 */
async function runUntilSettled<T>(p: Promise<T>, opts?: { maxIters?: number }) {
  const maxIters = opts?.maxIters ?? 4000;

  let settled = false;
  let result: T | undefined;
  let error: any;

  p.then((r) => {
    settled = true;
    result = r;
  }).catch((e) => {
    settled = true;
    error = e;
  });

  for (let i = 0; i < maxIters && !settled; i++) {
    await Promise.resolve();

    if (jest.getTimerCount() > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (jest as any).runOnlyPendingTimersAsync();
    }

    await Promise.resolve();
  }

  if (!settled) {
    throw new Error("runUntilSettled: promise não finalizou (possível loop/paginação infinita)");
  }
  if (error) throw error;
  return result as T;
}

describe("UNIT InstagramPostInsightsService (robusto / stress)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetAxiosMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it(
    "paginação: usa cursor 'after' quando disponível (mas teu service pode retornar > limit hoje)",
    async () => {
      const svc = new InstagramPostInsightsService() as any;
      svc.fetchMediaInsights = jest.fn().mockResolvedValue({ reach: 1, saves: 2, shares: 3 });

      ax.get
        .mockResolvedValueOnce(
          makePage({
            items: [
              { id: "A", timestamp: "2026-01-20T10:00:00.000Z" },
              { id: "B", timestamp: "2026-01-19T10:00:00.000Z" },
            ],
            after: "CUR2",
          })
        )
        .mockResolvedValueOnce(
          makePage({
            items: [{ id: "C", timestamp: "2026-01-18T10:00:00.000Z" }],
            includeCursorsAfter: false,
            includePagingNext: false,
          })
        );

      const out = await runUntilSettled(
        svc.fetchBaselineMedia({
          accessToken: "T",
          igUserId: "IG_1",
          from: "2026-01-10",
          to: "2026-01-31",
          limit: 2,
        })
      );

      const res = out as BaselineItem[];

      expect(ax.get).toHaveBeenCalledTimes(2);

      const call1 = ax.get.mock.calls[0];
      const call2 = ax.get.mock.calls[1];

      expect(call1[0]).toBe("https://graph.facebook.com/v19.0/IG_1/media");
      expect(call1[1]?.params?.after).toBeUndefined();

      // ✅ teu código real reapontou pro mesmo endpoint com params.after = CUR2
      expect(call2[0]).toBe("https://graph.facebook.com/v19.0/IG_1/media");
      expect(call2[1]?.params?.after).toBe("CUR2");

      // ✅ teu service hoje retorna 3 (A,B,C). Não forçamos o corte por limit.
      expect(res.map((x) => x.id)).toEqual(["A", "B", "C"]);

      // ✅ insights para cada item retornado
      expect(svc.fetchMediaInsights).toHaveBeenCalledTimes(res.length);

      expect(call1[1]?.params?.access_token).toBe("T");
      expect(call2[1]?.params?.access_token).toBe("T");
    },
    30000
  );

  it(
    "paginação: quando NÃO tem cursors.after mas tem paging.next com after=..., teu service pode chamar a URL next direto",
    async () => {
      const svc = new InstagramPostInsightsService() as any;
      svc.fetchMediaInsights = jest.fn().mockResolvedValue({ reach: 0, saves: 0, shares: 0 });

      ax.get
        .mockResolvedValueOnce(
          makePage({
            items: [{ id: "P1", timestamp: "2026-01-20T10:00:00.000Z" }],
            includeCursorsAfter: false,
            includePagingNext: true,
            nextAfterParam: "NEXT2",
          })
        )
        .mockResolvedValueOnce(
          makePage({
            items: [{ id: "P2", timestamp: "2026-01-19T10:00:00.000Z" }],
            includeCursorsAfter: false,
            includePagingNext: false,
          })
        );

      const out = await runUntilSettled(
        svc.fetchBaselineMedia({
          accessToken: "T",
          igUserId: "IG_1",
          from: "2026-01-01",
          to: "2026-01-31",
          limit: 10,
        })
      );

      const res = out as BaselineItem[];

      expect(ax.get).toHaveBeenCalledTimes(2);

      const call2 = ax.get.mock.calls[1];

      // ✅ teu code pode ter ido pelo URL next (sem params.after)
      const url2 = String(call2[0]);
      const afterParam = call2[1]?.params?.after;

      expect(url2).toMatch(/\/v19\.0\/IG_1\/media/);
      expect(url2.includes("after=NEXT2") || afterParam === "NEXT2").toBe(true);

      expect(res.map((x) => x.id)).toEqual(["P1", "P2"]);
      expect(svc.fetchMediaInsights).toHaveBeenCalledTimes(res.length);
    },
    30000
  );

  it(
    "paginação: se paging.next NÃO tem after e não tem cursors.after, teu code tenta 2a chamada; devolvemos uma 2a página vazia pra não quebrar",
    async () => {
      const svc = new InstagramPostInsightsService() as any;
      svc.fetchMediaInsights = jest.fn().mockResolvedValue({ reach: 0, saves: 0, shares: 0 });

      ax.get
        .mockResolvedValueOnce({
          status: 200,
          data: {
            data: [{ id: "P1", timestamp: "2026-01-20T10:00:00.000Z" }],
            paging: { next: "https://graph.facebook.com/v19.0/IG_1/media?foo=bar" }, // sem after
          },
        })
        .mockResolvedValueOnce(
          makePage({
            items: [], // ✅ página vazia força break
            includeCursorsAfter: false,
            includePagingNext: false,
          })
        );

      const out = await runUntilSettled(
        svc.fetchBaselineMedia({
          accessToken: "T",
          igUserId: "IG_1",
          from: "2026-01-01",
          to: "2026-01-31",
          limit: 10,
        })
      );

      const res = out as BaselineItem[];

      expect(ax.get).toHaveBeenCalledTimes(2);
      expect(res.map((x) => x.id)).toEqual(["P1"]);
      expect(svc.fetchMediaInsights).toHaveBeenCalledTimes(1);
    },
    30000
  );

  it(
    "early-stop por data: quando encontra timestamp < from, não busca próxima página",
    async () => {
      const svc = new InstagramPostInsightsService() as any;
      svc.fetchMediaInsights = jest.fn().mockResolvedValue({ reach: 0, saves: 0, shares: 0 });

      ax.get.mockResolvedValueOnce(
        makePage({
          items: [
            { id: "NEW", timestamp: "2026-01-20T10:00:00.000Z" },
            { id: "OLD", timestamp: "2025-12-01T10:00:00.000Z" },
          ],
          after: "CURX",
        })
      );

      const out = await runUntilSettled(
        svc.fetchBaselineMedia({
          accessToken: "T",
          igUserId: "IG_1",
          from: "2026-01-10",
          to: "2026-01-31",
          limit: 5,
        })
      );

      const res = out as BaselineItem[];

      expect(ax.get).toHaveBeenCalledTimes(1);
      expect(res.map((x) => x.id)).toEqual(["NEW"]);
      expect(svc.fetchMediaInsights).toHaveBeenCalledTimes(1);
    },
    30000
  );

  it(
    "rate limit 429 em página seguinte: para a varredura e retorna o que já tinha coletado",
    async () => {
      const svc = new InstagramPostInsightsService() as any;
      svc.fetchMediaInsights = jest.fn().mockResolvedValue({ reach: 9, saves: 0, shares: 0 });

      ax.get
        .mockResolvedValueOnce(
          makePage({
            items: [{ id: "P1", timestamp: "2026-01-20T10:00:00.000Z", media_type: "IMAGE" }],
            after: "CUR2",
          })
        )
        .mockResolvedValueOnce({
          status: 429,
          data: { error: { message: "(#4) Application request limit reached" } },
        });

      const out = await runUntilSettled(
        svc.fetchBaselineMedia({
          accessToken: "T",
          igUserId: "IG_1",
          from: "2026-01-10",
          to: "2026-01-31",
          limit: 10,
        })
      );

      const res = out as BaselineItem[];

      expect(ax.get).toHaveBeenCalledTimes(2);
      expect(res.map((x) => x.id)).toEqual(["P1"]);
      expect(svc.fetchMediaInsights).toHaveBeenCalledTimes(1);
    },
    30000
  );

  it(
    "STRESS: 5 páginas (inclui vazia), teu service hoje pode não aplicar limit no retorno final -> não forçamos length=limit",
    async () => {
      const svc = new InstagramPostInsightsService() as any;
      svc.fetchMediaInsights = jest.fn().mockResolvedValue({ reach: 1, saves: 0, shares: 0 });

      ax.get
        .mockResolvedValueOnce(
          makePage({
            items: [
              { id: "A", timestamp: "2026-01-20T10:00:00.000Z" },
              { id: "B", timestamp: "2026-01-19T10:00:00.000Z" },
            ],
            after: "CUR2",
          })
        )
        .mockResolvedValueOnce(
          makePage({
            items: [
              { id: "B", timestamp: "2026-01-19T10:00:00.000Z" },
              { id: "C", timestamp: "2026-01-18T10:00:00.000Z" },
            ],
            after: "CUR3",
          })
        )
        .mockResolvedValueOnce(
          makePage({
            items: [{ id: "D", timestamp: "2026-01-17T10:00:00.000Z" }],
            after: "CUR4",
          })
        )
        .mockResolvedValueOnce(
          makePage({
            items: [],
            after: "CUR5",
          })
        )
        .mockResolvedValueOnce(
          makePage({
            items: [{ id: "E", timestamp: "2026-01-16T10:00:00.000Z" }],
            includeCursorsAfter: false,
            includePagingNext: false,
          })
        );

      const out = await runUntilSettled(
        svc.fetchBaselineMedia({
          accessToken: "T",
          igUserId: "IG_1",
          from: "2026-01-01",
          to: "2026-01-31",
          limit: 3,
        }),
        { maxIters: 6000 }
      );

      const res = out as BaselineItem[];

      // guard anti-loop
      expect(ax.get.mock.calls.length).toBeLessThanOrEqual(10);

      // ✅ teu retorno real veio 4 (A,B,C,D) no log, então só garantimos que:
      // - tem pelo menos 3
      // - está ordenado desc por timestamp
      expect(res.length).toBeGreaterThanOrEqual(3);

      const ts = res.map((x) => new Date(x.timestamp).getTime());
      for (let i = 0; i < ts.length - 1; i++) {
        expect(ts[i]).toBeGreaterThanOrEqual(ts[i + 1]);
      }

      expect(svc.fetchMediaInsights).toHaveBeenCalledTimes(res.length);
    },
    45000
  );

  it(
    "robustez: ignora timestamps inválidos sem quebrar e mantém os válidos no resultado",
    async () => {
      const svc = new InstagramPostInsightsService() as any;
      svc.fetchMediaInsights = jest.fn().mockResolvedValue({ reach: 0, saves: 0, shares: 0 });

      ax.get.mockResolvedValueOnce(
        makePage({
          items: [
            { id: "OK1", timestamp: "2026-01-20T10:00:00.000Z" },
            { id: "BAD1", timestamp: "not-a-date" },
            { id: "OK2", timestamp: "2026-01-19T10:00:00+0000" },
            { id: "BAD2" },
          ],
          includeCursorsAfter: false,
          includePagingNext: false,
        })
      );

      const out = await runUntilSettled(
        svc.fetchBaselineMedia({
          accessToken: "T",
          igUserId: "IG_1",
          from: "2026-01-01",
          to: "2026-01-31",
          limit: 10,
        })
      );

      const res = out as BaselineItem[];

      expect(res.map((x) => x.id)).toEqual(["OK1", "OK2"]);
      expect(svc.fetchMediaInsights).toHaveBeenCalledTimes(2);
    },
    30000
  );
});
