// test/jest.setup.ts
import { resetAllMocks } from "./mocks/resetMocks";

// ✅ MOCK GLOBAL DO AXIOS (com create + interceptors)
jest.mock("axios", () => {
  const get = jest.fn();
  const post = jest.fn();

  const instance = {
    get,
    post,
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  };

  const create = jest.fn(() => instance);

  return {
    __esModule: true,
    default: {
      get,
      post,
      create,
      // caso alguma parte use axios.isAxiosError
      isAxiosError: (e: any) => !!e?.isAxiosError,
    },
  };
});

beforeEach(() => {
  resetAllMocks();
});