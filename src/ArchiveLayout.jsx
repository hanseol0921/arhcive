import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import "./App.css";

// 재생목록에 곡을 추가하려면 아래 배열에 같은 형식으로 한 줄씩 넣으면 됩니다.
const DEFAULT_BGM_PLAYLIST = [
  {
    url: "https://music.youtube.com/watch?v=ptDnd4lGr-k",
    artist: "BOYNEXTDOOR",
    title: "오늘만 I LOVE YOU",
  },
];

function getYoutubeVideoId(url) {
  try {
    const parsed = new URL(url);

    if (parsed.hostname === "youtu.be") {
      return parsed.pathname.slice(1);
    }

    return parsed.searchParams.get("v") || parsed.pathname.split("/").pop();
  } catch {
    return url;
  }
}

function formatBgmTime(seconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = String(safeSeconds % 60).padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function MiniBgmPlayer({ playlist }) {
  const playerElementRef = useRef(null);
  const playerRef = useRef(null);
  const [trackIndex, setTrackIndex] = useState(0);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const tracks = playlist.length ? playlist : DEFAULT_BGM_PLAYLIST;
  const currentTrack = tracks[trackIndex] || tracks[0];
  const controlButtonStyle = {
    width: 24,
    height: 21,
    padding: 0,
    border: "1px solid #c9c2b7",
    borderRadius: 3,
    background: "#fff",
    color: "#666158",
    fontSize: 8,
    lineHeight: 1,
    cursor: ready ? "pointer" : "default",
  };

  function playTrack(index) {
    const normalizedIndex =
      (index + tracks.length) % tracks.length;
    const nextTrack = tracks[normalizedIndex];

    setTrackIndex(normalizedIndex);
    setCurrentTime(0);
    playerRef.current?.loadVideoById(getYoutubeVideoId(nextTrack.url));
  }

  function playNext() {
    playTrack(trackIndex + 1);
  }

  function playPrevious() {
    if (currentTime > 3) {
      playerRef.current?.seekTo(0, true);
      setCurrentTime(0);
      return;
    }

    playTrack(trackIndex - 1);
  }

  useEffect(() => {
    let cancelled = false;
    let apiWaitTimer;
    let progressTimer;

    function createPlayer() {
      if (cancelled || playerRef.current || !window.YT?.Player) return;

      playerRef.current = new window.YT.Player(playerElementRef.current, {
        width: "1",
        height: "1",
        videoId: getYoutubeVideoId(tracks[0].url),
        playerVars: {
          playsinline: 1,
          controls: 0,
          rel: 0,
        },
        events: {
          onReady: (event) => {
            setReady(true);
            setDuration(event.target.getDuration() || 0);
          },
          onStateChange: (event) => {
            const state = event.data;
            setPlaying(state === window.YT.PlayerState.PLAYING);

            if (state === window.YT.PlayerState.ENDED) {
              if (tracks.length === 1) {
                event.target.seekTo(0, true);
                event.target.playVideo();
              } else {
                setTrackIndex((current) => {
                  const next = (current + 1) % tracks.length;
                  event.target.loadVideoById(
                    getYoutubeVideoId(tracks[next].url),
                  );
                  return next;
                });
              }
            }
          },
        },
      });

      progressTimer = window.setInterval(() => {
        const player = playerRef.current;
        if (!player?.getCurrentTime) return;

        setCurrentTime(player.getCurrentTime() || 0);
        setDuration(player.getDuration() || 0);
      }, 500);
    }

    if (window.YT?.Player) {
      createPlayer();
    } else {
      if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
        const script = document.createElement("script");
        script.src = "https://www.youtube.com/iframe_api";
        document.head.appendChild(script);
      }

      apiWaitTimer = window.setInterval(() => {
        if (window.YT?.Player) {
          window.clearInterval(apiWaitTimer);
          createPlayer();
        }
      }, 100);
    }

    return () => {
      cancelled = true;
      window.clearInterval(apiWaitTimer);
      window.clearInterval(progressTimer);
      playerRef.current?.destroy?.();
      playerRef.current = null;
    };
  }, [playlist]);

  return (
    <div
      className="music mini-bgm-player"
      style={{ marginTop: "26px", textAlign: "left" }}
    >
      <div
        ref={playerElementRef}
        style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
      />

      <div
        style={{
          overflow: "hidden",
          color: "#666158",
          fontSize: "9px",
          lineHeight: 1.5,
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={`${currentTrack.artist} - ${currentTrack.title}`}
      >
        <strong>{currentTrack.title}</strong>
        <span style={{ marginLeft: 5, color: "#999288" }}>
          {currentTrack.artist}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 6 }}>
        <button
          type="button"
          onClick={playPrevious}
          disabled={!ready}
          aria-label="이전 곡"
          style={controlButtonStyle}
        >
          ◀
        </button>
        <button
          type="button"
          onClick={() => {
            if (playing) playerRef.current?.pauseVideo();
            else playerRef.current?.playVideo();
          }}
          disabled={!ready}
          aria-label={playing ? "일시정지" : "재생"}
          style={controlButtonStyle}
        >
          {playing ? "Ⅱ" : "▶"}
        </button>
        <button
          type="button"
          onClick={playNext}
          disabled={!ready}
          aria-label="다음 곡"
          style={controlButtonStyle}
        >
          ▶│
        </button>

        <span style={{ marginLeft: "auto", color: "#999288", fontSize: 8 }}>
          {formatBgmTime(currentTime)} / {formatBgmTime(duration)}
        </span>
      </div>

      <input
        type="range"
        min="0"
        max={Math.max(duration, 1)}
        step="0.1"
        value={Math.min(currentTime, Math.max(duration, 1))}
        disabled={!ready}
        aria-label="BGM 재생 위치"
        onChange={(event) => {
          const nextTime = Number(event.target.value);
          playerRef.current?.seekTo(nextTime, true);
          setCurrentTime(nextTime);
        }}
        style={{ width: "100%", height: 12, marginTop: 3, accentColor: "#777268" }}
      />

      <div style={{ marginTop: 2, color: "#aaa398", fontSize: 8 }}>
        PLAYLIST {trackIndex + 1} / {tracks.length} · REPEAT ALL
      </div>
    </div>
  );
}

