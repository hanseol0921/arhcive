import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import "./App.css";

function Posts({ isAdmin = false }) {
  const [posts, setPosts] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [videos, setVideos] = useState([]);

  const [loading, setLoading] = useState(true);

  // =========================
  // 선택한 게시글
  // =========================

  const [selectedPost, setSelectedPost] = useState(null);

  // =========================
  // 게시글 수정
  // =========================

  const [editPostMode, setEditPostMode] = useState(false);

  const [editPostDate, setEditPostDate] = useState("");
  const [editPostTime, setEditPostTime] = useState("");
  const [editPostAuthor, setEditPostAuthor] = useState("");
  const [editPostContent, setEditPostContent] = useState("");
  const [editPostWeverseUrl, setEditPostWeverseUrl] = useState("");

  const [postSaving, setPostSaving] = useState(false);
  const [editMedia, setEditMedia] = useState([]);
  const [selectedPostIds, setSelectedPostIds] = useState([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // =========================
  // 데이터 불러오기
  // =========================

  useEffect(() => {
    loadPosts();
  }, []);

  async function loadPosts() {
    setLoading(true);

    try {
      // 게시글
      const {
  data: postData,
  error: postError,
} = await supabase
  .from("weverse_posts")
  .select("*")
  // 1순위: 게시 날짜
  .order("date", {
    ascending: false,
    nullsFirst: false,
  })

  // 같은 날짜 안에서는 실제 게시 시간
  .order("posted_at", {
    ascending: false,
    nullsFirst: false,
  })

  // 날짜/시간까지 같을 때만 최종 보조
  .order("created_at", {
    ascending: false,
  });

      if (postError) {
        throw postError;
      }

      // 사진
      const {
        data: photoData,
        error: photoError,
      } = await supabase
        .from("photos")
        .select("*")
        .not("post_id", "is", null);

      if (photoError) {
        throw photoError;
      }

      // 동영상
      const {
        data: videoData,
        error: videoError,
      } = await supabase
        .from("videos")
        .select("*")
        .not("post_id", "is", null);

      if (videoError) {
        throw videoError;
      }

      setPosts(postData || []);
      setPhotos(photoData || []);
      setVideos(videoData || []);
    } catch (error) {
      console.error(
        "게시글 불러오기 오류:",
        error
      );
    } finally {
      setLoading(false);
    }
  }

  // =========================
  // 게시글 미디어 합치기
  // =========================

  function getPostMedia(postId) {
    const postPhotos = photos
      .filter(
        (photo) =>
          String(photo.post_id) ===
          String(postId)
      )
      .map((photo) => ({
        ...photo,
        mediaKind: "photo",
      }));

    const postVideos = videos
      .filter(
        (video) =>
          String(video.post_id) ===
          String(postId)
      )
      .map((video) => ({
        ...video,
        mediaKind: "video",
      }));

    return [
      ...postPhotos,
      ...postVideos,
    ].sort((a, b) => {
      const orderA =
        a.media_order ?? 999999;

      const orderB =
        b.media_order ?? 999999;

      return orderA - orderB;
    });
  }

  // =========================
  // 날짜 표시
  // =========================

  function formatDate(date) {
    if (!date) return "";

    return date.replaceAll("-", ".");
  }

  // =========================
  // 시간 표시
  // =========================

  function formatTime(postedAt) {
    if (!postedAt) return "";

    const date =
      new Date(postedAt);

    return date.toLocaleTimeString(
      "ko-KR",
      {
        hour: "2-digit",
        minute: "2-digit",
      }
    );
  }

  // =========================
  // 상세 모달 닫기
  // =========================

  function closePostModal() {
    setSelectedPost(null);
    setEditPostMode(false);
  }

  // =========================
  // 게시글 수정 열기
  // =========================

  function openPostEdit(post) {
    setEditPostDate(
      post.date || ""
    );

    if (post.posted_at) {
      const date =
        new Date(post.posted_at);

      const hours = String(
        date.getHours()
      ).padStart(2, "0");

      const minutes = String(
        date.getMinutes()
      ).padStart(2, "0");

      setEditPostTime(
        `${hours}:${minutes}`
      );
    } else {
      setEditPostTime("");
    }

    setEditPostAuthor(
      post.author || ""
    );

    setEditPostContent(
      post.content || ""
    );

    setEditPostWeverseUrl(
      post.weverse_url || ""
    );

    const media = getPostMedia(post.id);

    setEditMedia(
  media.map((item) => {
    const crop =
      item.crop_position ||
      "50% 50%";

    const parts =
      crop.split(" ");

    const cropX =
      parseFloat(parts[0]) ||
      50;

    const cropY =
      parseFloat(parts[1]) ||
      50;

    return {
      ...item,

      tags:
        Array.isArray(item.tags)
          ? [...item.tags]
          : [],

      search_tags:
        Array.isArray(
          item.search_tags
        )
          ? [...item.search_tags]
          : [],

      cropX,
      cropY,

      cropDragging: false,

      deletePending: false,
    };
  })
);

function moveEditMedia(
  index,
  direction
) {
  setEditMedia((prev) => {
    const newMedia = [...prev];

    const targetIndex =
      index + direction;

    if (
      targetIndex < 0 ||
      targetIndex >=
        newMedia.length
    ) {
      return prev;
    }

    const temp =
      newMedia[index];

    newMedia[index] =
      newMedia[targetIndex];

    newMedia[targetIndex] =
      temp;

    return newMedia;
  });
}

    setEditPostMode(true);
  }

  // =========================
  // 게시글 수정 취소
  // =========================

  function cancelPostEdit() {
    setEditPostMode(false);
  }

  function updateEditMedia(
  id,
  mediaKind,
  field,
  value
) {
  setEditMedia((prev) =>
    prev.map((item) =>
      String(item.id) === String(id) &&
      item.mediaKind === mediaKind
        ? {
            ...item,
            [field]: value,
          }
        : item
    )
  );
}

function toggleDeleteMedia(
  id,
  mediaKind
) {
  setEditMedia((prev) =>
    prev.map((item) =>
      String(item.id) === String(id) &&
      item.mediaKind === mediaKind
        ? {
            ...item,
            deletePending:
              !item.deletePending,
          }
        : item
    )
  );
}

function handleEditCropStart(
  e,
  id,
  mediaKind
) {
  const item = editMedia.find(
    (media) =>
      String(media.id) === String(id) &&
      media.mediaKind === mediaKind
  );

  if (!item || item.deletePending) {
    return;
  }

  e.currentTarget.setPointerCapture(
    e.pointerId
  );

  setEditMedia((prev) =>
    prev.map((media) =>
      String(media.id) === String(id) &&
      media.mediaKind === mediaKind
        ? {
            ...media,
            cropDragging: true,
            cropStartX: e.clientX,
            cropStartY: e.clientY,
            cropOriginalX:
              media.cropX ?? 50,
            cropOriginalY:
              media.cropY ?? 50,
          }
        : media
    )
  );
}


function handleEditCropMove(
  e,
  id,
  mediaKind
) {
  const item = editMedia.find(
    (media) =>
      String(media.id) === String(id) &&
      media.mediaKind === mediaKind
  );

  if (
    !item ||
    !item.cropDragging
  ) {
    return;
  }

  const rect =
    e.currentTarget.getBoundingClientRect();

  const dx =
    e.clientX -
    item.cropStartX;

  const dy =
    e.clientY -
    item.cropStartY;

  const moveX =
    (dx / rect.width) * 100;

  const moveY =
    (dy / rect.height) * 100;

  // 이미지를 오른쪽으로 끌면
  // object-position은 반대로 움직임
  let newX =
    item.cropOriginalX -
    moveX;

  let newY =
    item.cropOriginalY -
    moveY;

  newX = Math.max(
    0,
    Math.min(100, newX)
  );

  newY = Math.max(
    0,
    Math.min(100, newY)
  );

  setEditMedia((prev) =>
    prev.map((media) =>
      String(media.id) === String(id) &&
      media.mediaKind === mediaKind
        ? {
            ...media,
            cropX: newX,
            cropY: newY,
            crop_position:
              `${newX}% ${newY}%`,
          }
        : media
    )
  );
}


function handleEditCropEnd(
  e,
  id,
  mediaKind
) {
  try {
    e.currentTarget.releasePointerCapture(
      e.pointerId
    );
  } catch {
    // 이미 해제된 경우 무시
  }

  setEditMedia((prev) =>
    prev.map((media) =>
      String(media.id) === String(id) &&
      media.mediaKind === mediaKind
        ? {
            ...media,
            cropDragging: false,
          }
        : media
    )
  );
}

  // =========================
  // 게시글 수정 저장
  // =========================

  async function handleUpdatePost() {
  if (!selectedPost) return;

  if (!editPostDate) {
    alert("게시 날짜를 입력해주세요.");
    return;
  }

  setPostSaving(true);

  try {

    // =========================
    // 게시글 시간
    // =========================

    let postedAt = null;

    if (
      editPostDate &&
      editPostTime
    ) {
      postedAt =
        `${editPostDate}T${editPostTime}:00`;
    }

    // =========================
    // 1. 게시글 수정
    // =========================

    const {
      data: updatedPost,
      error: postError,
    } = await supabase
      .from("weverse_posts")
      .update({
        date: editPostDate,

        posted_at:
          postedAt,

        author:
          editPostAuthor || null,

        content:
          editPostContent.trim() ||
          null,

        weverse_url:
          editPostWeverseUrl.trim() ||
          null,
      })
      .eq(
        "id",
        selectedPost.id
      )
      .select()
      .single();

    if (postError) {
      throw postError;
    }

    // =========================
    // Storage 경로 추출
    // =========================

    function getStoragePath(
      publicUrl,
      bucketName
    ) {
      if (!publicUrl) {
        return null;
      }

      try {
        const url =
          new URL(publicUrl);

        const marker =
          `/storage/v1/object/public/${bucketName}/`;

        const index =
          url.pathname.indexOf(
            marker
          );

        if (index === -1) {
          return null;
        }

        return decodeURIComponent(
          url.pathname.substring(
            index + marker.length
          )
        );
      } catch {
        return null;
      }
    }

    // =========================
    // 2. 미디어 수정/삭제
    // =========================

    for (
  let index = 0;
  index < editMedia.length;
  index++
) {
  const item =
    editMedia[index];

  const newMediaOrder =
    index + 1;

      // -------------------------
      // 삭제 예정
      // -------------------------

      if (item.deletePending) {

        if (
          item.mediaKind ===
          "photo"
        ) {
          const path =
            getStoragePath(
              item.image_url,
              "photos"
            );

          if (path) {
            const {
              error:
                storageError,
            } =
              await supabase.storage
                .from("photos")
                .remove([path]);

            if (storageError) {
              throw storageError;
            }
          }

          const {
            error: deleteError,
          } = await supabase
            .from("photos")
            .delete()
            .eq("id", item.id);

          if (deleteError) {
            throw deleteError;
          }

        } else {

          const path =
            getStoragePath(
              item.video_url,
              "videos"
            );

          if (path) {
            const {
              error:
                storageError,
            } =
              await supabase.storage
                .from("videos")
                .remove([path]);

            if (storageError) {
              throw storageError;
            }
          }

          const {
            error: deleteError,
          } = await supabase
            .from("videos")
            .delete()
            .eq("id", item.id);

          if (deleteError) {
            throw deleteError;
          }
        }

        continue;
      }

      // -------------------------
      // 사진 정보 수정
      // -------------------------

      if (
        item.mediaKind ===
        "photo"
      ) {
        const {
          error: photoError,
        } = await supabase
          .from("photos")
          .update({
            type:
              item.type || null,

            hair_color:
              item.hair_color ||
              null,

            archive_visible:
              item.archive_visible !== false,

            tags:
              item.tags || [],

            search_tags:
              item.search_tags ||
              [],

            weverse_url:
              item.weverse_url ||
              null,

            crop_position:
              item.crop_position ||
              "50% 50%",
            media_order:
              newMediaOrder,
          })
          .eq(
            "id",
            item.id
          );

        if (photoError) {
          throw photoError;
        }
      }

      if (
  item.mediaKind ===
  "video"
) {
  const {
    error: videoError,
  } = await supabase
    .from("videos")
    .update({
      type: item.type || null,

      crop_position:
        `${item.cropX ?? 50}% ${item.cropY ?? 50}%`,

      media_order:
        newMediaOrder,
    })
    .eq(
      "id",
      item.id
    );

  if (videoError) {
    throw videoError;
  }
}
    }

    // =========================
    // 3. 화면 데이터 다시 불러오기
    // =========================

    const {
      data: newPhotos,
      error: photoLoadError,
    } = await supabase
      .from("photos")
      .select("*")
      .not(
        "post_id",
        "is",
        null
      );

    if (photoLoadError) {
      throw photoLoadError;
    }

    const {
      data: newVideos,
      error: videoLoadError,
    } = await supabase
      .from("videos")
      .select("*")
      .not(
        "post_id",
        "is",
        null
      );

    if (videoLoadError) {
      throw videoLoadError;
    }

    setPhotos(
      newPhotos || []
    );

    setVideos(
      newVideos || []
    );

    setPosts((prev) =>
      prev.map((post) =>
        String(post.id) ===
        String(updatedPost.id)
          ? updatedPost
          : post
      )
    );

    setSelectedPost(
      updatedPost
    );

    setEditPostMode(false);

    alert(
      "게시글과 미디어 정보가 수정되었습니다."
    );

  } catch (error) {

    console.error(
      "게시글 수정 오류:",
      error
    );

    alert(
      `수정 중 오류가 발생했습니다.\n${error.message}`
    );

  } finally {

    setPostSaving(false);

  }
}

  // =========================
  // 게시글 삭제
  // 연결된 사진 + 동영상 + Storage까지 삭제
  // =========================

  async function handleDeletePost(
    post,
    { skipConfirm = false, silent = false } = {}
  ) {
    const confirmed =
      skipConfirm ||
      window.confirm(
        "이 게시글을 삭제할까요?\n\n연결된 사진과 동영상도 모두 삭제됩니다."
      );

    if (!confirmed) return false;

    try {
      // 연결된 사진
      const postPhotos =
        photos.filter(
          (photo) =>
            String(photo.post_id) ===
            String(post.id)
        );

      // 연결된 동영상
      const postVideos =
        videos.filter(
          (video) =>
            String(video.post_id) ===
            String(post.id)
        );

      // =========================
      // Storage 경로 추출
      // =========================

      function getStoragePath(
        publicUrl,
        bucketName
      ) {
        if (!publicUrl) {
          return null;
        }

        try {
          const url =
            new URL(publicUrl);

          const marker =
            `/storage/v1/object/public/${bucketName}/`;

          const index =
            url.pathname.indexOf(
              marker
            );

          if (index === -1) {
            return null;
          }

          return decodeURIComponent(
            url.pathname.substring(
              index +
                marker.length
            )
          );
        } catch {
          return null;
        }
      }

      // 사진 Storage 경로
      const photoPaths =
        postPhotos
          .map((photo) =>
            getStoragePath(
              photo.image_url,
              "photos"
            )
          )
          .filter(Boolean);

      // 동영상 Storage 경로
      const videoPaths =
        postVideos
          .map((video) =>
            getStoragePath(
              video.video_url,
              "videos"
            )
          )
          .filter(Boolean);

      // =========================
      // 사진 Storage 삭제
      // =========================

      if (
        photoPaths.length > 0
      ) {
        const {
          error:
            photoStorageError,
        } =
          await supabase.storage
            .from("photos")
            .remove(
              photoPaths
            );

        if (
          photoStorageError
        ) {
          throw photoStorageError;
        }
      }

      // =========================
      // 동영상 Storage 삭제
      // =========================

      if (
        videoPaths.length > 0
      ) {
        const {
          error:
            videoStorageError,
        } =
          await supabase.storage
            .from("videos")
            .remove(
              videoPaths
            );

        if (
          videoStorageError
        ) {
          throw videoStorageError;
        }
      }

      // =========================
      // photos DB 삭제
      // =========================

      const {
        error: photoDbError,
      } = await supabase
        .from("photos")
        .delete()
        .eq(
          "post_id",
          post.id
        );

      if (photoDbError) {
        throw photoDbError;
      }

      // =========================
      // videos DB 삭제
      // =========================

      const {
        error: videoDbError,
      } = await supabase
        .from("videos")
        .delete()
        .eq(
          "post_id",
          post.id
        );

      if (videoDbError) {
        throw videoDbError;
      }

      // =========================
      // 게시글 DB 삭제
      // =========================

      const {
        error: postError,
      } = await supabase
        .from(
          "weverse_posts"
        )
        .delete()
        .eq(
          "id",
          post.id
        );

      if (postError) {
        throw postError;
      }

      // =========================
      // 화면에서도 제거
      // =========================

      setPosts((prev) =>
        prev.filter(
          (item) =>
            String(item.id) !==
            String(post.id)
        )
      );

      setPhotos((prev) =>
        prev.filter(
          (photo) =>
            String(
              photo.post_id
            ) !==
            String(post.id)
        )
      );

      setVideos((prev) =>
        prev.filter(
          (video) =>
            String(
              video.post_id
            ) !==
            String(post.id)
        )
      );

      if (
        selectedPost &&
        String(selectedPost.id) === String(post.id)
      ) {
        closePostModal();
      }

      if (!silent) {
        alert(
          `게시글이 삭제되었습니다.\n사진 ${postPhotos.length}장 / 동영상 ${postVideos.length}개 삭제`
        );
      }

      return true;
    } catch (error) {
      console.error(
        "게시글 삭제 오류:",
        error
      );

      if (!silent) {
        alert(
          `삭제 중 오류가 발생했습니다.\n${error.message}`
        );
      }

      return false;
    }
  }

  function togglePostSelection(postId) {
    setSelectedPostIds((prev) =>
      prev.includes(postId)
        ? prev.filter((id) => id !== postId)
        : [...prev, postId]
    );
  }

  function toggleSelectAllPosts() {
    if (selectedPostIds.length === posts.length) {
      setSelectedPostIds([]);
      return;
    }

    setSelectedPostIds(posts.map((post) => post.id));
  }

  async function handleBulkDeletePosts() {
    if (selectedPostIds.length === 0) {
      return;
    }

    const confirmed = window.confirm(
      `선택한 게시글 ${selectedPostIds.length}개를 삭제할까요?\n\n연결된 사진과 동영상도 모두 삭제됩니다.`
    );

    if (!confirmed) return;

    setBulkDeleting(true);

    let deletedCount = 0;

    try {
      const targets = posts.filter((post) =>
        selectedPostIds.includes(post.id)
      );

      for (const post of targets) {
        const deleted = await handleDeletePost(post, {
          skipConfirm: true,
          silent: true,
        });

        if (deleted) {
          deletedCount++;
        }
      }

      setSelectedPostIds([]);

      alert(`${deletedCount}개 게시글을 삭제했습니다.`);
    } finally {
      setBulkDeleting(false);
    }
  }

  // =========================
  // 선택 게시글 미디어
  // =========================

  const selectedMedia =
    selectedPost
      ? getPostMedia(
          selectedPost.id
        )
      : [];

  // =========================
  // 화면
  // =========================

  return (
    <div className="page">
      <div className="archive">

        {/* =========================
            상단
        ========================= */}

        <header className="top">
          <div className="logo">
            RIWOO

            <span>
              POST ARCHIVE
            </span>
          </div>
        </header>

        {/* =========================
            파란 프레임
        ========================= */}

        <div className="blue-frame">

          {/* =========================
              프로필
          ========================= */}

          <aside className="profile">

            <div className="profile-image">
              PROFILE
            </div>

            <div className="profile-name">
              링링의 한 마디
            </div>

            <div className="profile-text">
              하이류~~~
            </div>

            <div className="profile-line" />

            <div className="profile-info">
              <span>
                TOTAL POST
              </span>

              <strong>
                {posts.length}
              </strong>
            </div>

            <div className="music">
              ♪ 오늘만 I LOVE YOU
            </div>

          </aside>

          {/* =========================
              공책 링
          ========================= */}

          <div className="notebook-rings">

            <div className="ring-group top-rings">
              <div className="notebook-ring" />
              <div className="notebook-ring" />
            </div>

            <div className="ring-group bottom-rings">
              <div className="notebook-ring" />
              <div className="notebook-ring" />
            </div>

          </div>

          {/* =========================
              게시글 본문
          ========================= */}

          <main className="content post-content">

            {/* 제목 */}

            <div className="post-archive-header">

              <div>
                <div className="post-archive-small">
                  WEVERSE
                </div>

                <div className="post-archive-title">
                  POSTS
                </div>
              </div>

              <div className="post-total">
                TOTAL {posts.length}
              </div>

            </div>

            {/* =========================
                게시글 목록
            ========================= */}

            {isAdmin && posts.length > 0 && (
              <div className="post-bulk-actions">
                <label>
                  <input
                    type="checkbox"
                    checked={
                      posts.length > 0 &&
                      selectedPostIds.length === posts.length
                    }
                    onChange={toggleSelectAllPosts}
                  />
                  전체 선택
                </label>

                <span>
                  {selectedPostIds.length}개 선택
                </span>

                <button
                  type="button"
                  disabled={
                    selectedPostIds.length === 0 ||
                    bulkDeleting
                  }
                  onClick={handleBulkDeletePosts}
                >
                  {bulkDeleting
                    ? "삭제 중..."
                    : "선택 삭제"}
                </button>
              </div>
            )}

            <div className="post-list">

              {loading && (
                <div className="post-empty">
                  게시글을 불러오는 중...
                </div>
              )}

              {!loading &&
                posts.length === 0 && (
                  <div className="post-empty">
                    아직 게시글이 없습니다.
                  </div>
                )}

              {!loading &&
                posts.map((post) => {
                  const media =
                    getPostMedia(
                      post.id
                    );

                  const previewMedia =
                    media.slice(
                      0,
                      4
                    );

                  const remainingCount =
                    media.length -
                    previewMedia.length;

                  return (
                    <article
                      className="post-card post-card-preview"
                      key={post.id}
                      onClick={() => {
                        setSelectedPost(
                          post
                        );

                        setEditPostMode(
                          false
                        );
                      }}
                    >
                      {isAdmin && (
                        <label
                          className="post-select-checkbox"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={selectedPostIds.includes(post.id)}
                            onChange={() =>
                              togglePostSelection(post.id)
                            }
                          />
                          선택
                        </label>
                      )}

                      {/* 날짜 / 시간 */}

                      <div className="post-card-header">

                        <div>
                          <span className="post-date">
                            {formatDate(
                              post.date
                            )}
                          </span>

                          {post.posted_at && (
                            <span className="post-time">
                              {formatTime(
                                post.posted_at
                              )}
                            </span>
                          )}
                        </div>

                        {post.author && (
                          <div className="post-author">
                            {post.author}
                          </div>
                        )}

                      </div>

                      {/* 본문 미리보기 */}

                      {post.content && (
                        <div className="post-body post-body-preview">
                          {post.content}
                        </div>
                      )}

                      {/* 미디어 최대 4개 */}

                      {previewMedia.length >
                        0 && (

                        <div
                          className={`post-preview-media count-${previewMedia.length}`}
                        >

                          {previewMedia.map(
                            (
                              item,
                              index
                            ) => (

                              <div
                                className="post-preview-media-item"
                                key={`${item.mediaKind}-${item.id}`}
                              >

                                {/* 사진 */}

                                {item.mediaKind ===
                                  "photo" && (

                                  <img
                                    src={
                                      item.image_url
                                    }
                                    alt=""
                                    style={{
                                      objectPosition:
                                        item.crop_position ||
                                        "50% 50%",
                                    }}
                                  />

                                )}

                                {/* 동영상 */}

                                {item.mediaKind ===
                                  "video" && (

                                  <>
                                    <video
                                      src={
                                        item.video_url
                                      }
                                      poster={
                                        item.thumbnail_url ||
                                        undefined
                                      }
                                      preload="metadata"
                                    />

                                    <div className="post-video-play">
                                      ▶
                                    </div>
                                  </>

                                )}

                                {/* +N */}

                                {index ===
                                  previewMedia.length -
                                    1 &&
                                  remainingCount >
                                    0 && (

                                  <div className="post-more-media">
                                    +{remainingCount}
                                  </div>

                                )}

                              </div>

                            )
                          )}

                        </div>

                      )}

                      <div className="post-preview-footer">
                        게시글 보기
                      </div>

                    </article>
                  );
                })}

            </div>

          </main>

          {/* =========================
              오른쪽 탭
          ========================= */}

          <div className="archive-side-tabs">

            <button
              type="button"
              className="archive-side-tab"
              onClick={() => {
                window.location.href =
                  isAdmin
                    ? "/admin"
                    : "/";
              }}
            >
              사진
            </button>

            <button
              type="button"
              className="archive-side-tab"
              onClick={() => {
                window.location.href =
                  isAdmin
                    ? "/admin/videos"
                    : "/videos";
              }}
            >
              동영상
            </button>

            <button
              type="button"
              className="archive-side-tab active"
              onClick={() => {
                window.location.href =
                  isAdmin
                    ? "/admin/posts"
                    : "/posts";
              }}
            >
              게시글
            </button>

          </div>

        </div>

      </div>

      {/* =========================
          게시글 상세 모달
      ========================= */}

      {selectedPost && (

        <div
          className="post-modal"
          onClick={closePostModal}
        >

          <div
            className="post-modal-content"
            onClick={(e) =>
              e.stopPropagation()
            }
          >

            {/* 닫기 */}

            <button
              type="button"
              className="post-modal-close"
              onClick={closePostModal}
            >
              ×
            </button>

            {/* =========================
                일반 상세 화면
            ========================= */}

            {!editPostMode ? (
              <>

                {/* 작성자 / 날짜 */}

                <div className="post-modal-header">

                  {selectedPost.author && (
                    <div className="post-modal-author">
                      {selectedPost.author}
                    </div>
                  )}

                  <div className="post-modal-date">

                    {formatDate(
                      selectedPost.date
                    )}

                    {selectedPost.posted_at && (
                      <>
                        {" "}
                        {formatTime(
                          selectedPost.posted_at
                        )}
                      </>
                    )}

                  </div>

                </div>

                {isAdmin && (
                  <div className="post-admin-actions post-admin-actions-top">
                    <button
                      type="button"
                      onClick={() => openPostEdit(selectedPost)}
                    >
                      수정
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDeletePost(selectedPost)}
                    >
                      삭제
                    </button>
                  </div>
                )}

                {/* 본문 */}

                {selectedPost.content && (
                  <div className="post-modal-body">
                    {selectedPost.content}
                  </div>
                )}

                {/* =========================
                    전체 사진 / 동영상
                ========================= */}

                {selectedMedia.length >
                  0 && (

                  <div className="post-modal-media">

                    {selectedMedia.map(
                      (item) => (

                        <div
                          className="post-modal-media-item"
                          key={`${item.mediaKind}-${item.id}`}
                        >

                          {item.mediaKind ===
                            "photo" ? (

                            <img
                              src={
                                item.image_url
                              }
                              alt=""
                              style={{
                                objectPosition:
                                  item.crop_position ||
                                  "50% 50%",
                              }}
                            />

                          ) : (

                            <video
                              src={
                                item.video_url
                              }
                              poster={
                                item.thumbnail_url ||
                                undefined
                              }
                              controls
                              preload="metadata"
                            />

                          )}

                        </div>

                      )
                    )}

                  </div>

                )}

                {/* 위버스 링크 */}

                {selectedPost.weverse_url && (
                  <a
                    className="post-modal-weverse"
                    href={
                      selectedPost.weverse_url
                    }
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) =>
                      e.stopPropagation()
                    }
                  >
                    위버스에서 보기 ↗
                  </a>
                )}


              </>
            ) : (

              /* =========================
                  수정 화면
              ========================= */

              <div className="post-edit-form">

                <div className="edit-title">
                  게시글 수정
                </div>

                <label>
                  게시 날짜
                </label>

                <input
                  type="date"
                  value={
                    editPostDate
                  }
                  onChange={(e) =>
                    setEditPostDate(
                      e.target.value
                    )
                  }
                />

                <label>
                  게시 시간
                </label>

                <input
                  type="time"
                  value={
                    editPostTime
                  }
                  onChange={(e) =>
                    setEditPostTime(
                      e.target.value
                    )
                  }
                />

                <label>
                  작성자
                </label>

                <select
                  value={editPostAuthor}
                  onChange={(e) =>
                    setEditPostAuthor(e.target.value)
                  }
                >
                  <option value="">
                    작성자 선택
                  </option>

                  <option value="리우">
                    리우
                  </option>
                </select>

                <label>
                  게시글 본문
                </label>

                <textarea
                  value={
                    editPostContent
                  }
                  onChange={(e) =>
                    setEditPostContent(
                      e.target.value
                    )
                  }
                />

                <label>
                  위버스 링크
                </label>

                <input
                  type="url"
                  value={
                    editPostWeverseUrl
                  }
                  onChange={(e) =>
                    setEditPostWeverseUrl(
                      e.target.value
                    )
                  }
                />

                <div className="post-edit-media-section">

  <div className="edit-title">
    연결된 미디어
  </div>

  {editMedia.length === 0 && (
    <div>
      연결된 사진/동영상이 없습니다.
    </div>
  )}

  {editMedia.map((item, index) => (

    <div
      className={
        item.deletePending
          ? "post-edit-media-item delete-pending"
          : "post-edit-media-item"
      }
      key={`${item.mediaKind}-${item.id}`}
    >

      <div className="post-edit-media-top">

  <div className="post-edit-media-number">
    {index + 1}.{" "}
    {item.mediaKind ===
    "photo"
      ? "사진"
      : "동영상"}
  </div>

  <div className="media-order-buttons">

    <button
      type="button"
      disabled={
        index === 0 ||
        item.deletePending
      }
      onClick={() =>
        moveEditMedia(
          index,
          -1
        )
      }
    >
      ↑
    </button>

    <button
      type="button"
      disabled={
        index ===
          editMedia.length - 1 ||
        item.deletePending
      }
      onClick={() =>
        moveEditMedia(
          index,
          1
        )
      }
    >
      ↓
    </button>

  </div>

</div>

      {/* =====================
          미리보기
      ===================== */}

      <div
  className="post-edit-crop-editor"
  onPointerDown={(e) =>
    handleEditCropStart(
      e,
      item.id,
      item.mediaKind
    )
  }
  onPointerMove={(e) =>
    handleEditCropMove(
      e,
      item.id,
      item.mediaKind
    )
  }
  onPointerUp={(e) =>
    handleEditCropEnd(
      e,
      item.id,
      item.mediaKind
    )
  }
  onPointerCancel={(e) =>
    handleEditCropEnd(
      e,
      item.id,
      item.mediaKind
    )
  }
>

  {item.mediaKind ===
  "photo" ? (

    <img
      src={item.image_url}
      alt=""
      draggable="false"
      style={{
        objectPosition:
          `${item.cropX ?? 50}% ${item.cropY ?? 50}%`,
      }}
    />

  ) : (

    <video
      src={item.video_url}
      poster={
        item.thumbnail_url ||
        undefined
      }
      preload="metadata"
      muted
      style={{
        objectPosition:
          `${item.cropX ?? 50}% ${item.cropY ?? 50}%`,
      }}
    />

  )}

  <div className="crop-help">
    드래그해서 썸네일 위치 조정
  </div>

</div>

      {/* =====================
          사진 전용 정보
      ===================== */}

      {item.mediaKind === "photo" && (
        <>

          <label>
            유형
          </label>

          <select
            value={item.type || ""}
            disabled={item.deletePending}
            onChange={(e) =>
              updateEditMedia(
                item.id,
                item.mediaKind,
                "type",
                e.target.value
              )
            }
          >
            <option value="">
              선택
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


          <label className="archive-visible-toggle">
            <input
              type="checkbox"
              checked={item.archive_visible !== false}
              disabled={item.deletePending}
              onChange={(e) =>
                updateEditMedia(
                  item.id,
                  item.mediaKind,
                  "archive_visible",
                  e.target.checked
                )
              }
            />
            사진 아카이브에 표시
          </label>

          <label>
            머리색
          </label>

          <input
            type="text"
            value={
              item.hair_color || ""
            }
            disabled={
              item.deletePending
            }
            onChange={(e) =>
              updateEditMedia(
                item.id,
                item.mediaKind,
                "hair_color",
                e.target.value
              )
            }
          />


          <label>
            태그
          </label>

          <input
            type="text"
            value={
              (item.tags || []).join(", ")
            }
            disabled={
              item.deletePending
            }
            onChange={(e) =>
              updateEditMedia(
                item.id,
                item.mediaKind,
                "tags",
                e.target.value
                  .split(",")
                  .map((tag) =>
                    tag.trim()
                  )
                  .filter(Boolean)
              )
            }
            placeholder="안경, 모자, 브이"
          />


          <label>
            검색 태그
          </label>

          <input
            type="text"
            value={
              (
                item.search_tags ||
                []
              ).join(", ")
            }
            disabled={
              item.deletePending
            }
            onChange={(e) =>
              updateEditMedia(
                item.id,
                item.mediaKind,
                "search_tags",
                e.target.value
                  .split(",")
                  .map((tag) =>
                    tag.trim()
                  )
                  .filter(Boolean)
              )
            }
            placeholder="검색용 숨김 태그"
          />


          <label>
            사진 위버스 링크
          </label>

          <input
            type="url"
            value={
              item.weverse_url || ""
            }
            disabled={
              item.deletePending
            }
            onChange={(e) =>
              updateEditMedia(
                item.id,
                item.mediaKind,
                "weverse_url",
                e.target.value
              )
            }
          />

        </>
      )}

      {item.mediaKind === "video" && (
        <>
          <label>
            유형
          </label>

          <select
            value={item.type || ""}
            disabled={item.deletePending}
            onChange={(e) =>
              updateEditMedia(
                item.id,
                item.mediaKind,
                "type",
                e.target.value
              )
            }
          >
            <option value="">선택</option>
            <option value="셀카">셀카</option>
            <option value="남찍사">남찍사</option>
            <option value="거울셀카">거울셀카</option>
            <option value="그외">그외</option>
          </select>
        </>
      )}

      {/* =====================
          삭제 예정
      ===================== */}

      <button
        type="button"
        className="media-delete-button"
        onClick={() =>
          toggleDeleteMedia(
            item.id,
            item.mediaKind
          )
        }
      >
        {item.deletePending
          ? "삭제 취소"
          : item.mediaKind === "photo"
            ? "이 사진 삭제"
            : "이 동영상 삭제"}
      </button>

      {item.deletePending && (
        <div className="delete-pending-text">
          저장하면 삭제됩니다.
        </div>
      )}

    </div>

  ))}

</div>

                <div className="edit-actions">

                  <button
                    type="button"
                    onClick={
                      cancelPostEdit
                    }
                    disabled={
                      postSaving
                    }
                  >
                    취소
                  </button>

                  <button
                    type="button"
                    onClick={
                      handleUpdatePost
                    }
                    disabled={
                      postSaving
                    }
                  >
                    {postSaving
                      ? "저장 중..."
                      : "저장"}
                  </button>

                </div>

              </div>

            )}

          </div>

        </div>

      )}

    </div>
  );
}

export default Posts;
