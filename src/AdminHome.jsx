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
      </div>

      <Archive isAdmin={true} />
    </>
  );
}

export default AdminHome;
