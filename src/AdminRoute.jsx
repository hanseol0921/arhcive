import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import AdminHome from "./AdminHome";
import Admin from "./Admin";
import Videos from "./Videos";
import Posts from "./Posts";
import ArchiveImport from "./ArchiveImport";

function AdminRoute() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  const path = window.location.pathname;

  useEffect(() => {
    checkSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setLoading(false);
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  async function checkSession() {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    setSession(session);
    setLoading(false);
  }

  if (loading) {
    return null;
  }

  // 로그인하지 않은 사람은 무조건 로그인 페이지로
  if (!session) {
    window.location.href = "/login";
    return null;
  }

  if (
  window.location.pathname ===
  "/admin/import"
) {
  return <ArchiveImport />;
}
  // 사진 업로드 페이지
  // 사진/게시물 업로드 페이지
if (path === "/admin/upload") {
  return <Admin />;
}

// 관리자 동영상 페이지
if (path === "/admin/videos") {
  return <Videos isAdmin={true} />;
}

// 관리자 게시글 페이지
if (path === "/admin/posts") {
  return <Posts isAdmin={true} />;
}

// 기본 관리자 홈
return <AdminHome />;
}

export default AdminRoute;