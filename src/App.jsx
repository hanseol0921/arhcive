import { useEffect, useState } from "react";
import Archive from "./Archive";
import Login from "./Login";
import AdminRoute from "./AdminRoute";
import Posts from "./Posts";
import Videos from "./Videos";
import Diary from "./Diary";
import Guestbook from "./Guestbook";
import { GlobalBgmPlayer } from "./ArchiveLayout";

function App() {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const handleNavigation = () => setPath(window.location.pathname);
    window.addEventListener("popstate", handleNavigation);
    window.addEventListener("archive:navigate", handleNavigation);
    return () => {
      window.removeEventListener("popstate", handleNavigation);
      window.removeEventListener("archive:navigate", handleNavigation);
    };
  }, []);

  if (path === "/login") return <Login />;

  let page;
  if (path.startsWith("/admin")) page = <AdminRoute />;
  else if (path === "/videos") page = <Videos isAdmin={false} />;
  else if (path === "/posts") page = <Posts isAdmin={false} />;
  else if (path === "/diary") page = <Diary isAdmin={false} />;
  else if (path === "/guestbook") page = <Guestbook isAdmin={false} />;
  else page = <Archive isAdmin={false} />;

  return (
    <>
      {page}
      <GlobalBgmPlayer isAdmin={path.startsWith("/admin")} />
    </>
  );
}

export default App;
