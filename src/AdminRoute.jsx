import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import AdminHome from "./AdminHome";
import Admin from "./Admin";
import Videos from "./Videos";
import Posts from "./Posts";
import ArchiveImport from "./ArchiveImport";
import PhotoManager from "./PhotoManager";

function AdminRoute() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const path = window.location.pathname;

  useEffect(() => {
    checkSession();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        setSession(nextSession);
        setLoading(false);
      },
    );
    return () => subscription.unsubscribe();
  }, []);

  async function checkSession() {
    const { data: { session: currentSession } } = await supabase.auth.getSession();
    setSession(currentSession);
    setLoading(false);
  }

  if (loading) return null;
  if (!session) {
    window.location.href = "/login";
    return null;
  }

  if (path === "/admin/import") return <ArchiveImport />;
  if (path === "/admin/upload") return <Admin />;
  if (path === "/admin/videos") return <Videos isAdmin={true} />;
  if (path === "/admin/posts") return <Posts isAdmin={true} />;
  if (path === "/admin/photos/manage") return <PhotoManager />;
  return <AdminHome />;
}

export default AdminRoute;
