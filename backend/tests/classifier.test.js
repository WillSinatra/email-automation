const { classifyEmail, classify_sender } = require("../services/classifier");

describe("classify_sender (priority: ignored -> trusted -> spam)", () => {
  test("exact ignored emails return 'ignored'", () => {
    expect(classify_sender("no-reply@accounts.google.com")).toBe("ignored");
    expect(classify_sender("noreply@github.com")).toBe("ignored");
  });

  test("trusted domain returns 'trusted'", () => {
    expect(classify_sender("user@gmail.com")).toBe("trusted");
  });

  test("unknown domain returns 'spam'", () => {
    expect(classify_sender("user@randomdomain.xyz")).toBe("spam");
  });

  test("malformed addresses return 'spam'", () => {
    expect(classify_sender("not-an-email")).toBe("spam");
    expect(classify_sender("")).toBe("spam");
  });

  test("classifyEmail wrapper works with domain-only input", () => {
    expect(classifyEmail("gmail.com")).toBe("trusted");
  });
});
