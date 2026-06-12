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
  app.locals.emailsRouter = emailsRouter;
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
        raw_sender TEXT,
        body TEXT,
        text TEXT,
        html TEXT
      );
      CREATE TABLE attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email_id INTEGER,
        filename TEXT,
        content_type TEXT,
        path TEXT,
        created_at TEXT
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

  test("email text decoding repairs mojibake and stored text omits accents", () => {
    const router = buildApp().locals.emailsRouter;
    const {
      decodeBufferWithCharset,
      decodeHtmlEntities,
      normalizeEmailText,
      normalizeStoredEmailText,
    } = router._emailTextUtils;

    const accented = "Mar\u00eda Jos\u00e9 Rojas, Administraci\u00f3n, N\u00b0592";
    const mojibake = "Mar\u00c3\u00ada Jos\u00c3\u00a9 Rojas, Administraci\u00c3\u00b3n, N\u00c2\u00b0592";

    expect(decodeBufferWithCharset(Buffer.from(accented, "utf8"), "utf-8"))
      .toBe(accented);
    expect(normalizeEmailText(mojibake))
      .toBe(accented);
    expect(normalizeStoredEmailText(mojibake))
      .toBe("Maria Jose Rojas, Administracion, N\u00b0592");
    expect(decodeHtmlEntities("validaci&oacute;n"))
      .toBe("validaci\u00f3n");
    expect(normalizeStoredEmailText("validaci&=, oacute;n"))
      .toBe("validacion");
  });

  test("stored broken rows are cleaned when the router loads", async () => {
    db.prepare(`
      INSERT INTO emails (sender, domain, subject, date, classification, fetched_at, raw_sender, text, html)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "m@test.com",
      "test.com",
      "Administraci\u00c3\u00b3n",
      "2026-01-03T10:00:00.000Z",
      "trusted",
      "2026-01-03T11:00:00.000Z",
      "Mar\u00c3\u00ada <m@test.com>",
      "validaci&=, oacute;n",
      "<p>Administraci\u00c3\u00b3n</p>"
    );

    const app = buildApp();
    const res = await request(app).get("/api/emails/3");

    expect(res.status).toBe(200);
    expect(res.body.subject).toBe("Administracion");
    expect(res.body.raw_sender).toBe("Maria <m@test.com>");
    expect(res.body.text).toBe("validacion");
    expect(res.body.html).toBe("<p>Administracion</p>");
  });
});
