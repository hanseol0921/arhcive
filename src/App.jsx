import Archive from "./Archive";
import Login from "./Login";
import AdminRoute from "./AdminRoute";
import Posts from "./Posts";
import Videos from "./Videos";

function App() {
  const path = window.location.pathname;

  // =========================
  // 로그인
  // =========================

  if (path === "/login") {
    return <Login />;
  }

  // =========================
  // 관리자 영역
  // /admin
  // /admin/upload
  // /admin/videos
  // /admin/posts
  // 전부 여기로
  // =========================

  if (path.startsWith("/admin")) {
    return <AdminRoute />;
  }

  // =========================
  // 일반 동영상 아카이브
  // =========================

  if (path === "/videos") {
    return <Videos isAdmin={false} />;
  }

  // =========================
  // 일반 게시글 아카이브
  // =========================

  if (path === "/posts") {
    return <Posts isAdmin={false} />;
  }

  // =========================
  // 일반 사진 아카이브
  // =========================

  return <Archive isAdmin={false} />;
}

export default App;