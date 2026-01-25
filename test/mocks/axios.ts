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

export default {
  get,
  post,
  create,
  isAxiosError: (e: any) => !!e?.isAxiosError,
};