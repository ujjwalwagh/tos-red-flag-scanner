import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { app } from "../server.js";

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveFixture(relPath) {
  const candidates = [
    path.resolve(process.cwd(), relPath),
    path.resolve(__dirname, "..", relPath),
    path.resolve(__dirname, "../..", relPath)
  ];
  return candidates.find((p) => fs.existsSync(p)) || candidates[0];
}

const VALID_PDF_PATH = resolveFixture("node_modules/pdf-parse/test/data/04-valid.pdf");
const INVALID_PDF_PATH = resolveFixture("node_modules/pdf-parse/test/data/03-invalid.pdf");

let server;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise((resolve) => {
    server.close(resolve);
  });
});

test("POST /api/documents/ingest accepts valid PDF and returns structured document", async () => {
  const pdfBytes = fs.readFileSync(VALID_PDF_PATH);
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  const formData = new FormData();
  formData.append("file", blob, "tos-agreement.pdf");

  const res = await fetch(`${baseUrl}/api/documents/ingest`, {
    method: "POST",
    body: formData
  });

  assert.equal(res.status, 200);
  const data = await res.json();

  assert.equal(data.success, true);
  assert.ok(data.document);
  assert.equal(data.document.metadata.filename, "tos-agreement.pdf");
  assert.equal(data.document.metadata.pageCount, 5);
  assert.ok(data.document.pages.length === 5);
  assert.ok(data.document.segments.length > 0);
});

test("POST /api/documents/ingest rejects request when no file is uploaded", async () => {
  const formData = new FormData();

  const res = await fetch(`${baseUrl}/api/documents/ingest`, {
    method: "POST",
    body: formData
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.ok(data.error);
});

test("POST /api/documents/ingest rejects non-PDF file extension and mime type", async () => {
  const textBytes = Buffer.from("Hello world, this is a plain text file.");
  const blob = new Blob([textBytes], { type: "text/plain" });
  const formData = new FormData();
  formData.append("file", blob, "notes.txt");

  const res = await fetch(`${baseUrl}/api/documents/ingest`, {
    method: "POST",
    body: formData
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.ok(data.error.includes("Only PDF uploads are allowed"));
});

test("POST /api/documents/ingest rejects fake PDF with invalid magic bytes", async () => {
  const fakeBytes = Buffer.from("Not really a PDF file contents.");
  const blob = new Blob([fakeBytes], { type: "application/pdf" });
  const formData = new FormData();
  formData.append("file", blob, "fake.pdf");

  const res = await fetch(`${baseUrl}/api/documents/ingest`, {
    method: "POST",
    body: formData
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.ok(data.error.includes("Invalid file format"));
});

test("POST /api/documents/ingest returns 422 for corrupt PDF", async () => {
  const corruptBytes = fs.readFileSync(INVALID_PDF_PATH);
  const blob = new Blob([corruptBytes], { type: "application/pdf" });
  const formData = new FormData();
  formData.append("file", blob, "corrupt.pdf");

  const res = await fetch(`${baseUrl}/api/documents/ingest`, {
    method: "POST",
    body: formData
  });

  assert.equal(res.status, 422);
  const data = await res.json();
  assert.ok(data.error.includes("Could not read text from this PDF"));
});

test("POST /api/scan still validates empty input (Phase 1 preserved)", async () => {
  const res = await fetch(`${baseUrl}/api/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.error, "Provide one input: policy URL, PDF upload, or pasted text.");
});

test("GET / and /health return 200 OK", async () => {
  const resRoot = await fetch(`${baseUrl}/`);
  assert.equal(resRoot.status, 200);

  const resHealth = await fetch(`${baseUrl}/health`);
  assert.equal(resHealth.status, 200);
});
