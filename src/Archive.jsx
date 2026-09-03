import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import ArchiveLayout from "./ArchiveLayout";
import ArchiveFilters from "./ArchiveFilters";
import "./App.css";
import TagPicker from "./TagPicker";

function Archive({ isAdmin = false }) {
  const [photoType, setPhotoType] = useState("전체");
  const [hairColorFilter, setHairColorFilter] = useState("전체");
  const [search, setSearch] = useState("");
  const [photos, setPhotos] = useState([]);

  const [sortOrder, setSortOrder] = useState("최신순");
  const [videoType, setVideoType] = useState("전체");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [tagAliases, setTagAliases] = useState([]);
  const photoModalOpen = selectedPhoto !== null;

  useEffect(() => {
    if (!photoModalOpen) return undefined;

    const scrollY = window.scrollY;
    const previous = {
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
    };

    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";

    return () => {
      document.body.style.overflow = previous.overflow;
      document.body.style.position = previous.position;
      document.body.style.top = previous.top;
      document.body.style.width = previous.width;
      window.scrollTo(0, scrollY);
    };
  }, [photoModalOpen]);

  const [selectedPost, setSelectedPost] = useState(null);
  const [postPhotos, setPostPhotos] = useState([]);
  const [loadingPost, setLoadingPost] = useState(false);

  // =========================
  // 수정 모드
  // =========================

  const [editMode, setEditMode] = useState(false);

  const [editDate, setEditDate] = useState("");
  const [editType, setEditType] = useState("");
  const [editHairColor, setEditHairColor] = useState("");
  const [editTags, setEditTags] = useState("");
  const [editSearchTags, setEditSearchTags] = useState("");
  const [editWeverseUrl, setEditWeverseUrl] = useState("");
  const [editArchiveVisible, setEditArchiveVisible] = useState(true);

  // 크롭 위치
  const [cropPosition, setCropPosition] = useState("50% 50%");

  const [saving, setSaving] = useState(false);

  // =========================
  // 크롭 드래그
  // =========================

  const cropEditorRef = useRef(null);

  const [isDraggingCrop, setIsDraggingCrop] = useState(false);

  const cropDragStart = useRef({
    x: 0,
    y: 0,
    positionX: 50,
    positionY: 50,
  });

  // =========================
  // 사진 불러오기
  // =========================

  useEffect(() => {
    getPhotos();
    getTagAliases();
    // =========================
// 사진과 연결된 게시글 불러오기
// =========================

async function getPhotoPost(photo) {
  console.log("클릭한 사진:", photo);
  console.log("사진의 post_id:", photo?.post_id);

  if (!photo?.post_id) {
    setSelectedPost(null);
    setPostPhotos([]);
    return;
  }

  // 이하 기존 코드 그대로

  setLoadingPost(true);

  try {
    // 게시글 정보
    const {
      data: postData,
      error: postError,
    } = await supabase
      .from("weverse_posts")
      .select("*")
      .eq("id", photo.post_id)
      .single();

    if (postError) {
      throw postError;
    }

    // 같은 게시글에 연결된 사진들
    const {
      data: relatedPhotos,
      error: photosError,
    } = await supabase
      .from("photos")
      .select("*")
      .eq("post_id", photo.post_id)
      .order("upload_order", {
        ascending: true,
      });

    if (photosError) {
      throw photosError;
    }

    setSelectedPost(postData);
    setPostPhotos(relatedPhotos || []);
  } catch (error) {
    console.error(
      "게시글 정보를 불러오지 못했습니다:",
      error
    );

    setSelectedPost(null);
    setPostPhotos([]);
  } finally {
    setLoadingPost(false);
  }
}
  }, []);

  async function getPhotos() {
    const pageSize = 1000;
    const allPhotos = [];

    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from("photos")
        .select("*")
        .order("date", { ascending: false })
        .order("created_at", { ascending: true })
        .range(from, from + pageSize - 1);

      if (error) {
        console.error("사진을 불러오지 못했습니다:", error);
        return;
      }

      allPhotos.push(...(data || []));

      if (!data || data.length < pageSize) {
        break;
      }
    }

    setPhotos(allPhotos);
  }

  // =========================
  // 검색용 태그 불러오기
  // =========================

  async function getTagAliases() {
    const { data, error } = await supabase
      .from("tag_aliases")
      .select("tag, alias");

    if (error) {
      console.error(
        "검색용 태그를 불러오지 못했습니다:",
        error
      );

      // alias 검색이 안 되더라도
      // 실제 태그 / 검색용 태그 검색은 계속 가능
      setTagAliases([]);
      return;
    }

    setTagAliases(data || []);
  }

  // =========================
