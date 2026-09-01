import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";
import "./App.css";

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

            <div className="music">♪ 오늘만 I LOVE YOU</div>
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
