import { PrismaClient } from "@prisma/client";
import { PrismaInstagramTokenStore } from "../../../src/infrastructure/db/PrismaInstagramTokenStore";

describe("PrismaInstagramTokenStore", () => {
  const prisma = new PrismaClient();
  const store = new PrismaInstagramTokenStore();

  const base = {
    userId: "user-1",
    igUserId: "ig-1",
  };

  // ✅ helper: cria um usuário válido (User.name/passwordHash/email são obrigatórios no schema)
  async function ensureUser(id: string) {
    const existing = await prisma.user.findUnique({ where: { id } });
    if (existing) return existing;

    return prisma.user.create({
      data: {
        id,
        email: `tokenstore+${id}@looma.test`,
        name: "Test User",
        passwordHash: "hash-test",
      },
    });
  }

  // ✅ helper: respeita o contrato (accessToken + isConnected obrigatórios)
  function save(overrides: Partial<any>) {
    return store.saveOrUpdate({
      ...base,
      accessToken: "token-default",
      isConnected: true,
      ...overrides,
    });
  }

  beforeEach(async () => {
    // ordem por FK: primeiro dependentes, depois User
    await prisma.instagramAccount.deleteMany();
    await prisma.user.deleteMany({
      where: { email: { contains: "tokenstore+" } },
    });

    // ✅ cria o user que o upsert precisa
    await ensureUser(base.userId);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // =====================================================
  // BASE
  // =====================================================

  it("salva token corretamente na primeira vez", async () => {
    const expiresAt = new Date(Date.now() + 3600_000);

    await save({
      accessToken: "token-1",
      expiresAt,
      isConnected: true,
    });

    const row = await prisma.instagramAccount.findFirst({ where: base });

    expect(row).not.toBeNull();
    expect(row?.accessToken).toBe("token-1");
    expect(row?.expiresAt?.getTime()).toBe(expiresAt.getTime());
    expect(row?.isConnected).toBe(true);
  });

  it("não perde token quando fizer update (mesmo token)", async () => {
    await save({
      accessToken: "token-original",
      isConnected: true,
    });

    await save({
      accessToken: "token-original",
      isConnected: true,
      username: "novo_username",
    });

    const row = await prisma.instagramAccount.findFirst({ where: base });

    expect(row?.accessToken).toBe("token-original");
    expect(row?.username).toBe("novo_username");
  });

  it("sobrescreve accessToken quando vier token novo", async () => {
    await save({ accessToken: "token-antigo", isConnected: true });
    await save({ accessToken: "token-novo", isConnected: true });

    const row = await prisma.instagramAccount.findFirst({ where: base });

    expect(row?.accessToken).toBe("token-novo");
  });

  it("não perde expiresAt quando não for reenviado (com mesmo token)", async () => {
    const expiresAt = new Date(Date.now() + 7200_000);

    await save({
      accessToken: "token",
      expiresAt,
      isConnected: true,
    });

    await save({
      accessToken: "token",
      isConnected: true,
      username: "x",
    });

    const row = await prisma.instagramAccount.findFirst({ where: base });

    expect(row?.expiresAt?.getTime()).toBe(expiresAt.getTime());
    expect(row?.username).toBe("x");
  });

  it("permite limpar pageAccessToken explicitamente", async () => {
    await save({
      accessToken: "token",
      isConnected: true,
      pageAccessToken: "page-token",
    });

    await save({
      accessToken: "token",
      isConnected: true,
      pageAccessToken: null,
    });

    const row = await prisma.instagramAccount.findFirst({ where: base });

    expect(row?.pageAccessToken).toBeNull();
  });

  it("mantém integridade por chave composta (userId + igUserId)", async () => {
    // mesma base userId, igUserId diferentes
    await store.saveOrUpdate({
      userId: "user-1",
      igUserId: "ig-1",
      accessToken: "token-1",
      isConnected: true,
    });

    await store.saveOrUpdate({
      userId: "user-1",
      igUserId: "ig-2",
      accessToken: "token-2",
      isConnected: true,
    });

    const rows = await prisma.instagramAccount.findMany({
      where: { userId: "user-1" },
    });

    expect(rows).toHaveLength(2);
  });

  // =====================================================
  // ESTRESSE REAL
  // =====================================================

  it("sobrevive a múltiplos updates sem corromper token/expiração", async () => {
    const expiresAt = new Date(Date.now() + 3600_000);

    await save({
      accessToken: "token-original",
      expiresAt,
      isConnected: true,
      username: "user1",
    });

    await save({ accessToken: "token-original", isConnected: true, username: "user2" });
    await save({ accessToken: "token-original", isConnected: true, username: "user3" });
    await save({ accessToken: "token-original", isConnected: true });

    const row = await prisma.instagramAccount.findFirst({ where: base });

    expect(row?.accessToken).toBe("token-original");
    expect(row?.expiresAt?.getTime()).toBe(expiresAt.getTime());
    expect(row?.username).toBe("user3");
    expect(row?.isConnected).toBe(true);
  });

  it("resiste a updates concorrentes sem perder token", async () => {
    await save({ accessToken: "token-base", isConnected: true });

    await Promise.all([
      save({ accessToken: "token-base", isConnected: true, username: "u1" }),
      save({ accessToken: "token-base", isConnected: true, username: "u2" }),
      save({ accessToken: "token-base", isConnected: true, pageAccessToken: "page-1" }),
    ]);

    const row = await prisma.instagramAccount.findFirst({ where: base });

    expect(row?.accessToken).toBe("token-base");
    expect(row?.isConnected).toBe(true);
    expect(["u1", "u2"]).toContain(row?.username ?? "");
    expect(row?.pageAccessToken).toBe("page-1");
  });

  it("token novo NÃO herda expiresAt antigo", async () => {
    const oldExp = new Date(Date.now() + 1000);
    const newExp = new Date(Date.now() + 3600_000);

    await save({
      accessToken: "token-old",
      expiresAt: oldExp,
      isConnected: true,
    });

    await save({
      accessToken: "token-new",
      expiresAt: newExp,
      isConnected: true,
    });

    const row = await prisma.instagramAccount.findFirst({ where: base });

    expect(row?.accessToken).toBe("token-new");
    expect(row?.expiresAt?.getTime()).toBe(newExp.getTime());
  });

  it("aguenta MANY updates seguidos sem perder token", async () => {
    await save({ accessToken: "token", isConnected: true });

    for (let i = 0; i < 20; i++) {
      await save({
        accessToken: "token",
        isConnected: true,
        username: `user-${i}`,
      });
    }

    const row = await prisma.instagramAccount.findFirst({ where: base });

    expect(row?.accessToken).toBe("token");
    expect(row?.username).toBe("user-19");
    expect(row?.isConnected).toBe(true);
  });
});