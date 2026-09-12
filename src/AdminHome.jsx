import Archive from "./Archive";

function AdminHome() {
  return (
    <>
      <div className="admin-photo-manager-entry">
        <button
          type="button"
          onClick={() => {
            window.location.href = "/admin/photos/manage";
          }}
        >
          업로드 사진 관리
        </button>
        <button
          type="button"
          onClick={() => {
            window.location.href = "/admin/tags";
          }}
        >
          태그 관리
        </button>
        <button
          type="button"
          onClick={() => {
            window.location.href = "/admin/reports";
          }}
        >
          제보함
        </button>
        <button
          type="button"
          onClick={() => {
            window.location.href = "/admin/scraper";
          }}
        >
          위버스 게시글 가져오기
        </button>
      </div>

      <Archive isAdmin={true} />
    </>
  );
}

export default AdminHome;
