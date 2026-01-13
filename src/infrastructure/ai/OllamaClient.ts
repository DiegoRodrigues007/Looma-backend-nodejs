// src/infrastructure/ai/OllamaClient.ts
import axios from "axios";
import type { AxiosError, AxiosResponse } from "axios";
import { env } from "../config/env";

type OllamaGenerateRequest = {
  model: string;
  prompt: string;
  stream?: boolean;
  format?: "json" | string;
  options?: Record<string, any>;
  keep_alive?: string | number;
};

type OllamaGenerateResponse = {
  model?: string;
  created_at?: string;
  response?: string;
  done?: boolean;
  done_reason?: string;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
  error?: string;
};

function trimSlashesEnd(s: string) {
  return String(s ?? "").replace(/\/+$/, "");
}

function normalizeGenerateUrl(baseUrl: string) {
  let raw = String(baseUrl ?? "").trim();
  if (!raw) raw = "http://localhost:11434";
  if (!/^https?:\/\//i.test(raw)) raw = `http://${raw}`;
  raw = trimSlashesEnd(raw);

  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    const cleaned = raw.replace(/\s+/g, "");
    return `${trimSlashesEnd(cleaned)}/api/generate`;
  }

  const origin = u.origin;
  let path = trimSlashesEnd(u.pathname || "");
  const lower = path.toLowerCase();

  if (!path || path === "/") path = "/api/generate";
  else if (lower === "/api") path = "/api/generate";
  else if (lower.startsWith("/api/generate")) path = "/api/generate";
  else path = "/api/generate";

  path = path.replace(/(\/api\/generate)+$/i, "/api/generate");
  return `${origin}${path}${u.search || ""}`;
}

function stripCodeFences(s: string) {
  const t = String(s ?? "").trim();
  return t.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
}

function extractJsonBalanced(text: string): string | null {
  const s = stripCodeFences(text);
  if (!s) return null;

  // parse direto
  try {
    JSON.parse(s);
    return s;
  } catch {
    // segue
  }

  const firstObj = s.indexOf("{");
  const firstArr = s.indexOf("[");
  let start = -1;
  let openChar: "{" | "[" | null = null;
  let closeChar: "}" | "]" | null = null;

  if (firstObj >= 0 && (firstArr < 0 || firstObj < firstArr)) {
    start = firstObj;
    openChar = "{";
    closeChar = "}";
  } else if (firstArr >= 0) {
    start = firstArr;
    openChar = "[";
    closeChar = "]";
  }

  if (start < 0 || !openChar || !closeChar) return null;

  let depth = 0;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (ch === openChar) depth++;
    else if (ch === closeChar) depth--;
    if (depth === 0) {
      const candidate = s.slice(start, i + 1).trim();
      try {
        JSON.parse(candidate);
        return candidate;
      } catch {
        return null;
      }
    }
  }

  return null;
}

function toOllamaError(err: unknown, ctx: { url: string; timeoutMs: number }) {
  if (axios.isAxiosError(err)) {
    const ae = err as AxiosError<any>;
    const e: any = new Error(ae.message || "Ollama request failed");
    e.code = ae.code || "OLLAMA_REQUEST_FAILED";
    e.timeout = ae.code === "ECONNABORTED";
    e.details = {
      url: ctx.url,
      timeoutMs: ctx.timeoutMs,
      status: ae.response?.status,
      data:
        typeof ae.response?.data === "string"
          ? ae.response?.data.slice(0, 2000)
          : ae.response?.data,
    };
    return e;
  }

  const e: any = new Error((err as any)?.message || "Ollama request failed");
  e.code = (err as any)?.code || "OLLAMA_REQUEST_FAILED";
  e.timeout = false;
  e.details = { url: ctx.url, timeoutMs: ctx.timeoutMs };
  return e;
}

function isTimeout(e: any) {
  return (
    e?.code === "ECONNABORTED" ||
    String(e?.message ?? "").toLowerCase().includes("timeout")
  );
}

function envInt(name: string, def: number) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : def;
}

function clampInt(n: number, min: number, max: number) {
  const x = Number.isFinite(n) ? Math.floor(n) : min;
  return Math.min(max, Math.max(min, x));
}

