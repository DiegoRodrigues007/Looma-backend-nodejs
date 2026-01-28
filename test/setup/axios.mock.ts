// test/setup/axios.mock.ts
type AxiosFnKey = "get" | "post" | "put" | "patch" | "delete" | "request";

const AXIOS_FN_KEYS = ["get", "post", "put", "patch", "delete", "request"] as const;
type AxiosFnKey2 = typeof AXIOS_FN_KEYS[number];

const requestUse = jest.fn();
const responseUse = jest.fn();

const axiosInstance: Record<AxiosFnKey, jest.Mock> & {
  interceptors: {
    request: { use: jest.Mock };
    response: { use: jest.Mock };
  };
} = {
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  patch: jest.fn(),
  delete: jest.fn(),
  request: jest.fn(),
  interceptors: {
    request: { use: requestUse },
    response: { use: responseUse },
  },
};

const axiosMock: Record<AxiosFnKey, jest.Mock> & {
  create: jest.Mock;
  interceptors: {
    request: { use: jest.Mock };
    response: { use: jest.Mock };
  };
  __instance: typeof axiosInstance;
  __reset: () => void;
} = {
  create: jest.fn(() => axiosInstance),

  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  patch: jest.fn(),
  delete: jest.fn(),
  request: jest.fn(),

  interceptors: {
    request: { use: requestUse },
    response: { use: responseUse },
  },

  __instance: axiosInstance,

  __reset() {
    for (const k of AXIOS_FN_KEYS) {
      axiosInstance[k].mockReset();
      axiosMock[k].mockReset();
    }
    axiosMock.create.mockClear();
    requestUse.mockClear();
    responseUse.mockClear();
  },
};

export default axiosMock;