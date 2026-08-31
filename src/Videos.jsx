import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";
import "./App.css";

function Videos({ isAdmin = false }) {
  const [videos, setVideos] = useState([]);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedVideo, setSelectedVideo] = useState(null);

  const [sortOrder, setSortOrder] = useState("최신순");
  const [videoType, setVideoType] = useState("전체");

  useEffect(() => {
    loadVideos();
  }, []);

  async function loadVideos() {
    setLoading(true);

    try {
      const { data: videoData, error: videoError } = await supabase
        .from("videos")
        .select("*");

      if (videoError) {
        throw videoError;
      }

      const { data: postData, error: postError } = await supabase
        .from("weverse_posts")
        .select("*");

      if (postError) {
        throw postError;
      }

      setVideos(videoData || []);
      setPosts(postData || []);
    } catch (error) {
      console.error("동영상 불러오기 오류:", error);
    } finally {
      setLoading(false);
    }
  }

  function getPost(video) {
    if (!video?.post_id) {
      return null;
    }

    return posts.find(
      (post) => String(post.id) === String(video.post_id)
    );
  }

  function formatDate(date) {
    if (!date) return "";
    return date.replaceAll("-", ".");
  }

  function formatTime(postedAt) {
    if (!postedAt) return "";

    const date = new Date(postedAt);

    return date.toLocaleTimeString("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function getVideoSortTime(video) {
    const post = getPost(video);

    if (post?.posted_at) {
      const time = new Date(post.posted_at).getTime();
      if (Number.isFinite(time)) return time;
    }

    if (post?.date) {
      const time = new Date(`${post.date}T00:00:00`).getTime();
      if (Number.isFinite(time)) return time;
    }

    if (video.created_at) {
      const time = new Date(video.created_at).getTime();
      if (Number.isFinite(time)) return time;
    }

    return 0;
  }

  const filteredVideos = useMemo(() => {
    return [...videos]
      .filter((video) => {
        return (
          videoType === "전체" ||
          video.type === videoType
        );
      })
      .sort((a, b) => {
        const aTime = getVideoSortTime(a);
        const bTime = getVideoSortTime(b);

        return sortOrder === "최신순"
          ? bTime - aTime
          : aTime - bTime;
      });
  }, [videos, posts, sortOrder, videoType]);

  async function downloadVideo(video) {
    try {
      const response = await fetch(video.video_url);

      if (!response.ok) {
        throw new Error("동영상 파일을 불러오지 못했습니다.");
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const post = getPost(video);
      const extension =
        blob.type?.split("/")[1]?.split("+")[0] || "mp4";

      const link = document.createElement("a");
      link.href = objectUrl;
      link.download =
        `riwoo_${post?.date || "video"}_${video.id}.${extension}`;

      document.body.appendChild(link);
      link.click();
      link.remove();

      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      console.error("동영상 다운로드 오류:", error);
      alert("동영상을 다운로드하지 못했습니다.");
    }
  }

  return (
    <div className="page">
      <div className="archive">
        <header className="top">
          <div className="logo">
            RIWOO
            <span>VIDEO ARCHIVE</span>
          </div>

          {!isAdmin && (
            <button
              className="admin-button"
              onClick={() => {
                window.location.href = "/login";
              }}
            >
              관리자
            </button>
          )}

          {isAdmin && (
            <div className="admin-header-buttons">
              <button
                type="button"
                className="back-button"
                onClick={() => {
                  window.location.href = "/";
                }}
              >
                HOME
              </button>

              <button
                type="button"
                className="add-photo-button"
                onClick={() => {
                  window.location.href = "/admin/import";
                }}
              >
                + 백업 폴더 가져오기
              </button>

              <button
                type="button"
                className="logout-button"
                onClick={async () => {
                  await supabase.auth.signOut();
                  window.location.href = "/";
                }}
              >
                로그아웃
              </button>
            </div>
          )}
        </header>

        <div className="blue-frame">
          <aside className="profile">
            <div className="profile-image">PROFILE</div>
            <div className="profile-name">링링의 한 마디</div>
            <div className="profile-text">하이류~~~</div>
            <div className="profile-line" />

            <div className="profile-info">
              <span>TOTAL VIDEO</span>
              <strong>{videos.length}</strong>
            </div>

            <div className="music">♪ 오늘만 I LOVE YOU</div>
          </aside>

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

          <main className="content video-content">
            <div className="video-archive-header">
              <div>
                <div className="video-archive-small">WEVERSE</div>
                <div className="video-archive-title">VIDEOS</div>
              </div>

              <div className="video-total">
                TOTAL {filteredVideos.length}
              </div>
            </div>

            <div className="video-filter-bar">
              <button
                type="button"
                className={videoType === "전체" ? "active" : ""}
                onClick={() => setVideoType("전체")}
              >
                전체
              </button>

              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
              >
                <option value="최신순">최신순</option>
                <option value="오래된순">오래된순</option>
              </select>

              <select
                value={videoType}
                onChange={(e) => setVideoType(e.target.value)}
              >
                <option value="전체">동영상 유형</option>
                <option value="셀카">셀카</option>
                <option value="남찍사">남찍사</option>
                <option value="거울셀카">거울셀카</option>
                <option value="그외">그외</option>
              </select>
            </div>

            <div className="video-grid">
              {loading && (
                <div className="video-empty">
                  동영상을 불러오는 중...
                </div>
              )}

              {!loading && filteredVideos.length === 0 && (
                <div className="video-empty">
                  조건에 맞는 동영상이 없습니다.
                </div>
              )}

              {!loading &&
                filteredVideos.map((video) => {
                  const post = getPost(video);

                  return (
                    <article
                      className="video-card"
                      key={video.id}
                      onClick={() => setSelectedVideo(video)}
                    >
                      <div className="video-preview">
                        <video
                          src={video.video_url}
                          poster={video.thumbnail_url || undefined}
                          preload="metadata"
                          muted
                          playsInline
                        />
                        <div className="video-thumbnail-play">▶</div>
                      </div>

                      <div className="video-info">
                        {post && (
                          <div className="video-date">
                            <span>{formatDate(post.date)}</span>

                            {post.posted_at && (
                              <span className="video-time">
                                {formatTime(post.posted_at)}
                              </span>
                            )}
                          </div>
                        )}

                        {video.type && (
                          <div className="video-type">
                            {video.type}
                          </div>
                        )}

                        {post?.content && (
                          <div className="video-post-text">
                            {post.content}
                          </div>
                        )}

                        <div className="video-card-footer">
                          {post?.weverse_url && (
                            <a
                              href={post.weverse_url}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                            >
                              WEVERSE ↗
                            </a>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
            </div>
          </main>

          <div className="archive-side-tabs">
            <button
              type="button"
              className="archive-side-tab"
              onClick={() => {
                window.location.href = isAdmin ? "/admin" : "/";
              }}
            >
              사진
            </button>

            <button
              type="button"
              className="archive-side-tab active"
              onClick={() => {
                window.location.href =
                  isAdmin ? "/admin/videos" : "/videos";
              }}
            >
              동영상
            </button>

            {isAdmin && (
              <button
                type="button"
                className="archive-side-tab"
                onClick={() => {
                  window.location.href = "/admin/posts";
                }}
              >
                게시글
              </button>
            )}
          </div>
        </div>
      </div>

      {selectedVideo && (
        <div className="video-modal" onClick={() => setSelectedVideo(null)}>
          <div className="video-modal-content" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="modal-close"
              onClick={() => setSelectedVideo(null)}
            >
              ×
            </button>

            <div className="video-modal-player">
              <video
                src={selectedVideo.video_url}
                poster={selectedVideo.thumbnail_url || undefined}
                controls
                controlsList="nodownload"
                preload="metadata"
                playsInline
              />
            </div>

            <div className="video-modal-info">
              {getPost(selectedVideo) && (
                <div className="video-date">
                  <span>{formatDate(getPost(selectedVideo).date)}</span>
                  {getPost(selectedVideo).posted_at && (
                    <span className="video-time">
                      {formatTime(getPost(selectedVideo).posted_at)}
                    </span>
                  )}
                </div>
              )}

              {selectedVideo.type && (
                <div className="video-type">{selectedVideo.type}</div>
              )}

              <button
                type="button"
                className="media-download-button video-modal-download"
                onClick={() => downloadVideo(selectedVideo)}
              >
                동영상 다운로드 ↓
              </button>

              {getPost(selectedVideo)?.weverse_url && (
                <a
                  className="weverse-link"
                  href={getPost(selectedVideo).weverse_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  위버스에서 보기 ↗
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Videos;
