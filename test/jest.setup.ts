// test/jest.setup.ts
import { resetAllMocks } from "./mocks/resetMocks";

/**
 * ✅ Mantém o output limpo:
 * - some com console.log/info/debug/warn (spam de client:init etc.)
 * - mantém console.error (pra você ver só os erros/falhas)
 */
const _console = {
  log: console.log,
  info: console.info,
  debug: console.debug,
  warn: console.warn,
  error: console.error,
};

beforeAll(() => {
  console.log = () => {};
  console.info = () => {};
  console.debug = () => {};
  console.warn = () => {};
  console.error = _console.error; // mantém erros
});

afterAll(() => {
  console.log = _console.log;
  console.info = _console.info;
  console.debug = _console.debug;
  console.warn = _console.warn;
  console.error = _console.error;
});

// ✅ MOCK GLOBAL DO AXIOS (com create + interceptors)
jest.mock("axios", () => {
  const get = jest.fn();
  const post = jest.fn();

  const instance = {
    get,
    post,
    interceptors: {
      request: { use: jest.fn(), eject: jest.fn() },
      response: { use: jest.fn(), eject: jest.fn() },
    },
  };

  const create = jest.fn(() => instance);

  // Alguns códigos usam axios(...) como função.
  const axiosFn: any = (..._args: any[]) => Promise.resolve({ data: undefined });
  axiosFn.get = get;
  axiosFn.post = post;
  axiosFn.create = create;
  axiosFn.interceptors = instance.interceptors;

  axiosFn.isAxiosError = (e: any) => !!e?.isAxiosError;

  return {
    __esModule: true,
    default: axiosFn,
  };
});

beforeEach(() => {
  resetAllMocks();
});