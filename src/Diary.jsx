import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";
import ArchiveLayout from "./ArchiveLayout";
import "./Diary.css";

function Diary({ isAdmin = false }) {
  const [posts, setPosts] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [videos, setVideos] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedPost, setSelectedPost] = useState(null);

  useEffect(() => {
    loadDiary();
  }, []);

  useEffect(() => {
    if (!selectedPost) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [selectedPost]);

  async function loadDiary() {
    setLoading(true);

    try {
      const { data: postData, error: postError } = await supabase
        .from("weverse_posts")
        .select("*")
        .eq("is_diary", true)
        .order("date", { ascending: false, nullsFirst: false })
        .order("posted_at", { ascending: false, nullsFirst: false })
        // 날짜와 게시 시간이 같은 글도 불러올 때마다 순서가 바뀌지 않게 한다.
        .order("created_at", { ascending: false, nullsFirst: false });

      if (postError) throw postError;

      const diaryPosts = postData || [];
      const postIds = diaryPosts.map((post) => post.id);

      // 미디어 조회가 실패해도 등록된 다이어리 게시글 자체는 먼저 표시한다.
      setPosts(diaryPosts);

      if (!postIds.length) {
        setPosts([]);
        setPhotos([]);
        setVideos([]);
        return;
      }

      const [photoResult, videoResult] = await Promise.all([
        supabase
          .from("photos")
          .select("*")
          .in("post_id", postIds)
          .order("media_order", { ascending: true, nullsFirst: false }),
        supabase
          .from("videos")
          .select("*")
          .in("post_id", postIds)
          .order("media_order", { ascending: true, nullsFirst: false }),
      ]);

      if (photoResult.error) {
        console.error("다이어리 사진을 불러오지 못했습니다:", photoResult.error);
        setPhotos([]);
      } else {
        setPhotos(photoResult.data || []);
      }

      if (videoResult.error) {
        console.error("다이어리 영상을 불러오지 못했습니다:", videoResult.error);
        setVideos([]);
      } else {
        setVideos(videoResult.data || []);
      }
    } catch (error) {
      console.error("다이어리를 불러오지 못했습니다:", error);
    } finally {
      setLoading(false);
    }
  }

  function getPostPhotos(postId) {
    return photos.filter(
      (photo) => String(photo.post_id) === String(postId),
    );
  }

  function getPostVideos(postId) {
    return videos.filter(
      (video) => String(video.post_id) === String(postId),
    );
  }

  function getCover(post) {
    const postPhotos = getPostPhotos(post.id);
    const selectedCover = postPhotos.find(
      (photo) =>
        String(photo.id) === String(post.diary_cover_photo_id || ""),
    );

    if (selectedCover) {
      return selectedCover.thumbnail_url || selectedCover.image_url;
    }

    if (postPhotos[0]) {
      return postPhotos[0].thumbnail_url || postPhotos[0].image_url;
    }

    return getPostVideos(post.id)[0]?.thumbnail_url || "";
  }

  function getPostMedia(postId) {
    const photoMedia = getPostPhotos(postId).map((photo) => ({
      ...photo,
      mediaKind: "photo",
      order: Number(photo.media_order ?? photo.upload_order ?? 0),
    }));
    const videoMedia = getPostVideos(postId).map((video) => ({
      ...video,
      mediaKind: "video",
      order: Number(video.media_order ?? video.upload_order ?? 0),
    }));

    return [...photoMedia, ...videoMedia].sort((a, b) => a.order - b.order);
  }

  const filteredPosts = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return posts;

    return posts.filter((post) =>
      [post.diary_title, post.content, post.date, post.author]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword)),
    );
  }, [posts, search]);

  const selectedMedia = selectedPost ? getPostMedia(selectedPost.id) : [];

  function renderDiaryContent(post, media) {
    const blocks = Array.isArray(post.content_blocks) ? post.content_blocks : [];
    if (!blocks.length) return null;
    const orderedPhotos = media.filter((item) => item.mediaKind === "photo");
    const orderedVideos = media.filter((item) => item.mediaKind === "video");
    return blocks.map((block, blockIndex) => {
      if (block?.type === "text" && block.content) {
        return <div className="diary-modal-body" key={`text-${blockIndex}`}>{block.content}</div>;
      }
      const item = block?.type === "photo"
        ? orderedPhotos[Number(block.index)]
        : block?.type === "video"
          ? orderedVideos[Number(block.index)]
          : null;
      if (!item) return null;
      return (
        <div className="diary-modal-media" key={`${block.type}-${blockIndex}`}>
          {block.type === "photo" ? (
            <img
              src={item.thumbnail_url || item.image_url}
              data-original-src={item.image_url}
              alt=""
              loading="lazy"
              decoding="async"
              onError={(event) => {
                const original = event.currentTarget.dataset.originalSrc;
                if (original && event.currentTarget.src !== original) {
                  event.currentTarget.src = original;
                }
              }}
            />
          ) : (
            <video src={item.video_url} poster={item.thumbnail_url || undefined} controls preload="metadata" />
          )}
        </div>
      );
    });
  }

  return (
    <>
      <ArchiveLayout
        isAdmin={isAdmin}
        activeTab="diary"
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="다이어리 제목이나 내용을 검색해보세요"
      >
        <div className="diary-grid">
          {loading && <div className="diary-empty">다이어리를 불러오는 중...</div>}

          {!loading && filteredPosts.length === 0 && (
            <div className="diary-empty">아직 등록된 다이어리가 없습니다.</div>
          )}

          {filteredPosts.map((post) => {
            const cover = getCover(post);
            return (
              <article
                className="diary-card"
                key={post.id}
                onClick={() => setSelectedPost(post)}
              >
                <div className="diary-card-cover">
                  {cover ? (
                    <img src={cover} alt="" loading="lazy" />
                  ) : (
                    <span>NO IMAGE</span>
                  )}
                </div>
                <div className="diary-card-title">
                  {post.diary_title || post.date || "제목 없는 다이어리"}
                </div>
                <div className="diary-card-date">{post.date}</div>
              </article>
            );
          })}
        </div>
      </ArchiveLayout>

      {selectedPost && (
        <div className="diary-modal" onClick={() => setSelectedPost(null)}>
          <div className="diary-modal-content" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="diary-modal-close"
              onClick={() => setSelectedPost(null)}
            >
              ×
            </button>

            <header className="diary-modal-header">
              <small>{selectedPost.date}</small>
              <h2>{selectedPost.diary_title || "제목 없는 다이어리"}</h2>
            </header>

            {Array.isArray(selectedPost.content_blocks) && selectedPost.content_blocks.length ? (
              <div className="diary-modal-blocks">{renderDiaryContent(selectedPost, selectedMedia)}</div>
            ) : <>
            {selectedPost.content && <div className="diary-modal-body">{selectedPost.content}</div>}
            {selectedMedia.length > 0 && (
              <div className="diary-modal-media">
                {selectedMedia.map((item) =>
                  item.mediaKind === "photo" ? (
                    <img
                      key={`photo-${item.id}`}
                      src={item.thumbnail_url || item.image_url}
                      data-original-src={item.image_url}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      onError={(event) => {
                        const original = event.currentTarget.dataset.originalSrc;
                        if (original && event.currentTarget.src !== original) {
                          event.currentTarget.src = original;
                        }
                      }}
                    />
                  ) : (
                    <video
                      key={`video-${item.id}`}
                      src={item.video_url}
                      poster={item.thumbnail_url || undefined}
                      controls
                      preload="metadata"
                    />
                  ),
                )}
              </div>
            )}
            </>}

            <footer className="diary-modal-links">
              {selectedPost.weverse_url && (
                <a href={selectedPost.weverse_url} target="_blank" rel="noreferrer">
                  위버스에서 보기 ↗
                </a>
              )}

              {isAdmin && (
                <button
                  type="button"
                  onClick={() => {
                    window.location.href = `/admin/posts?post=${selectedPost.id}`;
                  }}
                >
                  게시글 수정
                </button>
              )}
            </footer>
          </div>
        </div>
      )}
    </>
  );
}

export default Diary;
