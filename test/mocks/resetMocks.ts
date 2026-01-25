import { prisma } from "../mocks/prismaClient";

export function resetAllMocks() {
  // reset prisma mocks
  for (const key of Object.keys(prisma) as Array<keyof typeof prisma>) {
    const model = prisma[key] as any;
    for (const fnKey of Object.keys(model)) {
      const fn = model[fnKey];
      if (typeof fn?.mockReset === "function") fn.mockReset();
    }
  }

  // reset axios mock se existir
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const axios = require("axios")?.default;
    if (axios?.get?.mockReset) axios.get.mockReset();
    if (axios?.post?.mockReset) axios.post.mockReset();
  } catch {
    // ignore
  }
}