import assert from "node:assert/strict";
import test from "node:test";
import { createApiRequest } from "../src/lib/api-request.ts";

test("api requests include cookies and the default accept header", () => {
  const request = createApiRequest({ method: "POST", body: "{}" });
  assert.equal(request.credentials, "include");
  assert.deepEqual(request.headers, { Accept: "application/json" });
  assert.equal(request.method, "POST");
});

test("api request headers preserve caller headers without adding bearer auth", () => {
  const request = createApiRequest({ headers: { "Content-Type": "application/json" } });
  assert.deepEqual(request.headers, {
    Accept: "application/json",
    "Content-Type": "application/json",
  });
  assert.equal((request.headers as Record<string, string>).Authorization, undefined);
});