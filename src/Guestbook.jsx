import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";
import ArchiveLayout from "./ArchiveLayout";
import "./Guestbook.css";

const EMPTY_FORM = { nickname: "", password: "", content: "" };

function Guestbook({ isAdmin = false }) {
  const [entries, setEntries] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editContent, setEditContent] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [deleteId, setDeleteId] = useState(null);
  const [deletePassword, setDeletePassword] = useState("");
  const [message, setMessage] = useState("");
  const [profilePhotos, setProfilePhotos] = useState([]);
  const [profilePickerOpen, setProfilePickerOpen] = useState(false);
  const [profileSearch, setProfileSearch] = useState("");
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [profilePhotosLoaded, setProfilePhotosLoaded] = useState(false);

  useEffect(() => {
    loadEntries();
  }, []);

  async function loadEntries() {
    setLoading(true);
    const { data, error } = await supabase
      .from("guestbook_public")
      .select("id,nickname,content,profile_image_url,created_at,updated_at")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("방명록 조회 오류:", error);
      setMessage("방명록을 불러오지 못했습니다. SQL 설정을 확인해주세요.");
    } else {
      setEntries(data || []);
    }
    setLoading(false);
  }

  function updateForm(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function openProfilePicker() {
    setProfilePickerOpen(true);
    if (profilePhotosLoaded) return;

    const collected = [];
    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from("photos")
        .select("id,image_url,thumbnail_url,date,type,hair_color,tags,search_tags,archive_visible")
        .eq("archive_visible", true)
        .order("date", { ascending: false })
        .range(from, from + pageSize - 1);

      if (error) {
        console.error("프로필 사진 목록 조회 오류:", error);
        setMessage("프로필 사진 목록을 불러오지 못했습니다.");
        return;
      }
      collected.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
    setProfilePhotos(collected);
    setProfilePhotosLoaded(true);
  }

  async function createEntry(event) {
    event.preventDefault();
    if (!form.nickname.trim() || !form.content.trim() || form.password.length < 4) {
      setMessage("닉네임과 내용을 입력하고 비밀번호는 4자 이상으로 정해주세요.");
      return;
    }

    setSaving(true);
    setMessage("");
    const { error } = await supabase.rpc("create_guestbook_entry", {
      p_nickname: form.nickname.trim(),
      p_content: form.content.trim(),
      p_password: form.password,
      p_profile_image_url:
        selectedProfile?.thumbnail_url || selectedProfile?.image_url || null,
    });
    setSaving(false);

    if (error) {
      console.error("방명록 작성 오류:", error);
      setMessage(error.message || "방명록을 저장하지 못했습니다.");
      return;
    }

    setForm(EMPTY_FORM);
    setSelectedProfile(null);
    setMessage("방명록을 남겼습니다.");
    await loadEntries();
  }

  async function updateEntry(id) {
    if (!editContent.trim() || editPassword.length < 4) {
      setMessage("수정할 내용과 작성할 때 사용한 비밀번호를 입력해주세요.");
      return;
    }

    setSaving(true);
    const { error } = await supabase.rpc("update_guestbook_entry", {
      p_id: id,
      p_content: editContent.trim(),
      p_password: editPassword,
    });
    setSaving(false);

    if (error) {
      setMessage(error.message || "비밀번호가 맞지 않거나 수정하지 못했습니다.");
      return;
    }

    setEditingId(null);
    setEditPassword("");
    setMessage("수정되었습니다.");
    await loadEntries();
  }

  async function deleteEntry(id, asAdmin = false) {
    if (!asAdmin && deletePassword.length < 4) {
      setMessage("작성할 때 사용한 비밀번호를 입력해주세요.");
      return;
    }

    setSaving(true);
    const functionName = asAdmin
      ? "admin_delete_guestbook_entry"
      : "delete_guestbook_entry";
    const params = asAdmin ? { p_id: id } : { p_id: id, p_password: deletePassword };
    const { data: deleted, error } = await supabase.rpc(functionName, params);
    setSaving(false);

    if (error || deleted !== true) {
      setMessage(error?.message || "비밀번호가 맞지 않거나 삭제하지 못했습니다.");
      return;
    }

    setDeleteId(null);
    setDeletePassword("");
    setMessage("삭제되었습니다.");
    await loadEntries();
  }

  const filteredEntries = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return entries;
    return entries.filter((entry) =>
      [entry.nickname, entry.content].some((value) =>
        String(value || "").toLowerCase().includes(keyword),
      ),
    );
  }, [entries, search]);

  const filteredProfilePhotos = useMemo(() => {
    const keyword = profileSearch.trim().toLowerCase().replace(/\s+/g, "");
    if (!keyword) return profilePhotos;
    return profilePhotos.filter((photo) =>
      [photo.date, photo.type, photo.hair_color, ...(photo.tags || []), ...(photo.search_tags || [])]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().replace(/\s+/g, "").includes(keyword)),
    );
  }, [profilePhotos, profileSearch]);

  function formatDate(value) {
    return new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  }

  return (
    <ArchiveLayout
      isAdmin={isAdmin}
      activeTab="guestbook"
      search={search}
      onSearchChange={setSearch}
      searchPlaceholder="방명록을 검색해보세요"
    >
      <div className="guestbook-page">
        <form className="guestbook-write" onSubmit={createEntry} autoComplete="off">
          <div className="guestbook-profile-choice">
            <button type="button" className="guestbook-profile-button" onClick={openProfilePicker}>
              {selectedProfile ? (
                <img src={selectedProfile.thumbnail_url || selectedProfile.image_url} alt="선택한 프로필" />
              ) : (
                <span>PROFILE</span>
              )}
            </button>
            <div>
              <button type="button" className="guestbook-profile-select" onClick={openProfilePicker}>
                아카이브에서 프로필 사진 선택
              </button>
              {selectedProfile && (
                <button type="button" className="guestbook-profile-remove" onClick={() => setSelectedProfile(null)}>
                  선택 해제
                </button>
              )}
            </div>
          </div>
          <div className="guestbook-write-fields">
            <input
              value={form.nickname}
              name="guestbook_nickname"
              maxLength={20}
              placeholder="닉네임"
              aria-label="닉네임"
              onChange={(event) => updateForm("nickname", event.target.value)}
            />
            <input
              type="text"
              className="guestbook-secret-input"
              inputMode="numeric"
              value={form.password}
              name="guestbook_entry_pin"
              maxLength={72}
              placeholder="비밀번호 (4자 이상)"
              aria-label="비밀번호"
              autoComplete="off"
              onChange={(event) => updateForm("password", event.target.value)}
            />
          </div>
          <textarea
            value={form.content}
            maxLength={1000}
            placeholder="방명록을 남겨주세요 :)"
            aria-label="방명록 내용"
            onChange={(event) => updateForm("content", event.target.value)}
          />
          <div className="guestbook-write-footer">
            <span>{form.content.length} / 1000</span>
            <button type="submit" disabled={saving}>{saving ? "저장 중…" : "남기기"}</button>
          </div>
        </form>

        {message && <div className="guestbook-message" role="status">{message}</div>}

        <div className="guestbook-list">
          {loading && <div className="guestbook-empty">방명록을 불러오는 중...</div>}
          {!loading && filteredEntries.length === 0 && (
            <div className="guestbook-empty">아직 남겨진 방명록이 없습니다.</div>
          )}

          {filteredEntries.map((entry, index) => (
            <article className="guestbook-entry" key={entry.id}>
              <div className="guestbook-entry-number">NO. {entries.length - entries.indexOf(entry)}</div>
              {entry.profile_image_url ? (
                <img className="guestbook-entry-profile" src={entry.profile_image_url} alt="" loading="lazy" />
              ) : (
                <div className="guestbook-entry-profile guestbook-entry-profile-empty">P</div>
              )}
              <header>
                <strong>{entry.nickname}</strong>
                <time>{formatDate(entry.created_at)}</time>
                {entry.updated_at && entry.updated_at !== entry.created_at && <small>수정됨</small>}
              </header>

              {editingId === entry.id ? (
                <div className="guestbook-edit-form">
                  <textarea
                    value={editContent}
                    maxLength={1000}
                    onChange={(event) => setEditContent(event.target.value)}
                  />
                  <input
                    type="text"
                    className="guestbook-secret-input"
                    inputMode="numeric"
                    value={editPassword}
                    name={`guestbook_edit_pin_${entry.id}`}
                    placeholder="작성 비밀번호"
                    autoComplete="off"
                    onChange={(event) => setEditPassword(event.target.value)}
                  />
                  <div>
                    <button type="button" onClick={() => setEditingId(null)}>취소</button>
                    <button type="button" disabled={saving} onClick={() => updateEntry(entry.id)}>수정 저장</button>
                  </div>
                </div>
              ) : (
                <p>{entry.content}</p>
              )}

              {!editingId && (
                <div className="guestbook-actions">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(entry.id);
                      setEditContent(entry.content);
                      setEditPassword("");
                      setDeleteId(null);
                    }}
                  >
                    수정
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteId(entry.id);
                      setDeletePassword("");
                      setEditingId(null);
                    }}
                  >
                    삭제
                  </button>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm("관리자 권한으로 이 방명록을 삭제할까요?")) {
                          deleteEntry(entry.id, true);
                        }
                      }}
                    >
                      관리자 삭제
                    </button>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      </div>

      {profilePickerOpen && (
        <div className="guestbook-picker-backdrop" onClick={() => setProfilePickerOpen(false)}>
          <div className="guestbook-picker" onClick={(event) => event.stopPropagation()}>
            <div className="guestbook-picker-header">
              <strong>프로필 사진 선택</strong>
              <button type="button" onClick={() => setProfilePickerOpen(false)}>×</button>
            </div>
            <input
              className="guestbook-picker-search"
              value={profileSearch}
              placeholder="날짜, 태그, 머리색, 사진 유형 검색"
              autoFocus
              onChange={(event) => setProfileSearch(event.target.value)}
            />
            <div className="guestbook-picker-grid">
              {filteredProfilePhotos.map((photo) => (
                <button
                  type="button"
                  key={photo.id}
                  className={String(selectedProfile?.id) === String(photo.id) ? "selected" : ""}
                  onClick={() => {
                    setSelectedProfile(photo);
                    setProfilePickerOpen(false);
                  }}
                >
                  <img
                    src={photo.thumbnail_url || photo.image_url}
                    alt={photo.date || "아카이브 사진"}
                    loading="lazy"
                  />
                </button>
              ))}
              {profilePhotosLoaded && filteredProfilePhotos.length === 0 && (
                <div className="guestbook-picker-empty">검색 결과가 없습니다.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {deleteId !== null && (
        <div
          className="guestbook-delete-backdrop"
          onClick={() => {
            if (!saving) {
              setDeleteId(null);
              setDeletePassword("");
            }
          }}
        >
          <form
            className="guestbook-delete-dialog"
            autoComplete="off"
            onSubmit={(event) => {
              event.preventDefault();
              deleteEntry(deleteId);
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <strong>방명록 삭제</strong>
            <p>작성할 때 입력한 비밀번호를 적어주세요.</p>
            <input
              className="guestbook-autofill-trap"
              type="text"
              name="username"
              autoComplete="username"
              tabIndex={-1}
              aria-hidden="true"
            />
            <input
              type="text"
              className="guestbook-secret-input"
              inputMode="numeric"
              value={deletePassword}
              name="guestbook_delete_pin"
              placeholder="작성 비밀번호"
              autoComplete="off"
              autoFocus
              onChange={(event) => setDeletePassword(event.target.value)}
            />
            <div>
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setDeleteId(null);
                  setDeletePassword("");
                }}
              >
                취소
              </button>
              <button type="submit" disabled={saving || deletePassword.length < 4}>
                {saving ? "확인 중…" : "삭제 확인"}
              </button>
            </div>
          </form>
        </div>
      )}
    </ArchiveLayout>
  );
}

export default Guestbook;
