import { useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import "./Admin.css";
import "./PhotoLightbox.css";

function Admin() {
  const [largePreview, setLargePreview] = useState(null);
  const previewPointerStart = useRef(null);
  // =========================
  // 로그아웃
  // =========================

  async function handleLogout() {
    await supabase.auth.signOut();
    window.location.href = "/";
  }

  // =========================
  // 위버스 게시물 정보
  // =========================

  const [postDate, setPostDate] = useState("");
  const [postTime, setPostTime] = useState("");
  const [postAuthor, setPostAuthor] = useState("");
  const [postContent, setPostContent] = useState("");
  const [postWeverseUrl, setPostWeverseUrl] = useState("");

  // =========================
  // 사진 목록
  // =========================

  const [photos, setPhotos] = useState([]);

  // =========================
// 동영상 목록
// =========================

const [videos, setVideos] = useState([]);

// =========================
// 게시물 미디어 순서
// =========================

const [mediaOrder, setMediaOrder] = useState([]);

  // =========================
  // 일괄 적용
  // =========================

  const [bulkDate, setBulkDate] = useState("");
  const [bulkType, setBulkType] = useState("");
  const [bulkHairColor, setBulkHairColor] = useState("");
  const [bulkTags, setBulkTags] = useState("");
  const [bulkSearchTags, setBulkSearchTags] = useState("");
  const [bulkWeverseUrl, setBulkWeverseUrl] = useState("");

  const [bulkTarget, setBulkTarget] = useState("all");

  // =========================
  // 업로드 상태
  // =========================

  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");

  // =========================
  // 사진 범위 선택
  // =========================

  const [selectionStart, setSelectionStart] = useState(null);
  const [isSelecting, setIsSelecting] = useState(false);

  // =========================
  // 파일 추가
  // =========================

  function handleFiles(files) {
  const selectedFiles = Array.from(files).filter(
    (file) =>
      file.type.startsWith("image/") ||
      file.type.startsWith("video/")
  );

  if (selectedFiles.length === 0) {
    setMessage(
      "사진 또는 동영상 파일을 선택해주세요."
    );
    return;
  }

  const newPhotos = [];
  const newVideos = [];
  const newMediaOrder = [];

  selectedFiles.forEach((file) => {
    const id = crypto.randomUUID();

    // =========================
    // 사진
    // =========================

    if (file.type.startsWith("image/")) {
      const photo = {
        id,
        file,

        date: postDate || "",

        type: "셀카",
        hairColor: "",
        tags: "",
        searchTags: "",

        weverseUrl:
          postWeverseUrl || "",

        selected: false,

        cropX: 50,
        cropY: 50,

        dragging: false,
        dragStartX: 0,
        dragStartY: 0,
        startCropX: 50,
        startCropY: 50,

        previewUrl:
          URL.createObjectURL(file),
      };

      newPhotos.push(photo);

      newMediaOrder.push({
        id,
        kind: "photo",
      });
    }

    // =========================
    // 동영상
    // =========================

    if (file.type.startsWith("video/")) {
      const video = {
        id,
        file,

        previewUrl:
          URL.createObjectURL(file),

        cropX: 50,
        cropY: 50,

        tags: "",
        searchTags: "",
      };

      newVideos.push(video);

      newMediaOrder.push({
        id,
        kind: "video",
      });
    }
  });

  setPhotos((prev) => [
    ...prev,
    ...newPhotos,
  ]);

  setVideos((prev) => [
    ...prev,
    ...newVideos,
  ]);

  setMediaOrder((prev) => [
    ...prev,
    ...newMediaOrder,
  ]);

  setMessage("");
}

  // =========================
  // 파일 input
  // =========================

  function handleFileChange(e) {
    if (e.target.files) {
      handleFiles(e.target.files);
    }

    // 같은 파일 다시 선택 가능
    e.target.value = "";
  }

  // =========================
  // 드래그 앤 드롭
  // =========================

  function handleDrop(e) {
    e.preventDefault();

    if (e.dataTransfer.files) {
      handleFiles(e.dataTransfer.files);
    }
  }

  function handleDragOver(e) {
    e.preventDefault();
  }

  // =========================
  // 사진 정보 변경
  // =========================

  function updatePhoto(id, field, value) {
    setPhotos((prev) =>
      prev.map((photo) =>
        photo.id === id
          ? {
              ...photo,
              [field]: value,
            }
          : photo
      )
    );
  }

  // =========================
  // 동영상 정보 변경
  // =========================

  function updateVideo(id, field, value) {
    setVideos((prev) =>
      prev.map((video) =>
        video.id === id
          ? {
              ...video,
              [field]: value,
            }
          : video
      )
    );
  }

  // =========================
  // 사진 삭제
  // =========================

  function removePhoto(id) {
  setPhotos((prev) => {
    const target = prev.find(
      (photo) => photo.id === id
    );

    if (target?.previewUrl) {
      URL.revokeObjectURL(
        target.previewUrl
      );
    }

    return prev.filter(
      (photo) => photo.id !== id
    );
  });

  // ★ 미디어 순서에서도 같이 삭제
  setMediaOrder((prev) =>
    prev.filter(
      (item) => item.id !== id
    )
  );
}

function removeVideo(id) {
  setVideos((prev) => {
    const target = prev.find(
      (video) => video.id === id
    );

    if (target?.previewUrl) {
      URL.revokeObjectURL(
        target.previewUrl
      );
    }

    return prev.filter(
      (video) => video.id !== id
    );
  });

  // ★ 미디어 순서에서도 같이 삭제
  setMediaOrder((prev) =>
    prev.filter(
      (item) => item.id !== id
    )
  );
}

  // =========================
  // 태그 문자열 → 배열
  // =========================

  function convertTags(value) {
    return value
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag !== "");
  }

  // =========================
  // 게시물 날짜를 사진에도 적용
  // =========================

  function applyPostDateToPhotos() {
    if (!postDate) {
      setMessage("게시 날짜를 먼저 입력해주세요.");
      return;
    }

    setPhotos((prev) =>
      prev.map((photo) => ({
        ...photo,
        date: postDate,
      }))
    );

    setMessage("게시 날짜를 모든 사진에 적용했습니다.");
  }

  // =========================
  // 게시물 링크를 사진에도 적용
  // =========================

  function applyPostUrlToPhotos() {
    if (!postWeverseUrl) {
      setMessage("위버스 링크를 먼저 입력해주세요.");
      return;
    }

    setPhotos((prev) =>
      prev.map((photo) => ({
        ...photo,
        weverseUrl: postWeverseUrl,
      }))
    );

    setMessage("게시물 링크를 모든 사진에 적용했습니다.");
  }

  // =========================
  // 일괄 적용
  // =========================

  function applyBulk() {
    setPhotos((prev) =>
      prev.map((photo) => {
        if (
          bulkTarget === "selected" &&
          !photo.selected
        ) {
          return photo;
        }

        return {
          ...photo,

          ...(bulkDate && {
            date: bulkDate,
          }),

          ...(bulkType && {
            type: bulkType,
          }),

          ...(bulkHairColor && {
            hairColor: bulkHairColor,
          }),

          ...(bulkTags && {
            tags: bulkTags,
          }),

          ...(bulkSearchTags && {
            searchTags: bulkSearchTags,
          }),

          ...(bulkWeverseUrl && {
            weverseUrl: bulkWeverseUrl,
          }),
        };
      })
    );

    setMessage("일괄 적용되었습니다.");
  }

  // =========================
  // 전체 선택
  // =========================

  function selectAllPhotos() {
    setPhotos((prev) =>
      prev.map((photo) => ({
        ...photo,
        selected: true,
      }))
    );
  }

  function deselectAllPhotos() {
    setPhotos((prev) =>
      prev.map((photo) => ({
        ...photo,
        selected: false,
      }))
    );
  }

  function togglePhotoSelect(id) {
    setPhotos((prev) =>
      prev.map((photo) =>
        photo.id === id
          ? {
              ...photo,
              selected: !photo.selected,
            }
          : photo
      )
    );
  }

  // =========================
  // 사진 범위 선택
  // =========================

  function startPhotoSelection(e, index) {
    if (
      e.target.closest("button") ||
      e.target.closest("input") ||
      e.target.closest("select") ||
      e.target.closest(".crop-preview")
    ) {
      return;
    }

    e.preventDefault();

    setSelectionStart(index);
    setIsSelecting(true);

    setPhotos((prev) =>
      prev.map((photo, i) => ({
        ...photo,
        selected: i === index,
      }))
    );
  }

  function movePhotoSelection(e, index) {
    if (
      !isSelecting ||
      selectionStart === null
    ) {
      return;
    }

    const start = Math.min(
      selectionStart,
      index
    );

    const end = Math.max(
      selectionStart,
      index
    );

    setPhotos((prev) =>
      prev.map((photo, i) => ({
        ...photo,
        selected:
          i >= start &&
          i <= end,
      }))
    );
  }

  function endPhotoSelection() {
    setIsSelecting(false);
    setSelectionStart(null);
  }

  // =========================
  // 크롭 드래그 시작
  // =========================

  function startCropDrag(e, photo) {
    e.preventDefault();

    setPhotos((prev) =>
      prev.map((item) =>
        item.id === photo.id
          ? {
              ...item,
              dragging: true,
              dragStartX: e.clientX,
              dragStartY: e.clientY,
              startCropX: item.cropX,
              startCropY: item.cropY,
            }
          : item
      )
    );
  }

  // =========================
  // 크롭 이동
  // =========================

  function moveCrop(e, photo) {
    if (!photo.dragging) return;

    const deltaX =
      e.clientX - photo.dragStartX;

    const deltaY =
      e.clientY - photo.dragStartY;

    const sensitivity = 1.5;

    let newX =
      photo.startCropX -
      deltaX / sensitivity;

    let newY =
      photo.startCropY -
      deltaY / sensitivity;

    newX = Math.max(
      0,
      Math.min(100, newX)
    );

    newY = Math.max(
      0,
      Math.min(100, newY)
    );

    setPhotos((prev) =>
      prev.map((item) =>
        item.id === photo.id
          ? {
              ...item,
              cropX: newX,
              cropY: newY,
            }
          : item
      )
    );
  }

  // =========================
  // 크롭 드래그 종료
  // =========================

  function endCropDrag(id) {
    setPhotos((prev) =>
      prev.map((photo) =>
        photo.id === id
          ? {
              ...photo,
              dragging: false,
            }
          : photo
      )
    );
  }

  // =========================
  // 업로드
  // =========================

  async function handleUpload(e) {
    e.preventDefault();

    // 게시물 자체의 날짜는 필수
    if (!postDate) {
      setMessage("게시 날짜를 입력해주세요.");
      return;
    }

    // 사진이 있다면 사진 날짜도 확인
    if (photos.length > 0) {
      const missingDate = photos.find(
        (photo) => !photo.date
      );

      if (missingDate) {
        setMessage(
          "모든 사진의 날짜를 입력해주세요."
        );
        return;
      }
    }

    setUploading(true);
    setMessage("");

    let createdPostId = null;

    try {
      // =========================
      // 1. 위버스 게시물 생성
      // =========================

      let postedAt = null;

      if (postDate && postTime) {
        postedAt =
          `${postDate}T${postTime}:00`;
      }

      const {
        data: postData,
        error: postError,
      } = await supabase
        .from("weverse_posts")
        .insert({
          date: postDate,

          posted_at:
            postedAt,

          content:
            postContent.trim() || null,

          weverse_url:
            postWeverseUrl.trim() || null,

          author:
            postAuthor.trim() || null,
        })
        .select("id")
        .single();

      if (postError) {
        throw postError;
      }

      createdPostId = postData.id;


// =========================
// 실제로 존재하는 미디어만 남기기
// =========================

const validMediaOrder =
  mediaOrder.filter((media) => {

    if (media.kind === "photo") {
      return photos.some(
        (photo) =>
          photo.id === media.id
      );
    }

    if (media.kind === "video") {
      return videos.some(
        (video) =>
          video.id === media.id
      );
    }

    return false;
  });

// 2. 사진 + 동영상 업로드
// =========================

// 기존 사진 아카이브 정렬용
const uploadBase = Date.now();

for (
  let orderIndex = 0;
  orderIndex < validMediaOrder.length;
  orderIndex++
) {
  const media = validMediaOrder[orderIndex];

  // 게시글 내부에서의 실제 순서
  const currentMediaOrder =
    orderIndex + 1;

  // =========================
  // 사진
  // =========================

  if (media.kind === "photo") {
    const photo = photos.find(
      (item) => item.id === media.id
    );

    if (!photo) continue;

    const file = photo.file;

    const fileExt =
      file.name
        .split(".")
        .pop()
        ?.toLowerCase() || "jpg";

    const fileName =
      `${Date.now()}-${crypto.randomUUID()}.${fileExt}`;

    // Storage
    const {
      error: uploadError,
    } = await supabase.storage
      .from("photos")
      .upload(
        fileName,
        file
      );

    if (uploadError) {
      throw uploadError;
    }

    // 공개 URL
    const {
      data: urlData,
    } = supabase.storage
      .from("photos")
      .getPublicUrl(
        fileName
      );

    const imageUrl =
      urlData.publicUrl;

    const tagArray =
      convertTags(photo.tags);

    const searchTagArray =
      convertTags(
        photo.searchTags
      );

    // photos 테이블
    const {
      error: dbError,
    } = await supabase
      .from("photos")
      .insert({
        image_url:
          imageUrl,

        date:
          photo.date,

        type:
          photo.type,

        hair_color:
          photo.hairColor,

        tags:
          tagArray,

        search_tags:
          searchTagArray,

        weverse_url:
          photo.weverseUrl.trim() ||
          postWeverseUrl.trim() ||
          null,

        crop_position:
          `${photo.cropX}% ${photo.cropY}%`,

        upload_order:
          uploadBase + orderIndex,

        post_id:
          createdPostId,

        media_order:
          currentMediaOrder,
      });

    if (dbError) {
      throw dbError;
    }
  }


  // =========================
  // 동영상
  // =========================

  if (media.kind === "video") {
    const video = videos.find(
      (item) => item.id === media.id
    );

    if (!video) continue;

    const file = video.file;

    const fileExt =
      file.name
        .split(".")
        .pop()
        ?.toLowerCase() || "mp4";

    const fileName =
      `${Date.now()}-${crypto.randomUUID()}.${fileExt}`;

    // =========================
    // 동영상 Storage 업로드
    // =========================

    const {
      error: videoUploadError,
    } = await supabase.storage
      .from("videos")
      .upload(
        fileName,
        file
      );

    if (videoUploadError) {
      throw videoUploadError;
    }

    // =========================
    // 동영상 공개 URL
    // =========================

    const {
      data: videoUrlData,
    } = supabase.storage
      .from("videos")
      .getPublicUrl(
        fileName
      );

    const videoUrl =
      videoUrlData.publicUrl;

    const videoTagArray =
      convertTags(video.tags);

    const videoSearchTagArray =
      convertTags(video.searchTags);

    // =========================
    // videos 테이블
    // =========================

    const {
      error: videoDbError,
    } = await supabase
      .from("videos")
      .insert({
        post_id:
          createdPostId,

        video_url:
          videoUrl,

        thumbnail_url:
          null,

        crop_position:
          `${video.cropX}% ${video.cropY}%`,

        tags:
          videoTagArray,

        search_tags:
          videoSearchTagArray,

        media_order:
          currentMediaOrder,
      });

    if (videoDbError) {
      throw videoDbError;
    }
  }
}
      // =========================
      // 성공
      // =========================

      if (
        photos.length > 0 ||
        videos.length > 0
      ) {
        setMessage(
          `게시물과 사진 ${photos.length}장, 동영상 ${videos.length}개가 등록되었습니다!`
        );
      } else {
        setMessage(
          "위버스 게시물이 등록되었습니다!"
        );
      }

      photos.forEach((photo) => {
        if (photo.previewUrl) {
          URL.revokeObjectURL(
            photo.previewUrl
          );
        }
      });
      videos.forEach((video) => {
        if (video.previewUrl) {
          URL.revokeObjectURL(
            video.previewUrl
          );
        }
      });

      setPhotos([]);
      setVideos([]);
      setMediaOrder([]);

      setPostDate("");
      setPostTime("");
      setPostAuthor("");
      setPostContent("");
      setPostWeverseUrl("");

      setTimeout(() => {
        window.location.href =
          "/admin";
      }, 700);

    } catch (error) {
      console.error(
        "업로드 오류:",
        error
      );

      setMessage(
        `업로드 실패: ${
          error.message ||
          "알 수 없는 오류"
        }`
      );
    } finally {
      setUploading(false);
    }
  }

  // =========================
  // 선택된 사진 수
  // =========================

  const selectedCount =
    photos.filter(
      (photo) => photo.selected
    ).length;

  return (
    <div
      className="admin-page"
      onMouseUp={endPhotoSelection}
    >
      <div className="admin-box">

        {/* =========================
            헤더
        ========================= */}

        <header className="admin-header">
          <div>
            <span className="admin-small">
              WEVERSE ARCHIVE
            </span>

            <h1>
              게시물 추가
            </h1>
          </div>

          <div className="admin-header-buttons">

  <button
    type="button"
    className="back-button"
    onClick={() => {
      window.location.href =
        "/admin/import";
    }}
  >
    백업 폴더 가져오기
  </button>

  <button
    type="button"
    className="back-button"
    onClick={() => {
      window.location.href =
        "/admin";
    }}
  >
    ADMIN HOME
  </button>

  <button
    type="button"
    className="logout-button"
    onClick={handleLogout}
  >
    로그아웃
  </button>

</div>
        </header>

        {/* =========================
            위버스 게시물 정보
        ========================= */}

        <section className="post-info-section">

          <div className="post-info-header">
            <div>
              <div className="section-title">
                위버스 게시물
              </div>

              <div className="section-help">
                원본 위버스 게시물의 정보를 입력합니다.
              </div>
            </div>
          </div>

          <div className="post-info-grid">

            <div className="post-field">
              <label>
                게시 날짜 *
              </label>

              <input
                type="date"
                value={postDate}
                onChange={(e) =>
                  setPostDate(
                    e.target.value
                  )
                }
              />
            </div>

            <div className="post-field">
              <label>
                게시 시간
              </label>

              <input
                type="time"
                value={postTime}
                onChange={(e) =>
                  setPostTime(
                    e.target.value
                  )
                }
              />
            </div>

            <div className="post-field">
              <label>
                작성자
              </label>

              <input
                type="text"
                placeholder="작성자"
                value={postAuthor}
                onChange={(e) =>
                  setPostAuthor(
                    e.target.value
                  )
                }
              />
            </div>

            <div className="post-field">
              <label>
                위버스 링크
              </label>

              <input
                type="url"
                placeholder="https://weverse.io/..."
                value={postWeverseUrl}
                onChange={(e) =>
                  setPostWeverseUrl(
                    e.target.value
                  )
                }
              />
            </div>

          </div>

          <div className="post-content-field">
            <label>
              게시글 본문
            </label>

            <textarea
              placeholder="위버스 게시글 내용을 입력해주세요."
              value={postContent}
              onChange={(e) =>
                setPostContent(
                  e.target.value
                )
              }
            />
          </div>

          {photos.length > 0 && (
            <div className="post-quick-actions">

              <button
                type="button"
                onClick={
                  applyPostDateToPhotos
                }
              >
                게시 날짜 → 모든 사진
              </button>

              <button
                type="button"
                onClick={
                  applyPostUrlToPhotos
                }
              >
                게시물 링크 → 모든 사진
              </button>

            </div>
          )}

        </section>

        {/* =========================
            사진 추가
        ========================= */}

        <section className="file-add-section">

          <label
            className="drop-zone"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
          >
            <div className="drop-icon">
              ＋
            </div>

            <div className="drop-title">
              사진이나 동영상을 여기에 드래그하거나 클릭해서 추가
            </div>

            <div className="drop-help">
              같은 위버스 게시물의 사진을 여러 장 추가할 수 있습니다.
            </div>

            <input
              type="file"
              accept="image/*,video/*"
              multiple
              onChange={handleFileChange}
            />
          </label>

        </section>

        {/* =========================
            일괄 적용
        ========================= */}

        {photos.length > 0 && (

          <section className="bulk-section">

            <div className="bulk-header">

              <div>
                <div className="section-title">
                  일괄 적용
                </div>

                <div className="section-help">
                  입력한 항목만 덮어씌워집니다.
                </div>
              </div>

              <div className="bulk-selection">

                <button
                  type="button"
                  onClick={selectAllPhotos}
                >
                  전체 선택
                </button>

                <button
                  type="button"
                  onClick={deselectAllPhotos}
                >
                  선택 해제
                </button>

                <span>
                  {selectedCount}장 선택
                </span>

              </div>

            </div>

            <div className="bulk-grid">

              <input
                type="date"
                value={bulkDate}
                onChange={(e) =>
                  setBulkDate(
                    e.target.value
                  )
                }
              />

              <select
                value={bulkType}
                onChange={(e) =>
                  setBulkType(
                    e.target.value
                  )
                }
              >
                <option value="">
                  유형 유지
                </option>

                <option value="셀카">
                  셀카
                </option>

                <option value="남찍사">
                  남찍사
                </option>

                <option value="거울셀카">
                  거울셀카
                </option>

                <option value="그외">
                  그외
                </option>
              </select>

              <input
                type="text"
                placeholder="머리색"
                value={bulkHairColor}
                onChange={(e) =>
                  setBulkHairColor(
                    e.target.value
                  )
                }
              />

              <input
                type="text"
                placeholder="태그"
                value={bulkTags}
                onChange={(e) =>
                  setBulkTags(
                    e.target.value
                  )
                }
              />

              <input
                type="text"
                placeholder="검색용 태그"
                value={bulkSearchTags}
                onChange={(e) =>
                  setBulkSearchTags(
                    e.target.value
                  )
                }
              />

              <input
                type="url"
                placeholder="위버스 링크"
                value={bulkWeverseUrl}
                onChange={(e) =>
                  setBulkWeverseUrl(
                    e.target.value
                  )
                }
              />

            </div>

            <div className="bulk-bottom">

              <select
                value={bulkTarget}
                onChange={(e) =>
                  setBulkTarget(
                    e.target.value
                  )
                }
              >
                <option value="all">
                  모든 사진에 적용
                </option>

                <option value="selected">
                  선택한 사진에만 적용
                </option>
              </select>

              <button
                type="button"
                className="bulk-apply-button"
                onClick={applyBulk}
              >
                일괄 적용
              </button>

            </div>

          </section>

        )}

        {videos.length > 0 && (
  <section className="photo-settings-section">

    <div className="photo-settings-header">
      <div>
        <div className="section-title">
          동영상
        </div>

        <div className="section-help">
          이 게시물에 포함될 동영상입니다.
        </div>
      </div>

      <div className="photo-count">
        총 {videos.length}개
      </div>
    </div>

    <div className="photo-settings-grid">

      {videos.map((video) => (
        <div
          className="photo-card"
          key={video.id}
        >

          <div className="photo-card-header">

            <span>
              VIDEO
            </span>

            <button
              type="button"
              className="remove-photo"
              onClick={() =>
                removeVideo(video.id)
              }
            >
              ×
            </button>

          </div>

          <div className="crop-preview">

            <video
              src={video.previewUrl}
              controls
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
              }}
            />

          </div>

          <div
            className="photo-file-name"
            title={video.file.name}
          >
            {video.file.name}
          </div>

          <div className="photo-form-grid">

            <div className="mini-field">
              <label>태그</label>
              <input
                type="text"
                placeholder="쉼표로 구분"
                value={video.tags}
                onChange={(e) =>
                  updateVideo(
                    video.id,
                    "tags",
                    e.target.value
                  )
                }
              />
            </div>

            <div className="mini-field">
              <label>검색용 태그</label>
              <input
                type="text"
                placeholder="쉼표로 구분"
                value={video.searchTags}
                onChange={(e) =>
                  updateVideo(
                    video.id,
                    "searchTags",
                    e.target.value
                  )
                }
              />
            </div>

          </div>

        </div>
      ))}

    </div>

  </section>
)}

        {/* =========================
            사진별 설정
        ========================= */}

        {photos.length > 0 && (

          <section className="photo-settings-section">

            <div className="photo-settings-header">

              <div>
                <div className="section-title">
                  사진별 설정
                </div>

                <div className="section-help">
                  사진을 드래그해서 미리보기 위치를 조절할 수 있습니다.
                </div>
              </div>

              <div className="photo-count">
                총 {photos.length}장
              </div>

            </div>

            <div className="photo-settings-grid">

              {photos.map(
                (photo, index) => (

                  <div
                    className={`photo-card ${
                      photo.selected
                        ? "selected"
                        : ""
                    } ${
                      isSelecting
                        ? "is-selecting"
                        : ""
                    }`}
                    key={photo.id}
                    onMouseDown={(e) =>
                      startPhotoSelection(
                        e,
                        index
                      )
                    }
                    onMouseEnter={(e) =>
                      movePhotoSelection(
                        e,
                        index
                      )
                    }
                    onMouseUp={
                      endPhotoSelection
                    }
                  >

                    {/* 카드 헤더 */}

                    <div className="photo-card-header">

                      <label className="photo-check">

                        <input
                          type="checkbox"
                          checked={
                            !!photo.selected
                          }
                          onChange={() =>
                            togglePhotoSelect(
                              photo.id
                            )
                          }
                        />

                        <span>
                          {index + 1}
                        </span>

                      </label>

                      <button
                        type="button"
                        className="remove-photo"
                        onClick={() =>
                          removePhoto(
                            photo.id
                          )
                        }
                      >
                        ×
                      </button>

                    </div>

                    {/* 미리보기 */}

                    <div
                      className={`crop-preview ${
                        photo.dragging
                          ? "dragging"
                          : ""
                      }`}
                      onMouseDown={(e) => {
                        previewPointerStart.current = {
                          x: e.clientX,
                          y: e.clientY,
                        };
                        startCropDrag(e, photo);
                      }}
                      onMouseMove={(e) =>
                        moveCrop(
                          e,
                          photo
                        )
                      }
                      onMouseUp={() =>
                        endCropDrag(
                          photo.id
                        )
                      }
                      onMouseLeave={() =>
                        endCropDrag(
                          photo.id
                        )
                      }
                      onClick={(e) => {
                        const start = previewPointerStart.current;
                        previewPointerStart.current = null;
                        if (
                          start &&
                          Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5
                        ) {
                          return;
                        }
                        setLargePreview({
                          src: photo.previewUrl,
                          name: photo.file?.name || "사진 미리보기",
                        });
                      }}
                    >

                      <img
                        src={
                          photo.previewUrl
                        }
                        alt=""
                        draggable="false"
                        style={{
                          objectPosition:
                            `${photo.cropX}% ${photo.cropY}%`,
                        }}
                      />

                      <div className="crop-help">
                        클릭해서 크게 보기 · 드래그해서 위치 조절
                      </div>

                    </div>

                    {/* 파일명 */}

                    <div
                      className="photo-file-name"
                      title={
                        photo.file.name
                      }
                    >
                      {photo.file.name}
                    </div>

                    {/* 사진 정보 */}

                    <div className="photo-form-grid">

                      <div className="mini-field">

                        <label>
                          날짜
                        </label>

                        <input
                          type="date"
                          value={
                            photo.date
                          }
                          onChange={(e) =>
                            updatePhoto(
                              photo.id,
                              "date",
                              e.target.value
                            )
                          }
                        />

                      </div>

                      <div className="mini-field">

                        <label>
                          유형
                        </label>

                        <select
                          value={
                            photo.type
                          }
                          onChange={(e) =>
                            updatePhoto(
                              photo.id,
                              "type",
                              e.target.value
                            )
                          }
                        >
                          <option value="셀카">
                            셀카
                          </option>

                          <option value="남찍사">
                            남찍사
                          </option>

                          <option value="거울셀카">
                            거울셀카
                          </option>

                          <option value="그외">
                            그외
                          </option>
                        </select>

                      </div>

                      <div className="mini-field">

                        <label>
                          머리색
                        </label>

                        <input
                          type="text"
                          placeholder="예: 흑발"
                          value={
                            photo.hairColor
                          }
                          onChange={(e) =>
                            updatePhoto(
                              photo.id,
                              "hairColor",
                              e.target.value
                            )
                          }
                        />

                      </div>

                      <div className="mini-field">

                        <label>
                          태그
                        </label>

                        <input
                          type="text"
                          placeholder="공항, 모자"
                          value={
                            photo.tags
                          }
                          onChange={(e) =>
                            updatePhoto(
                              photo.id,
                              "tags",
                              e.target.value
                            )
                          }
                        />

                      </div>

                      <div className="mini-field">

                        <label>
                          검색용 태그
                        </label>

                        <input
                          type="text"
                          placeholder="오알럽, 모자"
                          value={
                            photo.searchTags
                          }
                          onChange={(e) =>
                            updatePhoto(
                              photo.id,
                              "searchTags",
                              e.target.value
                            )
                          }
                        />

                      </div>

                      <div className="mini-field">

                        <label>
                          위버스 링크
                        </label>

                        <input
                          type="url"
                          placeholder="https://..."
                          value={
                            photo.weverseUrl
                          }
                          onChange={(e) =>
                            updatePhoto(
                              photo.id,
                              "weverseUrl",
                              e.target.value
                            )
                          }
                        />

                      </div>

                    </div>

                  </div>

                )
              )}

            </div>

          </section>

        )}

        {/* 메시지 */}

        {message && (
          <div className="upload-message">
            {message}
          </div>
        )}

      </div>

      {/* =========================
          고정 업로드 바
      ========================= */}

      <form
        id="post-upload-form"
        onSubmit={handleUpload}
      />

      <div className="fixed-upload-bar">

        <div className="fixed-upload-info">

          {photos.length > 0 || videos.length > 0
            ? `게시물 + 사진 ${photos.length}장 + 동영상 ${videos.length}개`
            : "게시물만 등록"}

        </div>

        <button
          type="submit"
          form="post-upload-form"
          className="upload-button"
          disabled={uploading}
        >
          {uploading
          ? "등록 중..."
          : photos.length > 0 || videos.length > 0
          ? `게시물 + 사진 ${photos.length}장 + 동영상 ${videos.length}개 등록`
          : "게시물 등록"}
        </button>

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

    </div>
  );
}

export default Admin;
