export const prisma = {
  user: {
    findUnique: jest.fn(),
  },

  instagramAccount: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },

  instagramPost: {
    findMany: jest.fn(),
    upsert: jest.fn(),
    createMany: jest.fn(),
    deleteMany: jest.fn(),
  },

  instagramBackfillJob: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
};