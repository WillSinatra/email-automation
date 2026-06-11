const express = require("express");
const request = require("supertest");
const Database = require("better-sqlite3");

let db;

function buildApp() {
  let emailsRouter;
  jest.isolateModules(() => {
    jest.doMock("../db/database", () => db);
    emailsRouter = require("../routes/emails");
  });

  const app = express();
  app.use(express.json());
  app.use("/api", emailsRouter);
  return app;
}

describe("/api/emails", () => {
  beforeEach(() => {
    jest.resetModules();
    db = new Database(":memory:");

    db.exec(`
      CREATE TABLE emails (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender TEXT,
        domain TEXT,
        subject TEXT,
        date TEXT,
        classification TEXT,
        fetched_at TEXT,
        raw_sender TEXT
      );
      CREATE TABLE rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain TEXT UNIQUE,
        category TEXT,
        created_at TEXT
      );
    `);

    const insert = db.prepare(`
      INSERT INTO emails (sender, domain, subject, date, classification, fetched_at, raw_sender)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    insert.run(
      "a@gmail.com",
      "gmail.com",
      "Trusted mail",
      "2026-01-01T10:00:00.000Z",
      "trusted",
      "2026-01-01T11:00:00.000Z",
      "Alice <a@gmail.com>"
    );

    insert.run(
      "b@bad.test",
      "bad.test",
      "Spam mail",
      "2026-01-02T10:00:00.000Z",
      "spam",
      "2026-01-02T11:00:00.000Z",
      "Bob <b@bad.test>"
    );
  });

  afterEach(() => {
    db.close();
  });

  test("GET /api/emails returns array", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/emails");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(2);
  });

  test("GET /api/emails?classification=trusted returns only trusted emails", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/emails?classification=trusted");

    expect(res.status).toBe(200);
    expect(res.body.every((row) => row.classification === "trusted")).toBe(true);
    expect(res.body).toHaveLength(1);
  });

  test("DELETE /api/emails returns success and empties the table", async () => {
    const app = buildApp();

    const delRes = await request(app).delete("/api/emails");
    expect(delRes.status).toBe(200);
    expect(delRes.body).toEqual({ success: true });

    const afterRes = await request(app).get("/api/emails");
    expect(afterRes.status).toBe(200);
    expect(afterRes.body).toEqual([]);
  });
});
