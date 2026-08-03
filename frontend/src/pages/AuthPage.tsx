import React, { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Eye, EyeOff, Loader2, MailCheck } from "lucide-react";
import { getCurrentUser, getGoogleAuthUrl, requestPasswordReset, resetPassword, signIn, signUp, verifyEmail } from "../lib/api";
import { useAuth } from "../hooks/useAuth";
import { buildCleanAuthPath } from "../lib/auth-url";
import { validateAuthForm } from "../lib/auth-validation";
import { motion } from "motion/react";

function GoogleIcon() {
  return <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden><path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.54 5.54 0 0 1-2.4 3.63v3h3.86c2.26-2.09 3.56-5.17 3.56-8.87z" /><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A11.99 11.99 0 0 0 12 24z" /><path fill="#FBBC05" d="M5.27 14.29a7.2 7.2 0 0 1 0-4.58V6.62H1.29a11.99 11.99 0 0 0 0 10.76l3.98-3.09z" /><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.7 0 3.99 2.47 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z" /></svg>;
}

function AuthField({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return <div><label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</label>{children}</div>;
}

type AuthMode = "signin" | "signup" | "forgot" | "reset";

const authCopy: Record<AuthMode, { title: string; subtitle: string; action: string }> = {
  signin: { title: "Chào bạn trở lại", subtitle: "Đăng nhập để giữ lại khẩu vị và cuộc trò chuyện.", action: "Đăng nhập" },
  signup: { title: "Tạo tài khoản Bếp", subtitle: "Lưu khẩu vị, món yêu thích và lịch sử trò chuyện.", action: "Đăng ký" },
  forgot: { title: "Quên mật khẩu", subtitle: "Nhập email để nhận liên kết đặt lại mật khẩu.", action: "Gửi liên kết" },
  reset: { title: "Đặt mật khẩu mới", subtitle: "Chọn một mật khẩu mới cho tài khoản Bếp.", action: "Đổi mật khẩu" },
};

export function AuthPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const returnToParam = new URLSearchParams(location.search).get("returnTo");
  const returnTo = returnToParam?.startsWith("/") && !returnToParam.startsWith("//") ? returnToParam : "/saved";
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const oauthSuccess = searchParams.get("oauthSuccess");
  const oauthError = searchParams.get("oauthError");
  const resetToken = searchParams.get("resetToken") ?? "";
  const verificationToken = searchParams.get("verifyToken") ?? "";
  const copy = authCopy[mode];
  const cleanCallbackUrl = () => navigate(buildCleanAuthPath(returnTo, resetToken || undefined), { replace: true });

  useEffect(() => {
    if (oauthSuccess === "google") {
      cleanCallbackUrl();
      setBusy(true);
      void getCurrentUser().then(() => navigate(returnTo, { replace: true })).catch(() => setError("Không thể khôi phục phiên Google." )).finally(() => setBusy(false));
    }
  }, [navigate, oauthSuccess, returnTo]);

  useEffect(() => {
    if (resetToken) setMode("reset");
    if (oauthError === "google") {
      cleanCallbackUrl();
      setError("Không đăng nhập được bằng Google. Thử lại nhé.");
    }
    if (verificationToken) {
      cleanCallbackUrl();
      setBusy(true);
      void verifyEmail(verificationToken).then(() => {
        setNotice("Email đã được xác minh. Bạn có thể đăng nhập ngay.");
      }).catch((cause) => {
        setError(cause instanceof Error ? cause.message : "Không thể xác minh email.");
      }).finally(() => setBusy(false));
    }
  }, [oauthError, resetToken, verificationToken]);

  useEffect(() => {
    if (user) navigate(returnTo, { replace: true });
  }, [navigate, returnTo, user]);

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setError("");
    setNotice("");
    setPassword("");
    setConfirm("");
    if (next !== "reset") navigate(`/auth${returnTo !== "/saved" ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`, { replace: true });
  };

  const google = async () => {
    setError("");
    setBusy(true);
    try {
      const result = await getGoogleAuthUrl();
      window.location.assign(result.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không đăng nhập được bằng Google.");
      setBusy(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setNotice("");

    const validationError = validateAuthForm({ mode, email, password, confirm, resetToken });
    if (validationError) return setError(validationError);
    if (mode === "forgot") {
      setBusy(true);
      try {
        const result = await requestPasswordReset(email.trim());
        if (result.resetToken) {
          navigate(`/auth?resetToken=${encodeURIComponent(result.resetToken)}${returnTo !== "/saved" ? `&returnTo=${encodeURIComponent(returnTo)}` : ""}`, { replace: true });
          return;
        }
        setNotice("Đã gửi liên kết đặt lại mật khẩu. Kiểm tra hộp thư của bạn.");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Không thể gửi liên kết đặt lại mật khẩu.");
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    try {
      if (mode === "signin") {
        await signIn({ email: email.trim(), password });
        navigate(returnTo, { replace: true });
      } else if (mode === "signup") {
        await signUp({ email: email.trim(), password, confirmPassword: confirm, displayName: name.trim() });
        setNotice("Đăng ký thành công. Hãy kiểm tra email để xác minh tài khoản.");
      } else {
        await resetPassword({ token: resetToken, password, confirmPassword: confirm });
        setNotice("Đổi mật khẩu thành công. Bạn có thể đăng nhập bằng mật khẩu mới.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể thực hiện yêu cầu.");
    } finally {
      setBusy(false);
    }
  };

  if (user) return null;

  return (
    <main className="grid min-h-screen place-items-center bg-parchment/50 px-4 py-10">
      <div className="w-full max-w-sm">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Về Bếp
        </Link>

        <motion.div initial={{ opacity: 0, transform: "translateY(12px) scale(0.98)" }} animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }} transition={{ duration: 0.24, ease: [0.23, 1, 0.32, 1] }} className="mt-4 rounded-3xl border border-border bg-card p-7 shadow-lift">
          <img src="/bep-mark.png" alt="" width={512} height={512} className="h-10 w-10 object-contain" />
          <h1 className="mt-5 font-display text-3xl leading-tight">{copy.title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{copy.subtitle}</p>

          {notice ? (
            <div className="mt-6 rounded-2xl border border-primary/30 bg-primary/5 p-4">
              <MailCheck className="h-5 w-5 text-primary" />
              <p className="mt-2 text-sm font-medium">{mode === "signup" ? "Kiểm tra email để xác nhận tài khoản" : mode === "forgot" ? "Kiểm tra email để đặt lại mật khẩu" : "Mật khẩu đã được cập nhật"}</p>
              <p className="mt-1 text-sm text-muted-foreground">{mode === "reset" ? "Bạn có thể quay lại đăng nhập và sử dụng mật khẩu mới." : <>Bếp đã gửi hướng dẫn tới <span className="font-medium text-foreground">{email}</span>. Mở thư và bấm liên kết trong đó để tiếp tục.</>}</p>
              <button type="button" onClick={() => switchMode("signin")} className="mt-4 text-sm font-medium text-primary hover:underline">Quay lại đăng nhập</button>
            </div>
          ) : (
            <>
            {mode !== "forgot" && mode !== "reset" && <button type="button" onClick={() => void google()} disabled={busy} className="mt-6 flex w-full items-center justify-center gap-2.5 rounded-xl border border-border px-4 py-2.5 text-sm font-medium transition-colors hover:border-primary/50 disabled:opacity-60"><GoogleIcon /> Tiếp tục với Google</button>}
            {mode !== "forgot" && mode !== "reset" && <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-widest text-muted-foreground"><span className="h-px flex-1 bg-border" /> hoặc <span className="h-px flex-1 bg-border" /></div>}
            <form onSubmit={submit} className="space-y-4" noValidate>
              {mode === "signup" && <AuthField label="Tên gọi" htmlFor="name"><input id="name" autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Bạn muốn Bếp gọi bạn là gì?" className="field-control" /></AuthField>}
              {mode !== "reset" && <AuthField label="Email" htmlFor="email"><input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="email@vidu.com" className="field-control" /></AuthField>}
              {mode !== "forgot" && <AuthField label="Mật khẩu" htmlFor="password"><div className="relative"><input id="password" type={showPassword ? "text" : "password"} autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={mode === "signup" ? "Ít nhất 6 ký tự" : "Mật khẩu"} className="field-control pr-11" /><button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div></AuthField>}
              {(mode === "signup" || mode === "reset") && <AuthField label="Xác nhận mật khẩu" htmlFor="confirm"><input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder="Nhập lại mật khẩu" className="field-control" /></AuthField>}
              {error && <p className="rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
              <button type="submit" disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60">{busy && <Loader2 className="h-4 w-4 animate-spin" />}{busy ? "Đang xử lý…" : copy.action}</button>
            </form>
            </>
          )}

          {!notice && <div className="mt-5 space-y-2 text-center text-sm">
            {mode === "signin" && <><button type="button" onClick={() => switchMode("forgot")} className="text-muted-foreground hover:text-foreground">Quên mật khẩu?</button><p className="text-muted-foreground">Chưa có tài khoản? <button type="button" onClick={() => switchMode("signup")} className="font-medium text-primary hover:underline">Đăng ký</button></p></>}
            {mode === "signup" && <p className="text-muted-foreground">Đã có tài khoản? <button type="button" onClick={() => switchMode("signin")} className="font-medium text-primary hover:underline">Đăng nhập</button></p>}
            {(mode === "forgot" || mode === "reset") && <button type="button" onClick={() => switchMode("signin")} className="text-muted-foreground hover:text-foreground">Quay lại đăng nhập</button>}
          </div>}
        </motion.div>

        {mode === "signup" && !notice && <p className="mt-4 px-2 text-center text-xs text-muted-foreground">Bằng việc đăng ký, bạn đồng ý để Bếp lưu khẩu vị và lịch sử trò chuyện của bạn.</p>}
      </div>
    </main>
  );
}








