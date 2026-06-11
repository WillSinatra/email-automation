const { classifyEmail, classify_sender } = require("../services/classifier");

describe("classifyEmail", () => {
  test("known trusted domain returns trusted", () => {
    const result = classifyEmail("gmail.com", []);
    expect(result).toBe("trusted");
  });

  test("google.com is treated as trusted", () => {
    const result = classifyEmail("google.com", []);
    expect(result).toBe("trusted");
  });

  test("unknown domain returns spam", () => {
    const result = classifyEmail("some-random-domain.test", []);
    expect(result).toBe("spam");
  });

  test("custom trusted rule overrides default spam", () => {
    const rules = [{ domain: "mycompany.internal", category: "trusted" }];
    const result = classifyEmail("mycompany.internal", rules);
    expect(result).toBe("trusted");
  });

  test("display name format is extracted correctly", () => {
    expect(classify_sender("John Doe <john@gmail.com>", [])).toBe("trusted");
    expect(classify_sender("Jane <user@yahoo.com.ar>", [])).toBe("trusted");
  });

  test("malformed or missing domain returns spam", () => {
    expect(classify_sender("not-an-email", [])).toBe("spam");
    expect(classify_sender("John Doe <invalid>", [])).toBe("spam");
    expect(classify_sender("", [])).toBe("spam");
  });

  test("null or undefined domain returns spam without crashing", () => {
    expect(() => classifyEmail(null, [])).not.toThrow();
    expect(() => classifyEmail(undefined, [])).not.toThrow();
    expect(classifyEmail(null, [])).toBe("spam");
    expect(classifyEmail(undefined, [])).toBe("spam");
  });
});
