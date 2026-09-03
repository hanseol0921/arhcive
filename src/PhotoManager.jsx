import { useMemo, useState } from "react";
import { supabase } from "./supabaseClient";
import "./App.css";
import "./PhotoLightbox.css";
import TagPicker from "./TagPicker";

const HAIR_COLORS = ["흑발", "갈발", "금발", "적발", "은발", "핑머", "주머", "와인색"];
const PHOTO_TYPES = ["셀카", "남찍사", "거울셀카", "그외"];
const splitTags = (value) => value.split(",").map((tag) => tag.trim()).filter(Boolean);
const monthStart = (month) => (month ? `${month}-01` : "");
function nextMonthStart(month) {
  if (!month) return "";
  const [year, number] = month.split("-").map(Number);
  const nextYear = number === 12 ? year + 1 : year;
  const nextMonth = number === 12 ? 1 : number + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-01`;
}

function PhotoManager() {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);
  const [photos, setPhotos] = useState([]);
  const [posts, setPosts] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkHairColor, setBulkHairColor] = useState("");
  const [bulkPhotoTags, setBulkPhotoTags] = useState("");
  const [loading, setLoading] = useState(false);
  const [savingIds, setSavingIds] = useState([]);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkTagSaving, setBulkTagSaving] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const [saveAllProgress, setSaveAllProgress] = useState("");
  const [largePreview, setLargePreview] = useState(null);

  async function loadPhotos() {
    const startDate = monthStart(selectedMonth);
    const followingMonth = nextMonthStart(selectedMonth);
    if (!startDate || !followingMonth) {
      alert("조회할 월을 선택해주세요.");
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.from("photos").select("*")
        .gte("date", startDate).lt("date", followingMonth)
        .order("date", { ascending: false })
        .order("upload_order", { ascending: true }).limit(5000);
      if (error) throw error;

      const photoRows = (data || []).map((photo) => ({
        ...photo,
        tagsText: Array.isArray(photo.tags) ? photo.tags.join(", ") : "",
        searchTagsText: Array.isArray(photo.search_tags) ? photo.search_tags.join(", ") : "",
      }));
      const postIds = [...new Set(photoRows.map((photo) => photo.post_id).filter(Boolean))];
      let postRows = [];
      if (postIds.length) {
        const result = await supabase.from("weverse_posts")
          .select("id,date,posted_at,content,weverse_url").in("id", postIds);
        if (result.error) throw result.error;
        postRows = result.data || [];
      }
      setPhotos(photoRows);
      setPosts(postRows);
      setSelectedIds([]);
    } catch (error) {
      console.error("업로드 사진 조회 오류:", error);
      alert("사진을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  const groupedPosts = useMemo(() => {
    const postMap = new Map(posts.map((post) => [post.id, post]));
    const groups = new Map();
    photos.forEach((photo) => {
      const key = photo.post_id || `photo-${photo.id}`;
      if (!groups.has(key)) groups.set(key, { id: key, post: postMap.get(photo.post_id) || null, photos: [] });
      groups.get(key).photos.push(photo);
    });
    return [...groups.values()];
  }, [photos, posts]);

  function updatePhoto(id, field, value) {
    setPhotos((current) => current.map((photo) => photo.id === id ? { ...photo, [field]: value } : photo));
  }

  async function savePhoto(photo) {
    setSavingIds((current) => [...current, photo.id]);
    try {
      const values = {
        type: photo.type || null,
        hair_color: photo.hair_color || null,
        tags: splitTags(photo.tagsText || ""),
        search_tags: splitTags(photo.searchTagsText || ""),
        archive_visible: photo.archive_visible !== false,
        weverse_url: photo.weverse_url || null,
      };
      const { error } = await supabase.from("photos").update(values).eq("id", photo.id);
      if (error) throw error;
      setPhotos((current) => current.map((item) => item.id === photo.id ? { ...item, ...values } : item));
    } catch (error) {
      console.error("사진 설정 저장 오류:", error);
      alert("사진 설정을 저장하지 못했습니다.");
    } finally {
      setSavingIds((current) => current.filter((id) => id !== photo.id));
    }
  }

  function photoUpdateValues(photo) {
    return {
      type: photo.type || null,
      hair_color: photo.hair_color || null,
      tags: splitTags(photo.tagsText || ""),
      search_tags: splitTags(photo.searchTagsText || ""),
      archive_visible: photo.archive_visible !== false,
      weverse_url: photo.weverse_url || null,
    };
  }

  async function saveAllPhotos() {
    if (!photos.length || savingAll) return;
    if (!window.confirm(`현재 불러온 사진 ${photos.length}장의 설정을 전부 저장할까요?`)) return;

    setSavingAll(true);
    let savedCount = 0;

    try {
      for (let index = 0; index < photos.length; index += 200) {
        const chunk = photos.slice(index, index + 200);
        const payload = chunk.map((photo) => ({
          id: String(photo.id),
          ...photoUpdateValues(photo),
        }));

        const { error } = await supabase.rpc("bulk_update_photo_settings", {
          settings: payload,
        });
        if (error) throw error;

        savedCount += chunk.length;
        setSaveAllProgress(`${savedCount} / ${photos.length}`);
      }

      alert(`사진 ${savedCount}장의 설정을 저장했습니다.`);
    } catch (error) {
      console.error("사진 전체 저장 오류:", error);
      alert(`${savedCount}장까지 저장한 뒤 오류가 발생했습니다. 다시 누르면 전체를 재저장할 수 있습니다.`);
    } finally {
      setSavingAll(false);
      setSaveAllProgress("");
    }
  }

  function togglePhoto(id) {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  function togglePost(group) {
    const ids = group.photos.map((photo) => photo.id);
    const allSelected = ids.every((id) => selectedIds.includes(id));
    setSelectedIds((current) => allSelected ? current.filter((id) => !ids.includes(id)) : [...new Set([...current, ...ids])]);
  }

  async function applyBulkHairColor() {
    if (!bulkHairColor || !photos.length) return;
    const ids = selectedIds.length ? selectedIds : photos.map((photo) => photo.id);
    const label = selectedIds.length ? `선택한 사진 ${ids.length}장` : `조회한 사진 ${ids.length}장 전체`;
    if (!window.confirm(`${label}의 머리색을 ${bulkHairColor}(으)로 변경할까요?`)) return;
    setBulkSaving(true);
    try {
      for (let index = 0; index < ids.length; index += 200) {
        const { error } = await supabase.from("photos").update({ hair_color: bulkHairColor }).in("id", ids.slice(index, index + 200));
        if (error) throw error;
      }
      const idSet = new Set(ids);
      setPhotos((current) => current.map((photo) => idSet.has(photo.id) ? { ...photo, hair_color: bulkHairColor } : photo));
    } catch (error) {
      console.error("머리색 일괄 변경 오류:", error);
      alert("머리색을 일괄 변경하지 못했습니다.");
    } finally {
      setBulkSaving(false);
    }
  }

  async function applyBulkTags() {
    const tagsToAdd = splitTags(bulkPhotoTags);
    if (!tagsToAdd.length || !photos.length) return;

    const ids = selectedIds.length ? selectedIds : photos.map((photo) => photo.id);
    const label = selectedIds.length
      ? `선택한 사진 ${ids.length}장`
      : `현재 불러온 사진 ${ids.length}장 전체`;

    if (!window.confirm(`${label}에 ${tagsToAdd.join(", ")} 태그를 추가할까요?`)) return;

    setBulkTagSaving(true);
    try {
      const { error } = await supabase.rpc("apply_tags_to_photos", {
        p_photo_ids: ids.map(String),
        p_tags: tagsToAdd,
      });
      if (error) throw error;

      const idSet = new Set(ids.map(String));
      setPhotos((current) => current.map((photo) => {
        if (!idSet.has(String(photo.id))) return photo;
        const merged = [...new Set([...splitTags(photo.tagsText || ""), ...tagsToAdd])];
        return { ...photo, tags: merged, tagsText: merged.join(", ") };
      }));
      setBulkPhotoTags("");
      alert(`${label}에 태그를 적용했습니다.`);
    } catch (error) {
      console.error("사진 태그 일괄 적용 오류:", error);
      alert("태그를 일괄 적용하지 못했습니다. 갱신된 SQL을 실행했는지 확인해주세요.");
    } finally {
      setBulkTagSaving(false);
    }
  }

  return (
    <main className="archive-import-page photo-manager-page">
      <section className="archive-import-top">
        <div className="archive-import-header">
          <button type="button" className="archive-import-back-button" onClick={() => { window.location.href = "/admin"; }}>← 뒤로가기</button>
          <h1>업로드 사진 관리</h1>
        </div>
        <p>업로드된 사진을 월별로 불러와 게시물 단위로 정리합니다.</p>
        <div className="photo-manager-month-toolbar">
          <label>조회할 월<input type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} /></label>
          <button type="button" onClick={loadPhotos} disabled={loading || !selectedMonth}>{loading ? "불러오는 중..." : "이달 사진 불러오기"}</button>
        </div>
        <div className="photo-manager-bulk-bar">
          <span>게시물 {groupedPosts.length}개 · 사진 {photos.length}장 · 선택 {selectedIds.length}장</span>
          <select value={bulkHairColor} onChange={(e) => setBulkHairColor(e.target.value)}>
            <option value="">일괄 머리색 선택</option>
            {HAIR_COLORS.map((color) => <option value={color} key={color}>{color}</option>)}
          </select>
          <button type="button" onClick={applyBulkHairColor} disabled={bulkSaving || !photos.length || !bulkHairColor}>
            {bulkSaving ? "변경 중..." : selectedIds.length ? `선택 ${selectedIds.length}장 변경` : "조회 기간 전체 변경"}
          </button>
          <div className="photo-manager-bulk-tags">
            <TagPicker
              value={bulkPhotoTags}
              onChange={setBulkPhotoTags}
              placeholder="일괄 추가할 태그"
            />
          </div>
          <button type="button" onClick={applyBulkTags} disabled={bulkTagSaving || !photos.length || !bulkPhotoTags}>
            {bulkTagSaving
              ? "태그 적용 중..."
              : selectedIds.length
                ? `선택 ${selectedIds.length}장 태그 적용`
                : "이달 사진 전체 태그 적용"}
          </button>
          <button type="button" onClick={saveAllPhotos} disabled={savingAll || bulkSaving || !photos.length}>
            {savingAll ? `전체 저장 중 ${saveAllProgress}` : "전체 설정 저장"}
          </button>
        </div>
      </section>

      <div className="archive-draft-list photo-manager-post-list">
        {groupedPosts.map((group) => (
          <section className="archive-draft-card" key={group.id}>
            <div className="archive-draft-header">
              <div>
                <strong>{group.post?.date || group.photos[0]?.date || "날짜 없음"}</strong>
                {group.post?.content && <div className="archive-draft-path photo-manager-content">{group.post.content}</div>}
              </div>
              <label className="photo-manager-post-select">
                <input type="checkbox" checked={group.photos.every((photo) => selectedIds.includes(photo.id))} onChange={() => togglePost(group)} />
                이 게시물 {group.photos.length}장 전체 선택
              </label>
            </div>
            <div className="archive-import-media-list">
              {group.photos.map((photo, index) => (
                <div className="archive-import-media" key={photo.id}>
                  <button
                    type="button"
                    className="archive-import-media-preview photo-preview-button"
                    onClick={() => setLargePreview({
                      src: photo.image_url || photo.thumbnail_url,
                      name: `${group.post?.date || photo.date || ""} 사진 ${index + 1}`,
                    })}
                    aria-label={`${index + 1}번 사진 크게 보기`}
                  >
                    <img src={photo.thumbnail_url || photo.image_url} alt="" />
                    <span>크게 보기</span>
                  </button>
                  <div className="archive-import-media-info">
                    <strong>{index + 1}. 사진</strong>
                    <span>{photo.date || ""}</span>
                    <label className="photo-manager-photo-select"><input type="checkbox" checked={selectedIds.includes(photo.id)} onChange={() => togglePhoto(photo.id)} />선택</label>
                    <select value={photo.type || ""} onChange={(e) => updatePhoto(photo.id, "type", e.target.value)}>
                      <option value="">사진 유형</option>{PHOTO_TYPES.map((type) => <option value={type} key={type}>{type}</option>)}
                    </select>
                    <select value={photo.hair_color || ""} onChange={(e) => updatePhoto(photo.id, "hair_color", e.target.value)}>
                      <option value="">머리색 선택</option>{HAIR_COLORS.map((color) => <option value={color} key={color}>{color}</option>)}
                    </select>
                    <label className="archive-visible-toggle import-visible-toggle">
                      <input type="checkbox" checked={photo.archive_visible !== false} onChange={(e) => updatePhoto(photo.id, "archive_visible", e.target.checked)} />사진 아카이브에 표시
                    </label>
                    <TagPicker value={photo.tagsText} onChange={(value) => updatePhoto(photo.id, "tagsText", value)} />
                    <small>검색용 태그는 태그 관리에서 일괄 수정됩니다.</small>
                    <input type="url" placeholder="위버스 링크" value={photo.weverse_url || ""} onChange={(e) => updatePhoto(photo.id, "weverse_url", e.target.value)} />
                    <button type="button" onClick={() => savePhoto(photo)} disabled={savingIds.includes(photo.id)}>{savingIds.includes(photo.id) ? "저장 중..." : "이 사진 설정 저장"}</button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      {largePreview && (
        <div
          className="photo-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={largePreview.name}
          onMouseDown={() => setLargePreview(null)}
        >
          <button
            type="button"
            className="photo-lightbox-close"
            aria-label="큰 사진 닫기"
            onClick={() => setLargePreview(null)}
          >
            ×
          </button>
          <img
            src={largePreview.src}
            alt={largePreview.name}
            onMouseDown={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </main>
  );
}

export default PhotoManager;
