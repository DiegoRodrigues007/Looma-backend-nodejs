/* eslint-disable @typescript-eslint/no-explicit-any */

// ✅ Tipos mínimos (locais) só com o que a gente usa
export type RabbitConsumeMessage = {
  content: Buffer;
  properties: {
    headers?: Record<string, any>;
  };
};

export type RabbitChannel = {
  prefetch: (count: number) => Promise<any> | any;

  assertExchange: (name: string, type: string, options?: any) => Promise<any> | any;
  assertQueue: (name: string, options?: any) => Promise<any> | any;
  bindQueue: (queue: string, exchange: string, pattern: string) => Promise<any> | any;

  sendToQueue: (queue: string, content: Buffer, options?: any) => boolean;

  consume: (
    queue: string,
    onMessage: (msg: RabbitConsumeMessage | null) => Promise<void> | void,
    options?: any
  ) => Promise<any> | any;

  ack: (msg: RabbitConsumeMessage) => void;
  nack: (msg: RabbitConsumeMessage, allUpTo?: boolean, requeue?: boolean) => void;
};

export type RabbitConnection = {
  on: (event: "close" | "error", cb: (...args: any[]) => void) => void;
  createChannel: () => Promise<RabbitChannel>;
  close?: () => Promise<void>;
};

// ✅ Runtime via require (não depende dos types do pacote)
const amqplib = require("amqplib") as {
  connect: (url: string) => Promise<RabbitConnection>;
};

const RABBITMQ_URL = process.env.RABBITMQ_URL || "amqp://localhost:5672";

let conn: RabbitConnection | null = null;
let ch: RabbitChannel | null = null;

export async function getChannel(): Promise<RabbitChannel> {
  if (ch) return ch;

  const connection = await amqplib.connect(RABBITMQ_URL);

  connection.on("close", () => {
    conn = null;
    ch = null;
  });

  connection.on("error", () => {
    // evita crash em loop
  });

  const channel = await connection.createChannel();
  await channel.prefetch(2);

  // ✅ seta só no final
  conn = connection;
  ch = channel;

  return channel;
}

export async function assertTopology(): Promise<void> {
  const channel = await getChannel();

  await channel.assertExchange("ig.dlx", "direct", { durable: true });

  await channel.assertQueue("ig.analytics.ensure_range", {
    durable: true,
    deadLetterExchange: "ig.dlx",
    deadLetterRoutingKey: "ig.analytics.ensure_range.dlq",
  });

  await channel.assertQueue("ig.analytics.ensure_range.retry", {
    durable: true,
    messageTtl: 30_000,
    deadLetterExchange: "",
    deadLetterRoutingKey: "ig.analytics.ensure_range",
  });

  await channel.assertQueue("ig.analytics.ensure_range.dlq", { durable: true });

  await channel.bindQueue(
    "ig.analytics.ensure_range.dlq",
    "ig.dlx",
    "ig.analytics.ensure_range.dlq"
  );
}

export async function publish(
  queue: string,
  payload: unknown,
  options?: { headers?: Record<string, unknown> }
): Promise<void> {
  const channel = await getChannel();
  const body = Buffer.from(JSON.stringify(payload));

  channel.sendToQueue(queue, body, {
    persistent: true,
    contentType: "application/json",
    headers: options?.headers ?? {},
  });
}

export async function consume(
  queue: string,
  handler: (msg: RabbitConsumeMessage) => Promise<void>
): Promise<void> {
  const channel = await getChannel();

  await channel.consume(queue, async (msg) => {
    if (!msg) return;

    try {
      await handler(msg);
      channel.ack(msg);
    } catch {
      const headers = msg.properties?.headers ?? {};
      const attempts = Number((headers as any)["x-attempts"] ?? 0) + 1;

      if (attempts <= 5) {
        const payload = JSON.parse(msg.content.toString());

        await publish("ig.analytics.ensure_range.retry", payload, {
          headers: { ...(headers as any), "x-attempts": attempts },
        });

        channel.ack(msg);
      } else {
        channel.nack(msg, false, false);
      }
    }
  });
}
