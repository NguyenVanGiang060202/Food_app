import assert from "node:assert/strict";
import test from "node:test";
import { buildCleanAuthPath } from "../src/lib/auth-url.ts";

test("buildCleanAuthPath removes callback parameters and preserves a safe return path", () => {
  assert.equal(buildCleanAuthPath("/profile"), "/auth?returnTo=%2Fprofile");
});

test("buildCleanAuthPath preserves only the reset token needed by the reset form", () => {
  assert.equal(buildCleanAuthPath("/saved", "reset-token"), "/auth?resetToken=reset-token");
});

test("buildCleanAuthPath rejects protocol-relative return paths", () => {
  assert.equal(buildCleanAuthPath("//evil.example"), "/auth");
});