export class OllamaClient {
  private readonly enabled = env.ollama.enabled;
  private readonly model = env.ollama.model;
  private readonly timeoutMs = env.ollama.timeoutMs;
  private readonly generateUrl = normalizeGenerateUrl(env.ollama.baseUrl);

  // manter modelo quente
  private readonly keepAlive =
    (process.env.OLLAMA_KEEP_ALIVE ?? "15m").toString().trim() || "15m";

  // CPU tuning (defaults bons p/ modelo leve)
  private readonly numThread = envInt("OLLAMA_NUM_THREAD", 0); // 0=auto
  private readonly numCtxDefault = envInt("OLLAMA_NUM_CTX", 768); // menor = mais rápido
  private readonly numPredictDefault = envInt("OLLAMA_NUM_PREDICT", 140); // menor = mais rápido

  // warmup control
  private warmed = false;

  isEnabled() {
    return this.enabled;
  }

  getGenerateUrl() {
    return this.generateUrl;
  }

  /**
   * ✅ Chame no boot do server (1x)
   * Evita a primeira chamada demorar muito.
   * - timeout maior só aqui
   */
  async warmup(opts?: { timeoutMs?: number }) {
    if (!this.enabled) return;
    if (this.warmed) return;

    const timeoutMs = opts?.timeoutMs ?? Math.max(120_000, this.timeoutMs);

    try {
      await this.postGenerate(
        {
          model: this.model,
          prompt: "Responda apenas: ok",
          stream: false,
          options: {
            temperature: 0,
            top_p: 0.9,
            num_ctx: 96,
            num_predict: 12,
            stop: ["\n\n"],
            ...(this.numThread > 0 ? { num_thread: this.numThread } : {}),
          },
          keep_alive: this.keepAlive,
        },
        { timeoutMs }
      );
      this.warmed = true;
    } catch {
      // não quebra o app — só não aqueceu
    }
  }

  private async postGenerate(
    body: OllamaGenerateRequest,
    opts?: { timeoutMs?: number }
  ): Promise<OllamaGenerateResponse> {
    const timeoutMs = opts?.timeoutMs ?? this.timeoutMs;

    try {
      const res = await axios.post<any, AxiosResponse<OllamaGenerateResponse>>(
        this.generateUrl,
        body,
        {
          timeout: timeoutMs,
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          validateStatus: () => true,
        }
      );

      if (res.status < 200 || res.status >= 300) {
        const err: any = new Error(`Ollama HTTP ${res.status}`);
        err.code = "OLLAMA_HTTP_ERROR";
        err.details = { status: res.status, data: res.data, url: this.generateUrl, timeoutMs };
        throw err;
      }

      if ((res.data as any)?.error) {
        const err: any = new Error(`Ollama error: ${(res.data as any).error}`);
        err.code = "OLLAMA_ERROR";
        err.details = { data: res.data, url: this.generateUrl, timeoutMs };
        throw err;
      }

      return res.data ?? {};
    } catch (err) {
      throw toOllamaError(err, { url: this.generateUrl, timeoutMs });
    }
  }

  async generateText(params: {
    prompt: string;
    options?: Record<string, any>;
    timeoutMs?: number;
  }): Promise<string> {
    if (!this.enabled) {
      const err: any = new Error("Ollama disabled (env.ollama.enabled=false)");
      err.code = "OLLAMA_DISABLED";
      throw err;
    }

    const body: OllamaGenerateRequest = {
      model: this.model,
      prompt: params.prompt,
      stream: false,
      options: {
        temperature: 0.2,
        top_p: 0.9,
        num_ctx: clampInt(this.numCtxDefault, 256, 4096),
        num_predict: clampInt(this.numPredictDefault, 32, 512),
        stop: ["\n\n"],
        ...(this.numThread > 0 ? { num_thread: this.numThread } : {}),
        ...(params.options ?? {}),
      },
      keep_alive: this.keepAlive,
    };

    const data = await this.postGenerate(body, { timeoutMs: params.timeoutMs });
    const txt = String(data?.response ?? "").trim();

    if (!txt) {
      const err: any = new Error("Empty response from Ollama");
      err.code = "OLLAMA_EMPTY_RESPONSE";
      err.details = { data, url: this.generateUrl };
      throw err;
    }

    return txt;
  }

