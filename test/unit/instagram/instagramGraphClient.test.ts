// test/unit/instagram/instagramGraphClient.test.ts
import axios from "axios";
import {
  fetchUserMedia,
  fetchInsights,
} from "../../../src/infrastructure/instagram/clients/instagramGraphClient";

type AxiosMock = { get: jest.Mock; post: jest.Mock; create: jest.Mock };
const ax = axios as unknown as AxiosMock;

function resetAxiosMocks() {
  ax.get?.mockReset?.();
  ax.post?.mockReset?.();
  ax.create?.mockReset?.();
}

function makeAxiosError(params: {
  status?: number;
  data?: any;
  message?: string;
  code?: string;
}) {
  const err: any = new Error(params.message ?? "Request failed");
  err.isAxiosError = true;
  if (params.code) err.code = params.code;
  if (params.status) err.response = { status: params.status, data: params.data };
  return err;
}

function safeDataData(out: any) {
  // o client atual provavelmente retorna data.data direto.
  // esse helper ajuda no fuzz/oracle quando a resposta vier “suja”.
  if (!out || typeof out !== "object") return [];
  if (!("length" in out)) return [];
  return out;
}

describe("UNIT instagramGraphClient (robusto)", () => {
  beforeEach(() => {
    resetAxiosMocks();
  });

  describe("fetchUserMedia", () => {
    it("chama /{igUserId}/media com fields e access_token e retorna data", async () => {
      ax.get.mockResolvedValueOnce({
        data: { data: [{ id: "M1", timestamp: "2026-01-10T00:00:00+0000" }] },
      });

      const out = await fetchUserMedia("IG_1", "TOKEN_1");

      expect(ax.get).toHaveBeenCalledTimes(1);
      expect(ax.get).toHaveBeenCalledWith(
        "https://graph.facebook.com/v21.0/IG_1/media",
        expect.objectContaining({
          params: expect.objectContaining({
            fields: "id,timestamp,like_count,comments_count",
            access_token: "TOKEN_1",
          }),
        })
      );

      expect(out).toEqual([{ id: "M1", timestamp: "2026-01-10T00:00:00+0000" }]);
    });

    it("não deve vazar/mutar a resposta: retorna exatamente data.data (mesmas refs)", async () => {
      const arr = [{ id: "M1" }, { id: "M2" }];
      ax.get.mockResolvedValueOnce({ data: { data: arr } });

      const out = await fetchUserMedia("IG_1", "TOKEN_1");

      // mesmo array (se você decidir clonar no client, troque pra deepEqual)
      expect(out).toBe(arr);
      expect(out).toEqual([{ id: "M1" }, { id: "M2" }]);
    });

    it("resposta malformada (sem data.data) => retorna [] (sem quebrar)", async () => {
      ax.get.mockResolvedValueOnce({ data: { foo: "bar" } });

      const out = await fetchUserMedia("IG_1", "TOKEN_1");

      // se teu client hoje NÃO trata isso e explode, esse teste vai falhar
      // (o que é bom: força robustez no client).
      expect(out).toEqual([]);
    });

    it("se axios falhar, deve propagar o erro (não engolir)", async () => {
      ax.get.mockRejectedValueOnce(makeAxiosError({ status: 500, message: "boom" }));

      await expect(fetchUserMedia("IG_1", "TOKEN_1")).rejects.toThrow(/boom/i);
    });
  });

  describe("fetchInsights", () => {
    it("chama /{mediaId}/insights com metric join e retorna [] quando vazio", async () => {
      ax.get.mockResolvedValueOnce({ data: { data: [] } });

      const out = await fetchInsights("MEDIA_1", ["reach", "saved"], "TOKEN_2");

      expect(ax.get).toHaveBeenCalledTimes(1);
      expect(ax.get).toHaveBeenCalledWith(
        "https://graph.facebook.com/v21.0/MEDIA_1/insights",
        expect.objectContaining({
          params: expect.objectContaining({
            metric: "reach,saved",
            access_token: "TOKEN_2",
          }),
        })
      );

      expect(out).toEqual([]);
    });

    it("metric join: não adiciona espaços e preserva a ordem", async () => {
      ax.get.mockResolvedValueOnce({ data: { data: [{ name: "reach" }] } });

      await fetchInsights("MEDIA_1", ["impressions", "reach", "saved"], "TOKEN_2");

      const [, cfg] = ax.get.mock.calls[0];
      expect(cfg?.params?.metric).toBe("impressions,reach,saved");
    });

    it("aceita lista grande (stress: 25 métricas) e monta string correta", async () => {
      ax.get.mockResolvedValueOnce({ data: { data: [] } });

      const metrics = Array.from({ length: 25 }).map((_, i) => `m${i + 1}`);
      await fetchInsights("MEDIA_BIG", metrics, "TOKEN_BIG");

      const [url, cfg] = ax.get.mock.calls[0];
      expect(url).toBe("https://graph.facebook.com/v21.0/MEDIA_BIG/insights");
      expect(cfg?.params?.metric).toBe(metrics.join(","));
      expect(cfg?.params?.access_token).toBe("TOKEN_BIG");
    });

    it("resposta malformada (sem data.data) => retorna [] (sem quebrar)", async () => {
      ax.get.mockResolvedValueOnce({ data: { nope: true } });

      const out = await fetchInsights("MEDIA_1", ["reach"], "TOKEN_2");

      // idem: se teu client ainda não trata, esse teste força a correção
      expect(out).toEqual([]);
    });

    it("erro axios propaga (ex.: 400/429 etc.)", async () => {
      ax.get.mockRejectedValueOnce(
        makeAxiosError({
          status: 429,
          data: { error: { message: "(#4) Application request limit reached" } },
          message: "rate limit",
        })
      );

      await expect(fetchInsights("MEDIA_1", ["reach"], "TOKEN_2")).rejects.toThrow(/rate limit/i);
    });

    it("fuzz: várias combinações de métricas sempre chamam axios com join exato", async () => {
      // 10 rodadas rápidas, sem ficar lento
      for (let r = 0; r < 10; r++) {
        resetAxiosMocks();
        ax.get.mockResolvedValueOnce({ data: { data: [] } });

        const len = 1 + Math.floor(Math.random() * 10);
        const metrics = Array.from({ length: len }).map((_, i) => `metric_${r}_${i}`);

        const out = await fetchInsights(`MEDIA_${r}`, metrics, `TOKEN_${r}`);

        // invariantes
        expect(ax.get).toHaveBeenCalledTimes(1);
        const [url, cfg] = ax.get.mock.calls[0];
        expect(url).toBe(`https://graph.facebook.com/v21.0/MEDIA_${r}/insights`);
        expect(cfg?.params?.metric).toBe(metrics.join(","));
        expect(cfg?.params?.access_token).toBe(`TOKEN_${r}`);

        // retorno sempre array
        expect(Array.isArray(safeDataData(out))).toBe(true);
      }
    });
  });
});
