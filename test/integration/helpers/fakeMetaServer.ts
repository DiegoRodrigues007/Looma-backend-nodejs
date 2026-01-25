import express from "express";
import type { Server } from "http";

export function startFakeMetaServer(port = 4111) {
  const app = express();

  // (Opcional) caso algum teste envie body em POST futuramente
  app.use(express.json());

  // Health
  app.get("/health", (_req, res) => res.json({ ok: true }));

  // Caso seu código busque detalhes do media: GET /media/:mediaId?fields=...
  app.get("/media/:mediaId", (req, res) => {
    const { mediaId } = req.params;
    return res.json({
      id: mediaId,
      caption: `caption_${mediaId}`,
      media_type: "IMAGE",
      timestamp: "2026-01-24T00:00:00+0000",
    });
  });

  // Exemplo típico: GET /:igUserId/media?fields=...&access_token=...
  app.get("/:igUserId/media", (req, res) => {
    const { igUserId } = req.params;

    return res.json({
      data: [
        {
          id: `post_${igUserId}_1`,
          caption: "post 1",
          media_type: "IMAGE",
          timestamp: "2026-01-24T00:00:00+0000",
        },
        {
          id: `post_${igUserId}_2`,
          caption: "post 2",
          media_type: "VIDEO",
          timestamp: "2026-01-23T00:00:00+0000",
        },
      ],
      paging: { next: null },
    });
  });

  // Caso seu código chame insights: GET /:mediaId/insights?metric=...
  app.get("/:mediaId/insights", (req, res) => {
    const { mediaId } = req.params;
    return res.json({
      data: [
        { name: "reach", period: "lifetime", values: [{ value: 123 }] },
        { name: "impressions", period: "lifetime", values: [{ value: 456 }] },
      ],
      meta: { mediaId },
    });
  });

  // ✅ Fallback (Express 5): não use app.get("*")
  app.use((req, res) => {
    return res.status(404).json({
      ok: false,
      message: "FakeMetaServer: rota não implementada",
      method: req.method,
      path: req.path,
      query: req.query,
    });
  });

  let server: Server | undefined;

  return {
    start: () =>
      new Promise<void>((resolve) => {
        server = app.listen(port, "127.0.0.1", () => resolve());
      }),
    stop: () =>
      new Promise<void>((resolve, reject) => {
        if (!server) return resolve();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}