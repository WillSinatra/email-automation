import { connectToServer } from "../src/services/api";

describe("api timeout handling", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("connectToServer throws timeout message on AbortError", async () => {
    global.fetch.mockRejectedValue({ name: "AbortError" });

    await expect(
      connectToServer({
        host: "imap.test.com",
        port: 993,
        user: "user@test.com",
        password: "secret",
      })
    ).rejects.toThrow("Request timed out. Please try again.");
  });
});
