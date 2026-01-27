// test/unit/mocks/prismaClient.ts
export const prisma = {
  user: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  instagramAccount: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    deleteMany: jest.fn(),
    update: jest.fn(),
  },
  instagramPost: {
    upsert: jest.fn(),
    findMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  instagramBackfillJob: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    deleteMany: jest.fn(),
  },
} as any;