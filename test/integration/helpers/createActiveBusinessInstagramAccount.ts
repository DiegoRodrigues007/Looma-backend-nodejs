import { PrismaClient } from "@prisma/client";

type CreateActiveBusinessInstagramAccountParams = {
  prisma: PrismaClient;
  email: string;
  igUserId: string;
};

export async function createActiveBusinessInstagramAccount({
  prisma,
  email,
  igUserId,
}: CreateActiveBusinessInstagramAccountParams) {
  // 🧹 limpeza defensiva (permite rodar N vezes)
  await prisma.instagramBackfillJob.deleteMany({
    where: { instagramAccount: { igUserId } },
  });

  await prisma.instagramPost.deleteMany({
    where: { instagramAccount: { igUserId } },
  });

  await prisma.instagramAccount.deleteMany({
    where: { igUserId },
  });

  await prisma.user.deleteMany({
    where: { email },
  });

  // 1️⃣ cria usuário REAL
  const user = await prisma.user.create({
    data: {
      email,
      name: "Test User",
      passwordHash: "test_hash",
    },
  });

  // 2️⃣ cria conta Instagram VÁLIDA PELO SCHEMA
  const ig = await prisma.instagramAccount.create({
    data: {
      userId: user.id,

      igUserId,                         // 🔑 usado pela Graph API
      pageAccessToken: "FAKE_TOKEN_OK", // 🔑 OBRIGATÓRIO para sync
      isConnected: true,                // ✅ existe no schema
    },
  });

  // 3️⃣ marca essa conta como ATIVA para o usuário
  await prisma.user.update({
    where: { id: user.id },
    data: {
      activeInstagramAccountId: ig.id,
    },
  });

  return { user, ig };
}