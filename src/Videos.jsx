import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import ArchiveLayout from "./ArchiveLayout";
import ArchiveFilters from "./ArchiveFilters";
import "./App.css";

function Videos({ isAdmin = false }) {
  const [videos, setVideos] = useState([]);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [thumbnailTime, setThumbnailTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [savingThumbnail, setSavingThumbnail] = useState(false);
  const [editingVideo, setEditingVideo] = useState(false);
  const [savingVideo, setSavingVideo] = useState(false);
  const [editVideoType, setEditVideoType] = useState("");
  const [editVideoHairColor, setEditVideoHairColor] = useState("");
  const [editVideoTags, setEditVideoTags] = useState("");
  const [editVideoSearchTags, setEditVideoSearchTags] = useState("");
  const modalVideoRef = useRef(null);
  const modalBackgroundRef = useRef(null);

  const [sortOrder, setSortOrder] = useState("최신순");

  const [videoType, setVideoType] = useState("전체");

  const [videoTag, setVideoTag] = useState("전체");
  const [videoHairColor, setVideoHairColor] = useState("전체");

  const [search, setSearch] = useState("");

  const [startDate, setStartDate] = useState("");

  const [endDate, setEndDate] = useState("");

  useEffect(() => {
    loadVideos();
  }, []);

  useEffect(() => {
    if (!selectedVideo) return;

    setThumbnailTime(Number(selectedVideo.thumbnail_time) || 0);
    setVideoDuration(0);
    setEditingVideo(false);
    setEditVideoType(selectedVideo.type || "");
    setEditVideoHairColor(selectedVideo.hair_color || "");
    setEditVideoTags(
      Array.isArray(selectedVideo.tags) ? selectedVideo.tags.join(", ") : "",
    );
    setEditVideoSearchTags(
      Array.isArray(selectedVideo.search_tags)
        ? selectedVideo.search_tags.join(", ")
        : "",
    );
  }, [selectedVideo]);

  function splitTags(value) {
    return value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  async function saveVideoDetails() {
    if (!selectedVideo) return;

    const nextValues = {
      type: editVideoType || null,
      hair_color: editVideoHairColor || null,
      tags: splitTags(editVideoTags),
      search_tags: splitTags(editVideoSearchTags),
    };

    setSavingVideo(true);
    try {
      const { error } = await supabase
        .from("videos")
        .update(nextValues)
        .eq("id", selectedVideo.id);

      if (error) throw error;

      const updatedVideo = { ...selectedVideo, ...nextValues };
      setVideos((current) =>
        current.map((video) =>
          video.id === selectedVideo.id ? updatedVideo : video,
        ),
      );
      setSelectedVideo(updatedVideo);
      setEditingVideo(false);
    } catch (error) {
      console.error("동영상 정보 수정 오류:", error);
      alert("동영상 정보를 수정하지 못했습니다.");
    } finally {
      setSavingVideo(false);
    }
  }

  async function deleteSelectedVideo() {
    if (!selectedVideo) return;
    if (!window.confirm("이 동영상을 삭제할까요? 삭제 후 복구할 수 없습니다.")) {
      return;
    }

    try {
      const targetId = selectedVideo.id;
      const { error } = await supabase.from("videos").delete().eq("id", targetId);
      if (error) throw error;

      const publicMarker = "/storage/v1/object/public/videos/";
      const path = selectedVideo.video_url?.includes(publicMarker)
        ? decodeURIComponent(selectedVideo.video_url.split(publicMarker)[1])
        : "";
      if (path) await supabase.storage.from("videos").remove([path]);

      setVideos((current) => current.filter((video) => video.id !== targetId));
      setSelectedVideo(null);
    } catch (error) {
      console.error("동영상 삭제 오류:", error);
      alert("동영상을 삭제하지 못했습니다.");
    }
  }

  function searchVideoTag(tag) {
    setVideoTag("전체");
    setSearch(tag);
    setSelectedVideo(null);
  }

  function showThumbnailFrame(element, time) {
    const nextTime = Math.max(0, Number(time) || 0);

    if (Number.isFinite(element.duration)) {
      element.currentTime = Math.min(nextTime, element.duration);
    }

    element.pause();
  }

  function handleThumbnailChange(value) {
    const nextTime = Number(value);
    setThumbnailTime(nextTime);

    if (modalVideoRef.current) {
      showThumbnailFrame(modalVideoRef.current, nextTime);
    }

    if (modalBackgroundRef.current) {
      showThumbnailFrame(modalBackgroundRef.current, nextTime);
    }
  }

  async function saveThumbnailTime() {
    if (!selectedVideo) return;

    setSavingThumbnail(true);

    try {
      const { error } = await supabase
        .from("videos")
        .update({ thumbnail_time: thumbnailTime })
        .eq("id", selectedVideo.id);

      if (error) throw error;

      setVideos((current) =>
        current.map((video) =>
          video.id === selectedVideo.id
            ? { ...video, thumbnail_time: thumbnailTime }
            : video
        )
      );

      setSelectedVideo((current) => ({
        ...current,
        thumbnail_time: thumbnailTime,
      }));
    } catch (error) {
      console.error("썸네일 장면 저장 오류:", error);
      alert("썸네일 장면을 저장하지 못했습니다.");
    } finally {
      setSavingThumbnail(false);
    }
  }

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
        const post = getPost(video);

        const videoDate = post?.date || "";

        // 유형
        const matchesType = videoType === "전체" || video.type === videoType;

        const tags = Array.isArray(video.tags) ? video.tags : [];
        const searchTags = Array.isArray(video.search_tags)
          ? video.search_tags
          : [];

        const matchesTag = videoTag === "전체" || tags.includes(videoTag);
        const matchesHairColor =
          videoHairColor === "전체" || video.hair_color === videoHairColor;

        // 시작 날짜
        const matchesStartDate =
          !startDate || (videoDate && videoDate >= startDate);

        // 종료 날짜
        const matchesEndDate = !endDate || (videoDate && videoDate <= endDate);

        const normalizedSearch = search.trim().toLowerCase();
        const searchableValues = [
          video.type,
          videoDate,
          post?.content,
          ...tags,
          ...searchTags,
        ];

        const matchesSearch =
          !normalizedSearch ||
          searchableValues.some((value) =>
            String(value || "").toLowerCase().includes(normalizedSearch),
          );

        return (
          matchesType &&
          matchesHairColor &&
          matchesTag &&
          matchesStartDate &&
          matchesEndDate &&
          matchesSearch
        );
      })
      .sort((a, b) => {
        const aTime = getVideoSortTime(a);

        const bTime = getVideoSortTime(b);

        return sortOrder === "최신순" ? bTime - aTime : aTime - bTime;
      });
  }, [
    videos,
    posts,
    sortOrder,
    videoType,
    videoTag,
    videoHairColor,
    search,
    startDate,
    endDate,
  ]);

  const videoTagOptions = useMemo(
    () =>
      [...new Set(videos.flatMap((video) =>
        Array.isArray(video.tags) ? video.tags : [],
      ))]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, "ko")),
    [videos],
  );

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
            <>
              <ArchiveLayout
                isAdmin={isAdmin}
                activeTab="videos"
                search={search}
                onSearchChange={setSearch}
                searchPlaceholder="동영상이나 키워드를 검색해보세요"
              >
                <ArchiveFilters
                  type={videoType}
                  setType={setVideoType}
                  sortOrder={sortOrder}
                  setSortOrder={setSortOrder}
                  startDate={startDate}
                  setStartDate={setStartDate}
                  endDate={endDate}
                  setEndDate={setEndDate}
                  typeLabel="동영상 유형"
                  secondaryValue={videoHairColor}
                  setSecondaryValue={setVideoHairColor}
                  secondaryLabel="머리색"
                  secondaryOptions={["흑발", "갈발", "금발", "적발", "은발", "핑머"]}
                  tertiaryValue={videoTag}
                  setTertiaryValue={setVideoTag}
                  tertiaryLabel="동영상 태그"
                  tertiaryOptions={videoTagOptions}
                  allActive={
                    videoType === "전체" &&
                    videoHairColor === "전체" &&
                    videoTag === "전체" &&
                    search.trim() === ""
                  }
                  onAllClick={() => {
                    setVideoType("전체");
                    setVideoHairColor("전체");
                    setVideoTag("전체");
                    setSearch("");
                  }}
                />

                <div className="video-grid">
                  {loading && (
                    <div className="video-empty">동영상을 불러오는 중...</div>
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
                              key={`${video.id}-${video.thumbnail_time || 0}`}
                              src={video.video_url}
                              preload="metadata"
                              muted
                              playsInline
                              onLoadedMetadata={(event) =>
                                showThumbnailFrame(
                                  event.currentTarget,
                                  video.thumbnail_time
                                )
                              }
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
                              <div className="video-type">{video.type}</div>
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
              </ArchiveLayout>

              {selectedVideo && (
                <div
                  className="video-modal"
                  onClick={() => setSelectedVideo(null)}
                >
                  <div
                    className="video-modal-content"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="modal-close"
                      onClick={() => setSelectedVideo(null)}
                    >
                      ×
                    </button>

                    <div className="video-modal-player">
                      <video
                        ref={modalBackgroundRef}
                        className="video-modal-background"
                        src={selectedVideo.video_url}
                        poster={selectedVideo.thumbnail_url || undefined}
                        muted
                        preload="metadata"
                        playsInline
                        aria-hidden="true"
                        onLoadedMetadata={(event) =>
                          showThumbnailFrame(event.currentTarget, thumbnailTime)
                        }
                      />
                      <video
                        ref={modalVideoRef}
                        className="video-modal-main"
                        src={selectedVideo.video_url}
                        poster={selectedVideo.thumbnail_url || undefined}
                        controls
                        controlsList="nodownload"
                        preload="metadata"
                        playsInline
                        onLoadedMetadata={(event) => {
                          setVideoDuration(event.currentTarget.duration || 0);
                          showThumbnailFrame(event.currentTarget, thumbnailTime);
                        }}
                      />
                    </div>

                    <div className="video-modal-info">
                      {isAdmin && videoDuration > 0 && (
                        <div className="video-thumbnail-editor">
                          <div className="video-thumbnail-editor-title">
                            썸네일 장면 선택
                          </div>
                          <input
                            type="range"
                            min="0"
                            max={videoDuration}
                            step="0.1"
                            value={thumbnailTime}
                            onChange={(event) =>
                              handleThumbnailChange(event.target.value)
                            }
                          />
                          <div className="video-thumbnail-editor-bottom">
                            <span>{thumbnailTime.toFixed(1)}초</span>
                            <button
                              type="button"
                              onClick={saveThumbnailTime}
                              disabled={savingThumbnail}
                            >
                              {savingThumbnail ? "저장 중..." : "이 장면 저장"}
                            </button>
                          </div>
                        </div>
                      )}
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

                      {(selectedVideo.type || selectedVideo.hair_color) && (
                        <div className="modal-meta">
                          {selectedVideo.type}
                          {selectedVideo.hair_color && (
                            <><span>{" · "}</span>{selectedVideo.hair_color}</>
                          )}
                        </div>
                      )}

                      {!editingVideo && Array.isArray(selectedVideo.tags) && (
                        <div className="modal-tags">
                          {selectedVideo.tags.map((tag) => (
                            <button
                              type="button"
                              className="tag"
                              key={tag}
                              onClick={() => searchVideoTag(tag)}
                            >
                              #{tag}
                            </button>
                          ))}
                        </div>
                      )}

                      {isAdmin && editingVideo && (
                        <div className="video-detail-editor">
                          <label>
                            동영상 유형
                            <select
                              value={editVideoType}
                              onChange={(e) => setEditVideoType(e.target.value)}
                            >
                              <option value="">유형 선택</option>
                              <option value="셀카">셀카</option>
                              <option value="남찍사">남찍사</option>
                              <option value="거울셀카">거울셀카</option>
                              <option value="그외">그외</option>
                            </select>
                          </label>
                          <label>
                            머리색
                            <select
                              value={editVideoHairColor}
                              onChange={(e) => setEditVideoHairColor(e.target.value)}
                            >
                              <option value="">머리색 선택</option>
                              <option value="흑발">흑발</option>
                              <option value="갈발">갈발</option>
                              <option value="금발">금발</option>
                              <option value="적발">적발</option>
                              <option value="은발">은발</option>
                              <option value="핑머">핑머</option>
                            </select>
                          </label>
                          <label>
                            태그
                            <input
                              value={editVideoTags}
                              onChange={(e) => setEditVideoTags(e.target.value)}
                              placeholder="쉼표로 구분"
                            />
                          </label>
                          <label>
                            검색 태그
                            <input
                              value={editVideoSearchTags}
                              onChange={(e) =>
                                setEditVideoSearchTags(e.target.value)
                              }
                              placeholder="쉼표로 구분"
                            />
                          </label>
                          <div className="video-detail-editor-actions">
                            <button
                              type="button"
                              onClick={() => setEditingVideo(false)}
                              disabled={savingVideo}
                            >
                              취소
                            </button>
                            <button
                              type="button"
                              onClick={saveVideoDetails}
                              disabled={savingVideo}
                            >
                              {savingVideo ? "저장 중..." : "저장"}
                            </button>
                          </div>
                        </div>
                      )}

                      {isAdmin && !editingVideo && (
                        <div className="video-admin-actions">
                          <button type="button" onClick={() => setEditingVideo(true)}>
                            수정
                          </button>
                          <button type="button" onClick={deleteSelectedVideo}>
                            삭제
                          </button>
                        </div>
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
            </>
          );
}

export default Videos;
