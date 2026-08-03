import assert from "node:assert/strict";
import test from "node:test";
import { validateAuthForm } from "../src/lib/auth-validation.ts";

const base = { email: "user@example.com", password: "secret", confirm: "secret", resetToken: "token" };

test("validateAuthForm accepts a valid sign-in", () => {
  assert.equal(validateAuthForm({ ...base, mode: "signin" }), null);
});

test("validateAuthForm rejects missing email and short passwords", () => {
  assert.equal(validateAuthForm({ ...base, mode: "signin", email: " " }), "Nhập email của bạn.");
  assert.equal(validateAuthForm({ ...base, mode: "signin", password: "short" }), "Mật khẩu cần ít nhất 6 ký tự.");
});

test("validateAuthForm checks confirmation and reset token", () => {
  assert.equal(validateAuthForm({ ...base, mode: "signup", confirm: "different" }), "Mật khẩu xác nhận không khớp.");
  assert.equal(validateAuthForm({ ...base, mode: "reset", resetToken: "" }), "Liên kết đặt lại mật khẩu không hợp lệ.");
});

test("validateAuthForm does not require a password for forgot-password", () => {
  assert.equal(validateAuthForm({ ...base, mode: "forgot", password: "", confirm: "" }), null);
});