// 사진과 연결된 게시글 불러오기
// =========================

async function getPhotoPost(photo) {
  console.log("클릭한 사진:", photo);
  console.log("사진의 post_id:", photo?.post_id);

  if (!photo?.post_id) {
    setSelectedPost(null);
    setPostPhotos([]);
    return;
  }

  setLoadingPost(true);

  try {
    // 게시글 불러오기
    const {
      data: postData,
      error: postError,
    } = await supabase
      .from("weverse_posts")
      .select("*")
      .eq("id", photo.post_id)
      .single();

    if (postError) {
      throw postError;
    }

    // 같은 게시글의 사진들 불러오기
    const {
      data: relatedPhotos,
      error: photosError,
    } = await supabase
      .from("photos")
      .select("*")
      .eq("post_id", photo.post_id)
      .order("upload_order", {
        ascending: true,
      });

    if (photosError) {
      throw photosError;
    }

    console.log("연결된 게시글:", postData);
    console.log("같은 게시글 사진:", relatedPhotos);

    setSelectedPost(postData);
    setPostPhotos(relatedPhotos || []);
  } catch (error) {
    console.error(
      "게시글 정보를 불러오지 못했습니다:",
      error
    );

    setSelectedPost(null);
    setPostPhotos([]);
  } finally {
    setLoadingPost(false);
  }
}

  // =========================
  // crop_position 파싱
  // =========================

  function parseCropPosition(position) {
    if (!position) {
      return {
        x: 50,
        y: 50,
      };
    }

    const parts = String(position)
      .trim()
      .split(/\s+/);

    const x = parseFloat(parts[0]);
    const y = parseFloat(parts[1]);

    return {
      x: Number.isFinite(x) ? x : 50,
      y: Number.isFinite(y) ? y : 50,
    };
  }

  // =========================
  // 사진 삭제
  // =========================

  async function handleDeletePhoto(photo) {
    const confirmed = window.confirm(
      "이 사진을 정말 삭제할까요?"
    );

    if (!confirmed) return;

    try {
      // =========================
      // Storage 파일 경로
      // =========================

      const url = new URL(photo.image_url);

      const marker =
        "/storage/v1/object/public/photos/";

      const markerIndex =
        url.pathname.indexOf(marker);

      let path = null;

      if (markerIndex !== -1) {
        path = decodeURIComponent(
          url.pathname.substring(
            markerIndex + marker.length
          )
        );
      }

      // =========================
      // DB 삭제
      // =========================

      const { error: dbError } =
        await supabase
          .from("photos")
          .delete()
          .eq("id", photo.id);

      if (dbError) {
        throw dbError;
      }

      // =========================
      // Storage 삭제
      // =========================

      if (path) {
        const { error: storageError } =
          await supabase.storage
            .from("photos")
            .remove([path]);

        if (storageError) {
          console.error(
            "Storage 삭제 오류:",
            storageError
          );
        }
      }

      // =========================
      // 화면 업데이트
      // =========================

      setPhotos((prev) =>
        prev.filter(
          (item) => item.id !== photo.id
        )
      );

      setSelectedPhoto(null);

      alert("삭제되었습니다.");
    } catch (error) {
      console.error(
        "삭제 오류:",
        error
      );

      alert(
        `삭제 중 오류가 발생했습니다.\n${error.message}`
      );
    }
  }

  // =========================
  // 수정 모드 열기
  // =========================

  function openEditMode(photo) {
    setEditDate(photo.date || "");
    setEditType(photo.type || "");
    setEditHairColor(
      photo.hair_color || ""
    );

    setEditTags(
      Array.isArray(photo.tags)
        ? photo.tags.join(", ")
        : ""
    );

    setEditSearchTags(
      Array.isArray(photo.search_tags)
        ? photo.search_tags.join(", ")
        : ""
    );

    setEditWeverseUrl(
      photo.weverse_url || ""
    );

    setEditArchiveVisible(
      photo.archive_visible !== false
    );

    // 기존 크롭 위치 가져오기
    setCropPosition(
      photo.crop_position || "50% 50%"
    );

    setEditMode(true);
  }

  // =========================
  // 수정 취소
  // =========================

  function cancelEdit() {
    setEditMode(false);

    // 원래 사진의 위치로 되돌림
    if (selectedPhoto) {
      setCropPosition(
        selectedPhoto.crop_position ||
          "50% 50%"
      );
    }
  }

  // =========================
  // 크롭 드래그 시작
  // =========================

  function handleCropPointerDown(e) {
    if (!cropEditorRef.current) {
      return;
    }

    e.preventDefault();

    const { x, y } =
      parseCropPosition(cropPosition);

    cropDragStart.current = {
      x: e.clientX,
      y: e.clientY,
      positionX: x,
      positionY: y,
    };

    setIsDraggingCrop(true);

    // 드래그 중에도 포인터를 계속 잡음
    try {
      e.currentTarget.setPointerCapture(
        e.pointerId
      );
    } catch {
      // 브라우저가 지원하지 않아도 무시
    }
  }

  // =========================
  // 크롭 드래그
  // =========================

  function handleCropPointerMove(e) {
    if (!isDraggingCrop) return;

    const editor =
      cropEditorRef.current;

    if (!editor) return;

    const rect =
      editor.getBoundingClientRect();

    /*
      드래그 거리 → object-position 변화

      사진을 위로 움직이면
      position Y가 작아지고,

      사진을 아래로 움직이면
      position Y가 커짐.
    */

    const deltaX =
      e.clientX -
      cropDragStart.current.x;

    const deltaY =
      e.clientY -
      cropDragStart.current.y;

    /*
      숫자가 너무 민감하지 않도록
      프레임 크기에 비례해서 계산
    */

    const sensitivityX =
      100 / rect.width;

    const sensitivityY =
      100 / rect.height;

    let newX =
      cropDragStart.current.positionX -
      deltaX * sensitivityX;

    let newY =
      cropDragStart.current.positionY -
      deltaY * sensitivityY;

    /*
      object-position이 너무 끝까지
      가지 않도록 제한
    */

    newX = Math.max(
      0,
      Math.min(100, newX)
    );

    newY = Math.max(
      0,
      Math.min(100, newY)
    );

    setCropPosition(
      `${newX}% ${newY}%`
    );
  }

  // =========================
  // 크롭 드래그 종료
  // =========================

  function handleCropPointerUp() {
    setIsDraggingCrop(false);
  }

  // =========================
  // 사진 수정 저장
  // =========================

  async function handleUpdatePhoto() {
    if (!selectedPhoto) return;

    setSaving(true);

    try {
      // =========================
      // 태그 배열
      // =========================

      const tagArray =
        editTags
          .split(",")
          .map((tag) =>
            tag.trim()
          )
          .filter(
            (tag) => tag !== ""
          );

      // =========================
      // 검색용 태그 배열
      // =========================

      const searchTagArray =
        editSearchTags
          .split(",")
          .map((tag) =>
            tag.trim()
          )
          .filter(
            (tag) => tag !== ""
          );

      // =========================
      // DB 업데이트
      // =========================

      const {
        data,
        error,
      } = await supabase
        .from("photos")
        .update({
          date: editDate,
          type: editType,
          hair_color: editHairColor,
          tags: tagArray,
          search_tags: searchTagArray,
          weverse_url: editWeverseUrl,
          archive_visible: editArchiveVisible,

          // ★ 크롭 위치 저장
          crop_position: cropPosition,
        })
        .eq(
          "id",
          selectedPhoto.id
        )
        .select()
        .single();

      if (error) {
        throw error;
      }

      // =========================
      // 사진 목록 업데이트
      // =========================

      setPhotos((prev) =>
        prev.map((photo) =>
          photo.id === selectedPhoto.id
            ? data
            : photo
        )
      );

      // =========================
      // 현재 모달 사진 업데이트
      // =========================

      setSelectedPhoto(data);

      setCropPosition(
        data.crop_position ||
          "50% 50%"
      );

      setEditMode(false);

      alert("수정되었습니다.");
    } catch (error) {
      console.error(
        "수정 오류:",
        error
      );

      alert(
        `수정 중 오류가 발생했습니다.\n${error.message}`
      );
    } finally {
      setSaving(false);
    }
  }

  

  // =========================
  // 사진 다운로드
  // =========================

  async function downloadPhoto(photo) {
    try {
      const response = await fetch(photo.image_url);

      if (!response.ok) {
        throw new Error("사진 파일을 불러오지 못했습니다.");
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const extension =
        blob.type?.split("/")[1]?.split("+")[0] || "jpg";

      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `riwoo_${photo.date || "photo"}_${photo.id}.${extension}`;

      document.body.appendChild(link);
      link.click();
      link.remove();

      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      console.error("사진 다운로드 오류:", error);
      alert("사진을 다운로드하지 못했습니다.");
    }
  }

  // =========================
  // 검색 / 필터
  // =========================

const hairColorAliases = {
  흑발: ["검머", "검은머리", "검정머리", "블랙", "톤다운"],
  갈발: ["갈머", "갈색머리", "브라운", "염색"],
  금발: ["금머", "노란머리", "블론드", "탈색"],
  적발: ["빨간머리", "염색"],
  은발: ["백발", "실버", "하얀머리", "탈색"],
  핑머: ["핑크머리", "분홍머리", "염색"],
  주머: ["주황머리", "오렌지머리", "염색"],
  와인색: ["와인머리", "버건디", "버건디머리", "염색"],
};

  const postSortKeys = new Map();

  photos.forEach((photo) => {
    const postKey = photo.post_id || `photo-${photo.id}`;
    const current = postSortKeys.get(postKey);
    const uploadOrder = Number(photo.upload_order ?? 0);
    const createdTime = new Date(photo.created_at || 0).getTime();

    if (!current) {
      postSortKeys.set(postKey, { uploadOrder, createdTime });
      return;
    }

    current.uploadOrder = Math.min(current.uploadOrder, uploadOrder);
    current.createdTime = Math.min(current.createdTime, createdTime);
  });

  const filteredPhotos =
    photos
      .filter((photo) => {
        if (!isAdmin && photo.archive_visible === false) {
          return false;
        }

        const keyword =
          search
            .trim()
            .toLowerCase();

        // =========================
        // 사진 유형
        // =========================

        const matchesType =
          photoType === "전체" ||
          photo.type === photoType;

        const matchesHairColorFilter =
          hairColorFilter === "전체" ||
          photo.hair_color === hairColorFilter;

        // =========================
        // 시작 날짜
        // =========================

        const matchesStartDate =
          !startDate ||
          photo.date >= startDate;

        // =========================
        // 종료 날짜
        // =========================

        const matchesEndDate =
          !endDate ||
          photo.date <= endDate;

        // =========================
        // 검색어 없음
        // =========================

        if (!keyword) {
          return (
            matchesType &&
            matchesHairColorFilter &&
            matchesStartDate &&
            matchesEndDate
          );
        }

        // =========================
        // 검색어 정리
        // =========================

        const normalize = (
          value
        ) => {
          return String(
            value || ""
          )
            .toLowerCase()
            .replace(
              /\s+/g,
              ""
            )
            .trim();
        };

        const normalizedKeyword =
          normalize(keyword);

        // =========================
        // 날짜
        // =========================

        const formattedDate =
          photo.date
            ?.replaceAll(
              "-",
              "."
            )
            .toLowerCase();

        // =========================
        // alias 연결
        // =========================

        const matchedAliasTags =
          tagAliases
            .filter((item) => {
              const alias =
                normalize(
                  item.alias
                );

              return (
                alias &&
                alias.includes(
                  normalizedKeyword
                )
              );
            })
            .map((item) =>
              normalize(
                item.tag
              )
            );

        // =========================
        // 실제 태그
        // =========================

        const photoTags =
          Array.isArray(
            photo.tags
          )
            ? photo.tags
            : [];

        // =========================
        // 검색용 태그
        // =========================

        const photoSearchTags =
          Array.isArray(
            photo.search_tags
          )
            ? photo.search_tags
            : [];

        // =========================
        // 실제 태그 검색
        // =========================

        const matchesRealTag =
          photoTags.some(
            (tag) =>
              normalize(
                tag
              ).includes(
                normalizedKeyword
              )
          );

        // =========================
        // 검색용 태그 직접 검색
        // =========================

        const matchesSearchTag =
          photoSearchTags.some(
            (tag) =>
              normalize(
                tag
              ).includes(
                normalizedKeyword
              )
          );

        // =========================
        // alias → 실제 태그
        // =========================

        const matchesAlias =
          photoTags.some(
            (tag) => {
              const normalizedTag =
                normalize(
                  tag
                );

              return matchedAliasTags.some(
                (aliasTag) =>
                  normalizedTag ===
                  aliasTag
              );
            }
          );

        // =========================
        // 유형
        // =========================

        const matchesPhotoType =
          normalize(
            photo.type
          ).includes(
            normalizedKeyword
          );

        // =========================
        // 머리색
        // =========================

        const hairColor =
          photo.hair_color || "";

        const hairAliases =
         hairColorAliases[hairColor] || [];

        const matchesHairColor =
          normalize(hairColor).includes(
            normalizedKeyword
          ) ||
          hairAliases.some((alias) =>
            normalize(alias).includes(
              normalizedKeyword
            )
          );

        // =========================
        // 날짜
        // =========================

        const matchesDate =
          normalize(
            photo.date
          ).includes(
            normalizedKeyword
          );

        const matchesFormattedDate =
          normalize(
            formattedDate
          ).includes(
            normalizedKeyword
          );

        // =========================
        // 최종 검색
        // =========================

        const matchesSearch =
          matchesRealTag ||
          matchesSearchTag ||
          matchesAlias ||
          matchesPhotoType ||
          matchesHairColor ||
          matchesDate ||
          matchesFormattedDate;

        return (
          matchesType &&
          matchesHairColorFilter &&
          matchesStartDate &&
          matchesEndDate &&
          matchesSearch
        );
      })
      .sort((a, b) => {
        const aPostKey = a.post_id || `photo-${a.id}`;
        const bPostKey = b.post_id || `photo-${b.id}`;

        // 같은 게시글의 사진은 정렬 방향과 관계없이 원본 순서를 유지한다.
        if (aPostKey === bPostKey) {
          return (
            Number(a.media_order ?? a.upload_order ?? 0) -
            Number(b.media_order ?? b.upload_order ?? 0)
          );
        }

        const aDate = new Date(a.date || 0).getTime();
        const bDate = new Date(b.date || 0).getTime();
        const dateDiff =
          sortOrder === "최신순"
            ? bDate - aDate
            : aDate - bDate;

        if (dateDiff !== 0) return dateDiff;

        const aKey = postSortKeys.get(aPostKey) || {};
        const bKey = postSortKeys.get(bPostKey) || {};
        const orderDiff =
          sortOrder === "최신순"
            ? (bKey.uploadOrder ?? 0) - (aKey.uploadOrder ?? 0)
            : (aKey.uploadOrder ?? 0) - (bKey.uploadOrder ?? 0);

        if (orderDiff !== 0) return orderDiff;

        const createdDiff =
          sortOrder === "최신순"
            ? (bKey.createdTime ?? 0) - (aKey.createdTime ?? 0)
            : (aKey.createdTime ?? 0) - (bKey.createdTime ?? 0);

        if (createdDiff !== 0) return createdDiff;
        return String(aPostKey).localeCompare(String(bPostKey));
      });

  // =========================
  // 화면
  // =========================

  return (
    <>
      <ArchiveLayout
        isAdmin={isAdmin}
        activeTab="photos"
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="사진이나 키워드를 검색해보세요"
      >
        {/* 필터 */}

        <ArchiveFilters
          type={photoType}
          setType={setPhotoType}
          sortOrder={sortOrder}
          setSortOrder={setSortOrder}
          startDate={startDate}
          setStartDate={setStartDate}
          endDate={endDate}
          setEndDate={setEndDate}
          typeLabel="사진 유형"
          secondaryValue={hairColorFilter}
          setSecondaryValue={setHairColorFilter}
          secondaryLabel="머리색"
          secondaryOptions={["흑발", "갈발", "금발", "적발", "은발", "핑머", "주머", "와인색"]}
          allActive={
            photoType === "전체" &&
            hairColorFilter === "전체" &&
            search.trim() === ""
          }
          onAllClick={() => {
            setPhotoType("전체");
            setHairColorFilter("전체");
            setSearch("");
          }}
        />

        {/* =========================
                사진
            ========================= */}

        <div className="photo-grid">
          {filteredPhotos.map((photo) => (
            <div
              className="photo-item"
              key={photo.id}
              onClick={() => {
                setSelectedPhoto(photo);
                setEditMode(false);
              }}
            >
              <div className="photo">
                <img
                  src={photo.thumbnail_url || photo.image_url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  style={{
                    objectPosition: photo.crop_position || "50% 50%",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </ArchiveLayout>

      {/* =========================
          사진 상세 모달
      ========================= */}

      {selectedPhoto && (
        <div className="photo-modal" onClick={() => setSelectedPhoto(null)}>
          <div
            className={`photo-modal-content ${editMode ? "is-editing" : ""}`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 닫기 */}

            <button
              className="modal-close"
              onClick={() => setSelectedPhoto(null)}
            >
              ×
            </button>

            {/* 큰 사진 */}

            <div className="modal-image">
              {/* 블러 배경 */}
              <img
                className="modal-image-background"
                src={selectedPhoto.image_url}
                alt=""
              />

              {/* 실제 사진 */}
              <img
                className="modal-image-main"
                src={selectedPhoto.image_url}
                alt=""
              />
            </div>

            {/* 정보 */}

            <div className="modal-info">
              {!editMode ? (
                <>
                  <div className="modal-date">{selectedPhoto.date}</div>

                  <div className="modal-meta">
                    {selectedPhoto.type}

                    {selectedPhoto.hair_color && (
                      <>
                        <span>{" · "}</span>

                        {selectedPhoto.hair_color}
                      </>
                    )}
                  </div>

                  {/* 태그 */}

                  {selectedPhoto.tags?.length > 0 && (
                    <div className="modal-tags">
                      {selectedPhoto.tags.map((tag, index) => (
                        <button
                          type="button"
                          key={index}
                          className="modal-tag-button"
                          onClick={() => {
                            setSearch(tag);
                            setPhotoType("전체");
                            setSelectedPhoto(null);
                          }}
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  )}

                  {!isAdmin && (
                    <button
                      type="button"
                      className="media-download-button"
                      onClick={() => downloadPhoto(selectedPhoto)}
                    >
                      다운로드 ↓
                    </button>
                  )}

                  {/* 위버스 */}

                  {selectedPhoto.weverse_url && (
                    <a
                      className="weverse-link"
                      href={selectedPhoto.weverse_url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      위버스에서 보기 ↗
                    </a>
                  )}

                  {/* 관리자 버튼 */}

                  {isAdmin && (
                    <div className="admin-photo-actions">
                      <button
                        type="button"
                        onClick={() => openEditMode(selectedPhoto)}
                      >
                        수정
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDeletePhoto(selectedPhoto)}
                      >
                        삭제
                      </button>
                    </div>
                  )}
                </>
              ) : (
                /* =========================
                   수정 화면
                ========================= */

                <div className="edit-form">
                  <div className="edit-title">사진 정보 수정</div>

                  {/* =========================
                      크롭 미리보기
                  ========================= */}

                  <div className="edit-crop-section">
                    <div className="edit-crop-title">미리보기 위치</div>

                    <div
                      ref={cropEditorRef}
                      className={`crop-editor ${
                        isDraggingCrop ? "dragging" : ""
                      }`}
                      onPointerDown={handleCropPointerDown}
                      onPointerMove={handleCropPointerMove}
                      onPointerUp={handleCropPointerUp}
                      onPointerCancel={handleCropPointerUp}
                      onPointerLeave={handleCropPointerUp}
                    >
                      <img
                        src={selectedPhoto.image_url}
                        alt=""
                        draggable={false}
                        style={{
                          objectPosition: cropPosition,
                        }}
                      />
                    </div>

                    <div className="crop-editor-help">
                      사진을 마우스로 잡고 움직여서 원하는 위치로 맞춰주세요.
                    </div>
                  </div>

                  {/* 날짜 */}

                  <label>날짜</label>

                  <input
                    type="date"
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                  />

                  {/* 유형 */}

                  <label>유형</label>

                  <select
                    value={editType}
                    onChange={(e) => setEditType(e.target.value)}
                  >
                    <option value="셀카">셀카</option>

                    <option value="남찍사">남찍사</option>

                    <option value="거울셀카">거울셀카</option>

                    <option value="그외">그외</option>
                  </select>

                  <label className="archive-visible-toggle">
                    <input
                      type="checkbox"
                      checked={editArchiveVisible}
                      onChange={(e) => setEditArchiveVisible(e.target.checked)}
                    />
                    사진 아카이브에 표시
                  </label>

                  {/* 머리색 */}

                  <label>머리색</label>

                  <select
                    value={editHairColor}
                    onChange={(e) => setEditHairColor(e.target.value)}
                  >
                    <option value="">머리색 선택</option>

                    <option value="흑발">흑발</option>

                    <option value="갈발">갈발</option>

                    <option value="금발">금발</option>

                    <option value="적발">적발</option>

                    <option value="은발">은발</option>

                    <option value="핑머">핑머</option>
                    <option value="주머">주머</option>
                    <option value="와인색">와인색</option>
                  </select>

                  {/* 태그 */}

                  <label>태그</label>

                  <TagPicker value={editTags} onChange={setEditTags} />

                  {/* 검색용 태그 */}

                  <div className="input-help">
                    검색용 태그는 관리자 태그 사전에서 한 번만 관리합니다.
                  </div>

                  {/* 위버스 */}

                  <label>위버스 링크</label>

                  <input
                    type="url"
                    value={editWeverseUrl}
                    onChange={(e) => setEditWeverseUrl(e.target.value)}
                  />

                  {/* 수정 버튼 */}

                  <div className="edit-actions">
                    <button
                      type="button"
                      onClick={cancelEdit}
                      disabled={saving}
                    >
                      취소
                    </button>

                    <button
                      type="button"
                      onClick={handleUpdatePhoto}
                      disabled={saving}
                    >
                      {saving ? "저장 중..." : "저장"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default Archive;