  /**
   * ✅ JSON robusto + retry especial para timeout:
   * - tentativa 0: normal
   * - timeout: reduz num_ctx e num_predict e tenta de novo
   * - parse: extrai JSON balanceado (quando o modelo vaza texto)
   */
  async generateJson<T>(params: {
    prompt: string;
    options?: Record<string, any>;
    timeoutMs?: number;
    retries?: number; // default 1
  }): Promise<T> {
    if (!this.enabled) {
      const err: any = new Error("Ollama disabled (env.ollama.enabled=false)");
      err.code = "OLLAMA_DISABLED";
      throw err;
    }

    const retries = Number.isFinite(params.retries) ? Number(params.retries) : 1;

    // ✅ timeout padrão para JSON: não deixa travar 45s por padrão
    const timeoutMs =
      params.timeoutMs ??
      Math.min(this.timeoutMs || 20_000, 20_000); // cap 20s

    const baseOptions = {
      // JSON mais determinístico
      temperature: 0.1,
      top_p: 0.85,
      num_ctx: clampInt(this.numCtxDefault, 256, 2048),
      num_predict: clampInt(this.numPredictDefault, 64, 220),
      // ajuda muito a não "fugir" do json
      stop: ["\n\n", "```"],
      ...(this.numThread > 0 ? { num_thread: this.numThread } : {}),
      ...(params.options ?? {}),
    };

    const body: OllamaGenerateRequest = {
      model: this.model,
      prompt: params.prompt,
      stream: false,
      format: "json",
      options: baseOptions,
      keep_alive: this.keepAlive,
    };

    let lastRaw = "";
    let lastExtracted = "";

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const data = await this.postGenerate(body, { timeoutMs });
        const raw = String(data?.response ?? "").trim();
        lastRaw = raw;

        if (!raw) {
          const err: any = new Error("Empty response from Ollama");
          err.code = "OLLAMA_EMPTY_RESPONSE";
          err.details = { data, url: this.generateUrl };
          throw err;
        }

        const extracted = extractJsonBalanced(raw) ?? "";
        lastExtracted = extracted;

        if (extracted) {
          return JSON.parse(extracted) as T;
        }

        // não conseguiu extrair -> retry com instrução mais curta
        if (attempt < retries) {
          body.prompt =
            params.prompt +
            "\n\nRETORNE APENAS JSON VÁLIDO. Sem explicações. Sem texto fora do JSON.";
          const np = clampInt(Number(body.options?.num_predict ?? this.numPredictDefault), 64, 220);
          body.options = { ...(body.options ?? {}), num_predict: clampInt(np + 24, 64, 220) };
          continue;
        }
      } catch (e: any) {
        if (attempt < retries && isTimeout(e)) {
          // ✅ se timeout: reduzir trabalho do modelo
          const np = clampInt(Number(body.options?.num_predict ?? this.numPredictDefault), 64, 220);
          const nc = clampInt(Number(body.options?.num_ctx ?? this.numCtxDefault), 256, 2048);

          body.options = {
            ...(body.options ?? {}),
            temperature: 0.1,
            top_p: 0.85,
            num_predict: clampInt(Math.floor(np * 0.55), 64, 160),
            num_ctx: clampInt(Math.floor(nc * 0.6), 256, 1024),
            stop: ["\n\n", "```"],
          };

          // instrução extra pra cortar texto
          body.prompt =
            params.prompt +
            "\n\n(Se estiver lento: JSON curto, 1 frase por campo.)";
          continue;
        }
        throw e;
      }
    }

    const err: any = new Error("Failed to parse JSON from Ollama response");
    err.code = "OLLAMA_JSON_PARSE_FAILED";
    err.details = {
      raw: lastRaw.slice(0, 4000),
      extracted: lastExtracted.slice(0, 4000),
      url: this.generateUrl,
    };
    throw err;
  }
}
