import { useState } from "react";
import { supabase } from "./supabaseClient";
import "./Login.css";

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();

    setLoading(true);
    setMessage("");

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error(error);
      setMessage("이메일 또는 비밀번호가 올바르지 않습니다.");
      setLoading(false);
      return;
    }

    // 로그인 성공
    window.location.href = "/admin";
  };

  return (
    <div className="login-page">
      <div className="login-box">

        <div className="login-header">
          <span>PHOTO ARCHIVE</span>
          <h1>ADMIN</h1>
        </div>

        <form onSubmit={handleLogin}>

          <div className="login-group">
            <label>EMAIL</label>

            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="관리자 이메일"
              required
            />
          </div>

          <div className="login-group">
            <label>PASSWORD</label>

            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="비밀번호"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
          >
            {loading ? "로그인 중..." : "LOGIN"}
          </button>

        </form>

        {message && (
          <div className="login-message">
            {message}
          </div>
        )}

        <a href="/" className="login-home">
          HOME
        </a>

      </div>
    </div>
  );
}

export default Login;