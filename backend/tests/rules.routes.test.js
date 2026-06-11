const express = require("express");
const request = require("supertest");
const Database = require("better-sqlite3");

let db;

function buildApp() {
  let rulesRouter;
  jest.isolateModules(() => {
    jest.doMock("../db/database", () => db);
    rulesRouter = require("../routes/rules");
  });

  const app = express();
  app.use(express.json());
  app.use("/api/rules", rulesRouter);
  return app;
}

describe("/api/rules", () => {
  beforeEach(() => {
    jest.resetModules();
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain TEXT UNIQUE,
        category TEXT,
        created_at TEXT
      );
    `);
  });

  afterEach(() => {
    db.close();
  });

  test("POST /api/rules with valid data returns 200 and the rule", async () => {
    const app = buildApp();

    const res = await request(app)
      .post("/api/rules")
      .send({ domain: "Example.com", category: "trusted" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.rule.domain).toBe("example.com");
    expect(res.body.rule.category).toBe("trusted");
  });

  test("POST /api/rules with missing domain returns 400", async () => {
    const app = buildApp();

    const res = await request(app)
      .post("/api/rules")
      .send({ category: "spam" });

    expect(res.status).toBe(400);
  });

  test("POST /api/rules with invalid category returns 400", async () => {
    const app = buildApp();

    const res = await request(app)
      .post("/api/rules")
      .send({ domain: "example.com", category: "invalid" });

    expect(res.status).toBe(400);
  });

  test("DELETE /api/rules/:domain with existing domain returns 200", async () => {
    const app = buildApp();

    await request(app)
      .post("/api/rules")
      .send({ domain: "deleteme.com", category: "spam" });

    const res = await request(app).delete("/api/rules/deleteme.com");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });

  test("DELETE /api/rules/:domain with non-existing domain returns 404", async () => {
    const app = buildApp();

    const res = await request(app).delete("/api/rules/notfound.com");

    expect(res.status).toBe(404);
  });
});
