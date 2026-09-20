import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import "./Login.css";

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetMode, setResetMode] = useState(
    new URLSearchParams(window.location.search).get("reset") === "1" ||
    window.location.hash.includes("type=recovery"),
  );

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setResetMode(true);
        setMessage("새 비밀번호를 입력해주세요.");
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleLogin(event) {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (error) {
      console.error("관리자 로그인 오류:", error);
      const errorCode = error.code || "";
      const errorText = String(error.message || "");

      if (
        errorCode === "invalid_credentials" ||
        /invalid login credentials/i.test(errorText)
      ) {
        setMessage(
          "Supabase가 이메일 또는 비밀번호 불일치로 응답했습니다. 저장된 사용자 계정과 접속 중인 Supabase 프로젝트가 같은지 확인해주세요.",
        );
      } else if (
        errorCode === "over_request_rate_limit" ||
        errorCode === "over_email_send_rate_limit" ||
        /rate limit/i.test(errorText)
      ) {
        setMessage("로그인 시도가 너무 많아 잠시 제한되었습니다. 조금 뒤 다시 시도해주세요.");
      } else if (/failed to fetch|network/i.test(errorText)) {
        setMessage("Supabase에 연결하지 못했습니다. 인터넷 연결과 배포 환경변수를 확인해주세요.");
      } else {
        setMessage(`로그인 오류${errorCode ? ` (${errorCode})` : ""}: ${errorText}`);
      }
      setLoading(false);
      return;
    }

    window.location.href = "/admin";
  }

  async function sendResetEmail() {
    const cleanedEmail = email.trim().toLowerCase();
    if (!cleanedEmail) {
      setMessage("먼저 관리자 이메일을 입력해주세요.");
      return;
    }

    setLoading(true);
    setMessage("");
    const { error } = await supabase.auth.resetPasswordForEmail(cleanedEmail, {
      redirectTo: `${window.location.origin}/login?reset=1`,
    });
    setLoading(false);

    if (error) {
      console.error("비밀번호 재설정 메일 오류:", error);
      setMessage(`재설정 메일을 보내지 못했습니다. ${error.message}`);
      return;
    }

    setMessage("비밀번호 재설정 메일을 보냈습니다. 메일함의 링크를 열어주세요.");
  }

  async function saveNewPassword(event) {
    event.preventDefault();
    if (newPassword.length < 8) {
      setMessage("새 비밀번호는 8자 이상으로 입력해주세요.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage("새 비밀번호가 서로 일치하지 않습니다.");
      return;
    }

    setLoading(true);
    setMessage("");
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setLoading(false);

    if (error) {
      console.error("새 비밀번호 저장 오류:", error);
      setMessage(`비밀번호를 변경하지 못했습니다. ${error.message}`);
      return;
    }

    await supabase.auth.signOut();
    setResetMode(false);
    setNewPassword("");
    setConfirmPassword("");
    window.history.replaceState({}, "", "/login");
    setMessage("비밀번호가 변경되었습니다. 새 비밀번호로 로그인해주세요.");
  }

  return (
    <div className="login-page">
      <div className="login-box">
        <div className="login-header">
          <span>PHOTO ARCHIVE</span>
          <h1>ADMIN</h1>
        </div>

        {!resetMode ? (
          <form onSubmit={handleLogin} autoComplete="on">
            <div className="login-group">
              <label htmlFor="admin-login-email">EMAIL</label>
              <input
                id="admin-login-email"
                name="username"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="관리자 이메일"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
              />
            </div>

            <div className="login-group">
              <label htmlFor="admin-login-password">PASSWORD</label>
              <input
                id="admin-login-password"
                name="password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="비밀번호"
                autoComplete="current-password"
                required
              />
            </div>

            <button type="submit" disabled={loading}>
              {loading ? "로그인 중..." : "LOGIN"}
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={sendResetEmail}
              style={{ marginTop: 8, background: "transparent", color: "#777168" }}
            >
              비밀번호 재설정 메일 받기
            </button>
          </form>
        ) : (
          <form onSubmit={saveNewPassword} autoComplete="off">
            <div className="login-group">
              <label htmlFor="admin-new-password">NEW PASSWORD</label>
              <input
                id="admin-new-password"
                name="new-password"
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder="새 비밀번호 8자 이상"
                autoComplete="new-password"
                required
              />
            </div>
            <div className="login-group">
              <label htmlFor="admin-confirm-password">CONFIRM PASSWORD</label>
              <input
                id="admin-confirm-password"
                name="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="새 비밀번호 확인"
                autoComplete="new-password"
                required
              />
            </div>
            <button type="submit" disabled={loading}>
              {loading ? "변경 중..." : "비밀번호 변경"}
            </button>
          </form>
        )}

        {message && <div className="login-message" role="status">{message}</div>}
        <a href="/" className="login-home">HOME</a>
      </div>
    </div>
  );
}

export default Login;