function BgmPlaylistManager({ playlist, onSave, saving }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(playlist);
  const [newUrl, setNewUrl] = useState("");
  const [readingLink, setReadingLink] = useState(false);

  useEffect(() => {
    if (!open) setDraft(playlist);
  }, [playlist, open]);

  async function addYoutubeTrack() {
    const url = newUrl.trim();
    if (!getYoutubeVideoId(url)) return;

    if (draft.some((track) => getYoutubeVideoId(track.url) === getYoutubeVideoId(url))) {
      alert("이미 재생목록에 있는 곡입니다.");
      return;
    }

    setReadingLink(true);
    let title = "곡 제목을 입력해주세요";
    let artist = "아티스트를 입력해주세요";

    try {
      const watchUrl = `https://www.youtube.com/watch?v=${getYoutubeVideoId(url)}`;
      const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`;
      const response = await fetch(endpoint);
      if (!response.ok) throw new Error("YouTube 정보를 읽지 못했습니다.");
      const metadata = await response.json();
      title = metadata.title || title;
      artist = String(metadata.author_name || artist)
        .replace(/\s*-\s*Topic\s*$/i, "")
        .trim();
    } catch (error) {
      console.error("YouTube 곡 정보 자동 입력 실패:", error);
    } finally {
      setReadingLink(false);
    }

    setDraft((current) => [...current, { url, title, artist }]);
    setNewUrl("");
  }

  function updateTrack(index, field, value) {
    setDraft((current) =>
      current.map((track, trackIndex) =>
        trackIndex === index ? { ...track, [field]: value } : track,
      ),
    );
  }

  function moveTrack(index, direction) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= draft.length) return;

    setDraft((current) => {
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setDraft(playlist);
          setOpen(true);
        }}
        style={{
          marginTop: 7,
          padding: "4px 8px",
          border: "1px solid #c9c2b7",
          borderRadius: 3,
          background: "#fff",
          color: "#777268",
          fontSize: 8,
          cursor: "pointer",
        }}
      >
        BGM 재생목록 관리
      </button>

      {open && (
        <div
          role="presentation"
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 2000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            background: "rgba(30, 30, 30, .5)",
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="BGM 재생목록 관리"
            onClick={(event) => event.stopPropagation()}
            style={{
              width: "min(720px, 94vw)",
              maxHeight: "86vh",
              overflowY: "auto",
              padding: 22,
              borderRadius: 10,
              background: "#fff",
              boxShadow: "0 15px 50px rgba(0,0,0,.25)",
              textAlign: "left",
            }}
          >
            <h2 style={{ margin: "0 0 16px", fontSize: 17, color: "#55514a" }}>
              BGM 재생목록
            </h2>

            <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
              <input
                type="url"
                value={newUrl}
                onChange={(event) => setNewUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") addYoutubeTrack();
                }}
                placeholder="YouTube 또는 YouTube Music 링크"
                style={{ flex: 1, minWidth: 0, height: 34, padding: "0 9px" }}
              />
              <button
                type="button"
                onClick={addYoutubeTrack}
                disabled={!newUrl.trim() || readingLink}
                style={{ minWidth: 80, height: 34 }}
              >
                {readingLink ? "읽는 중…" : "곡 추가"}
              </button>
            </div>

            <div style={{ display: "grid", gap: 9 }}>
              {draft.map((track, index) => (
                <div
                  key={`${getYoutubeVideoId(track.url)}-${index}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "28px minmax(0, 1fr) minmax(0, 1fr) auto",
                    gap: 6,
                    alignItems: "center",
                    padding: 9,
                    border: "1px solid #ded9d0",
                    borderRadius: 6,
                  }}
                >
                  <strong style={{ textAlign: "center", fontSize: 10 }}>{index + 1}</strong>
                  <input
                    value={track.title}
                    onChange={(event) => updateTrack(index, "title", event.target.value)}
                    aria-label={`${index + 1}번 곡 제목`}
                    placeholder="곡 제목"
                    style={{ minWidth: 0, height: 30, padding: "0 7px" }}
                  />
                  <input
                    value={track.artist}
                    onChange={(event) => updateTrack(index, "artist", event.target.value)}
                    aria-label={`${index + 1}번 아티스트`}
                    placeholder="아티스트"
                    style={{ minWidth: 0, height: 30, padding: "0 7px" }}
                  />
                  <div style={{ display: "flex", gap: 3 }}>
                    <button type="button" onClick={() => moveTrack(index, -1)} disabled={index === 0}>↑</button>
                    <button type="button" onClick={() => moveTrack(index, 1)} disabled={index === draft.length - 1}>↓</button>
                    <button
                      type="button"
                      onClick={() => setDraft((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                      style={{ color: "#b05a5a" }}
                    >
                      삭제
                    </button>
                  </div>
                  <a
                    href={track.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ gridColumn: "2 / -1", color: "#999288", fontSize: 8 }}
                  >
                    {track.url}
                  </a>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 18 }}>
              <button type="button" onClick={() => setOpen(false)} disabled={saving}>
                취소
              </button>
              <button
                type="button"
                disabled={saving || draft.length === 0}
                onClick={async () => {
                  const saved = await onSave(draft);
                  if (saved) setOpen(false);
                }}
              >
                {saving ? "저장 중…" : "재생목록 전체 저장"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ArchiveLayout({
  isAdmin = false,

  // 현재 선택된 탭
  // "photos" | "videos" | "posts"
  activeTab = "photos",

  // 각 페이지가 자기 검색 state를 넘겨줌
  search = "",
  onSearchChange = () => {},

  // 사진 / 동영상에 따라 placeholder만 변경 가능
  searchPlaceholder = "사진이나 키워드를 검색해보세요",

  // 이 안에 사진 그리드 / 동영상 그리드가 들어감
  children,
}) {
  const [visitorCounts, setVisitorCounts] = useState({ today: 0, total: 0 });
  const [profileImage, setProfileImage] = useState("");
  const [uploadingProfile, setUploadingProfile] = useState(false);
  const [recentUpdateDate, setRecentUpdateDate] = useState("");
  const [bgmPlaylist, setBgmPlaylist] = useState(DEFAULT_BGM_PLAYLIST);
  const [savingBgmPlaylist, setSavingBgmPlaylist] = useState(false);

  async function saveBgmPlaylist(nextPlaylist) {
    setSavingBgmPlaylist(true);

    try {
      const cleaned = nextPlaylist.map((track) => ({
        url: String(track.url || "").trim(),
        artist: String(track.artist || "").trim(),
        title: String(track.title || "").trim(),
      }));

      const { error } = await supabase.from("site_settings").upsert(
        {
          key: "bgm_playlist",
          value: JSON.stringify(cleaned),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" },
      );

      if (error) throw error;

      setBgmPlaylist(cleaned);
      return true;
    } catch (error) {
      console.error("BGM 재생목록 저장 오류:", error);
      alert(`BGM 재생목록을 저장하지 못했습니다.\n${error.message}`);
      return false;
    } finally {
      setSavingBgmPlaylist(false);
    }
  }

  useEffect(() => {
    // =========================
    // 프로필 사진 불러오기
    // =========================

    async function loadProfileImage() {
      const { data, error } = await supabase
        .from("site_settings")
        .select("value")
        .eq("key", "profile_image")
        .maybeSingle();

      if (error) {
        console.error("프로필 사진을 불러오지 못했습니다:", error);
        return;
      }

      setProfileImage(data?.value || "");
    }

    // =========================
    // 프로필 사진 변경
    // =========================

    async function handleProfileImageChange(e) {
      const file = e.target.files?.[0];

      if (!file) return;

      if (!file.type.startsWith("image/")) {
        alert("이미지 파일을 선택해주세요.");
        return;
      }

      setUploadingProfile(true);

      try {
        const oldProfileImage = profileImage;

        const extension = file.name.split(".").pop() || "jpg";

        const path = `profile-${Date.now()}.${extension}`;

        // Storage 업로드
        const { error: uploadError } = await supabase.storage
          .from("profile")
          .upload(path, file, {
            upsert: false,
            contentType: file.type,
          });

        if (uploadError) {
          throw uploadError;
        }

        // 공개 URL
        const { data: urlData } = supabase.storage
          .from("profile")
          .getPublicUrl(path);

        const newProfileImage = urlData.publicUrl;

        // DB에 현재 프로필 사진 저장
        const { error: settingError } = await supabase
          .from("site_settings")
          .upsert(
            {
              key: "profile_image",
              value: newProfileImage,
              updated_at: new Date().toISOString(),
            },
            {
              onConflict: "key",
            },
          );

        if (settingError) {
          throw settingError;
        }

        setProfileImage(newProfileImage);

        // 기존 프로필 이미지 삭제
        if (oldProfileImage) {
          try {
            const marker = "/storage/v1/object/public/profile/";

            const markerIndex = oldProfileImage.indexOf(marker);

            if (markerIndex !== -1) {
              const oldPath = decodeURIComponent(
                oldProfileImage.substring(markerIndex + marker.length),
              );

              await supabase.storage.from("profile").remove([oldPath]);
            }
          } catch (deleteError) {
            console.error("기존 프로필 사진 삭제 오류:", deleteError);
          }
        }
      } catch (error) {
        console.error("프로필 사진 변경 오류:", error);

        alert(`프로필 사진을 변경하지 못했습니다.\n${error.message}`);
      } finally {
        setUploadingProfile(false);

        // 같은 사진을 다시 선택해도
        // onChange가 작동하도록 초기화
        e.target.value = "";
      }
    }
    loadProfileImage();
  }, [isAdmin]);

  useEffect(() => {
    async function loadBgmPlaylist() {
      const { data, error } = await supabase
        .from("site_settings")
        .select("value")
        .eq("key", "bgm_playlist")
        .maybeSingle();

      if (error) {
        console.error("BGM 재생목록을 불러오지 못했습니다:", error);
        return;
      }

      if (!data?.value) return;

      try {
        const parsed =
          typeof data.value === "string" ? JSON.parse(data.value) : data.value;
        const validTracks = Array.isArray(parsed)
          ? parsed.filter((track) => track?.url && track?.title && track?.artist)
          : [];

        if (validTracks.length) setBgmPlaylist(validTracks);
      } catch (error) {
        console.error("저장된 BGM 재생목록 형식이 올바르지 않습니다:", error);
      }
    }

    loadBgmPlaylist();
  }, []);

  useEffect(() => {
    async function loadRecentUpdateDate() {
      const tables = ["photos", "videos", "weverse_posts"];

      const results = await Promise.all(
        tables.map(async (table) => {
          const { data, error } = await supabase
            .from(table)
            .select("date")
            .not("date", "is", null)
            .order("date", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (error) {
            console.error(`${table} 최근 업데이트 날짜 조회 오류:`, error);
            return "";
          }

          return data?.date || "";
        }),
      );

      const latestDate = results.filter(Boolean).sort().at(-1) || "";
      setRecentUpdateDate(latestDate);
    }

    loadRecentUpdateDate();
  }, []);

  useEffect(() => {
    async function registerVisitor() {
      try {
        let visitorId = localStorage.getItem("riwoo_visitor_id");

        if (!visitorId) {
          visitorId =
            window.crypto?.randomUUID?.() ||
            `visitor-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          localStorage.setItem("riwoo_visitor_id", visitorId);
        }

        const { data, error } = await supabase.rpc("register_site_visit", {
          visitor_key: visitorId,
        });

        if (error) throw error;

        const counts = Array.isArray(data) ? data[0] : data;
        setVisitorCounts({
          today: Number(counts?.today_count) || 0,
          total: Number(counts?.total_count) || 0,
        });
      } catch (error) {
        console.error("방문자 수를 불러오지 못했습니다:", error);
      }
    }

    registerVisitor();
  }, []);

  // =========================
  // 프로필 사진 불러오기
  // =========================

  async function loadProfileImage() {
    const { data, error } = await supabase
      .from("site_settings")
      .select("value")
      .eq("key", "profile_image")
      .maybeSingle();

    if (error) {
      console.error("프로필 사진을 불러오지 못했습니다:", error);
      return;
    }

    setProfileImage(data?.value || "");
  }

  // =========================
  // 프로필 사진 변경
  // =========================

  async function handleProfileImageChange(e) {
    const file = e.target.files?.[0];

    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("이미지 파일을 선택해주세요.");
      return;
    }

    setUploadingProfile(true);

    try {
      const extension = file.name.split(".").pop() || "jpg";

      const path = `profile-${Date.now()}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from("profile")
        .upload(path, file, {
          contentType: file.type,
          upsert: false,
        });

      if (uploadError) {
        throw uploadError;
      }

      const { data: urlData } = supabase.storage
        .from("profile")
        .getPublicUrl(path);

      const newProfileImage = urlData.publicUrl;

      const { error: settingError } = await supabase
        .from("site_settings")
        .upsert(
          {
            key: "profile_image",
            value: newProfileImage,
            updated_at: new Date().toISOString(),
          },
          {
            onConflict: "key",
          },
        );

      if (settingError) {
        throw settingError;
      }

      setProfileImage(newProfileImage);
    } catch (error) {
      console.error("프로필 사진 변경 오류:", error);

      alert(`프로필 사진을 변경하지 못했습니다.\n${error.message}`);
    } finally {
      setUploadingProfile(false);
      e.target.value = "";
    }
  }
  // =========================
  // 탭 이동
  // =========================

  function goPhotos() {
    window.location.href = isAdmin ? "/admin" : "/";
  }

  function goVideos() {
    window.location.href = isAdmin ? "/admin/videos" : "/videos";
  }

  function goPosts() {
    window.location.href = "/admin/posts";
  }

  // =========================
  // 화면
  // =========================

  return (
    <div className="page">
      <div className="archive">
        {/* =========================
            공통 상단
        ========================= */}

        <header className="top">
          {/* 공통 검색창 */}
          <div className="search-box">
            <span>⌕</span>

            <input
              type="text"
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>

          {/* 일반 사용자 */}
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

          {/* 관리자 */}
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

        {/* =========================
            공통 메인 프레임
        ========================= */}

        <div className="blue-frame">
          <div className="archive-book-heading">
            <div className="archive-visitor-counter">
              <span>TODAY <strong>{visitorCounts.today}</strong></span>
              <i>|</i>
              <span>TOTAL <strong>{visitorCounts.total}</strong></span>
            </div>

            <div className="archive-book-title">링링일기</div>
          </div>

          {/* =========================
              공통 프로필
          ========================= */}

          <aside className="profile">
            <div className="profile-image">
              {profileImage ? (
                <img src={profileImage} alt="프로필" />
              ) : (
                <span className="profile-image-placeholder">PROFILE</span>
              )}

              {isAdmin && (
                <label className="profile-image-edit">
                  {uploadingProfile ? "업로드 중..." : "사진 변경"}

                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    disabled={uploadingProfile}
                    onChange={handleProfileImageChange}
                  />
                </label>
              )}
            </div>

            <div className="profile-name">링링의 한 마디</div>

            <div className="profile-text">하이류~~~</div>

            <div className="profile-line" />

            {recentUpdateDate && (
              <div
                className="profile-recent-update"
                style={{
                  marginTop: "22px",
                  color: "#999288",
                  fontSize: "9px",
                  letterSpacing: "0.02em",
                }}
              >
                최근 업데이트{" "}
                <strong style={{ color: "#666158", fontWeight: 600 }}>
                  {(() => {
                    const [, month, day] = recentUpdateDate.split("-");
                    return `${Number(month)}월 ${Number(day)}일`;
                  })()}
                </strong>
              </div>
            )}

            <MiniBgmPlayer playlist={bgmPlaylist} />

            {isAdmin && (
              <BgmPlaylistManager
                playlist={bgmPlaylist}
                onSave={saveBgmPlaylist}
                saving={savingBgmPlaylist}
              />
            )}
          </aside>

          {/* =========================
              공통 스프링
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
              공통 콘텐츠 영역
          ========================= */}

          <main className="content">
            {/* =========================
                공통 오른쪽 탭
            ========================= */}

            <div className="archive-side-tabs">
              <button
                type="button"
                className={`archive-side-tab ${
                  activeTab === "photos" ? "active" : ""
                }`}
                onClick={goPhotos}
              >
                사진
              </button>

              <button
                type="button"
                className={`archive-side-tab ${
                  activeTab === "videos" ? "active" : ""
                }`}
                onClick={goVideos}
              >
                동영상
              </button>

              {isAdmin && (
                <button
                  type="button"
                  className={`archive-side-tab ${
                    activeTab === "posts" ? "active" : ""
                  }`}
                  onClick={goPosts}
                >
                  게시글
                </button>
              )}

              <div className="mobile-tab-search">
                <span>⌕</span>
                <input
                  type="text"
                  placeholder={searchPlaceholder}
                  value={search}
                  onChange={(e) => onSearchChange(e.target.value)}
                />
              </div>
            </div>

            {/* =========================
                페이지마다 바뀌는 부분
            ========================= */}

            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

export default ArchiveLayout;
