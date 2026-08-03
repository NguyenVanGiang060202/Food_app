export function validateAuthForm(input: {
  mode: "signin" | "signup" | "forgot" | "reset";
  email: string;
  password: string;
  confirm: string;
  resetToken: string;
}): string | null {
  if (input.mode !== "reset" && !input.email.trim()) return "Nhập email của bạn.";
  if (input.mode === "forgot") return null;
  if (input.password.length < 6) return "Mật khẩu cần ít nhất 6 ký tự.";
  if ((input.mode === "signup" || input.mode === "reset") && input.password !== input.confirm) return "Mật khẩu xác nhận không khớp.";
  if (input.mode === "reset" && !input.resetToken) return "Liên kết đặt lại mật khẩu không hợp lệ.";
  return null;
}