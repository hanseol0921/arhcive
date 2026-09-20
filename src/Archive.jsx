import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import ArchiveLayout from "./ArchiveLayout";
import ArchiveFilters from "./ArchiveFilters";
import "./App.css";
import TagPicker from "./TagPicker";
import ContentReport from "./ContentReport";
import { deleteFromR2, getR2Key } from "./r2Storage";
import { getPopularityScore, trackMediaEngagement } from "./mediaPopularity";

function Archive({ isAdmin = false }) {
  const isMobileDevice =
    navigator.userAgentData?.mobile ??
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const isDesktopDevice = !isMobileDevice;
  const [photoType, setPhotoType] = useState("전체");
  const [hairColorFilter, setHairColorFilter] = useState("전체");
  const [search, setSearch] = useState("");
  const [photos, setPhotos] = useState([]);
  const [photoPostTimes, setPhotoPostTimes] = useState({});
  const [copyNotice, setCopyNotice] = useState("");
  const copyNoticeTimerRef = useRef(null);

  const [sortOrder, setSortOrder] = useState("최신순");
  const [videoType, setVideoType] = useState("전체");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [homeExtras, setHomeExtras] = useState({
    scenery: false,
    food: false,
    members: false,
  });

  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [expandedTags, setExpandedTags] = useState(false);
  const [tagsOverflow, setTagsOverflow] = useState(false);
  const detailTagsRef = useRef(null);
  const [zoomedPhoto, setZoomedPhoto] = useState(false);
  const detailPanelRef = useRef(null);
  const photoTriggerRef = useRef(null);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState(() => new Set());
  const [bulkDownloading, setBulkDownloading] = useState(false);
  const [bulkDownloadProgress, setBulkDownloadProgress] = useState("");
  const [tagAliases, setTagAliases] = useState([]);
  const photoModalOpen = selectedPhoto !== null;

  function showCopyNotice(message) {
    window.clearTimeout(copyNoticeTimerRef.current);
    setCopyNotice(message);
    copyNoticeTimerRef.current = window.setTimeout(() => {
      setCopyNotice("");
    }, 1800);
  }

  useEffect(() => {
    return () => window.clearTimeout(copyNoticeTimerRef.current);
  }, []);

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

  const [editType, setEditType] = useState("");
  const [editHairColor, setEditHairColor] = useState("");
  const [editTags, setEditTags] = useState("");
  const [editSearchTags, setEditSearchTags] = useState("");
  const [editWeverseUrl, setEditWeverseUrl] = useState("");
  const [editArchiveVisible, setEditArchiveVisible] = useState(true);

  // 크롭 위치
  const [cropPosition, setCropPosition] = useState("50% 50%");

  const [saving, setSaving] = useState(false);
  const [reportTarget, setReportTarget] = useState(null);

  useEffect(() => {
    const tags = detailTagsRef.current;
    if (!tags || editMode) return;
    const measure = () => setTagsOverflow(tags.scrollHeight > 69);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(tags);
    return () => observer.disconnect();
  }, [selectedPhoto, editMode]);

  useEffect(() => {
    setExpandedTags(false);
    setZoomedPhoto(false);
  }, [selectedPhoto?.id]);

  useEffect(() => {
    if (!photoModalOpen) return;
    photoTriggerRef.current = document.activeElement;
    detailPanelRef.current?.focus();
    return () => photoTriggerRef.current?.focus?.();
  }, [photoModalOpen]);

  function handleDetailKeyDown(event) {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (reportTarget || saving) return;
      if (zoomedPhoto) setZoomedPhoto(false);
      else if (editMode) cancelEdit();
      else setSelectedPhoto(null);
    }
    if (event.key === "Tab") {
      const focusable = [...event.currentTarget.querySelectorAll(
        'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary'
      )].filter((element) => element.getClientRects().length);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    }
  }


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

    // 같은 날짜에 여러 게시글이 있을 때 실제 위버스 게시 시각으로 정렬하기 위해
    // 사진뿐 아니라 연결된 게시글의 posted_at도 끝까지 나눠서 불러온다.
    const allPostTimes = {};
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from("weverse_posts")
        .select("id,date,posted_at,created_at")
        .order("date", { ascending: false })
        .range(from, from + pageSize - 1);

      if (error) {
        console.error("사진 정렬용 게시 시간을 불러오지 못했습니다:", error);
        break;
      }

      (data || []).forEach((post) => {
        const postedTime = post.posted_at
          ? new Date(post.posted_at).getTime()
          : NaN;
        const dateTime = post.date
          ? new Date(`${post.date}T00:00:00+09:00`).getTime()
          : 0;
        const createdTime = post.created_at
          ? new Date(post.created_at).getTime()
          : 0;

        allPostTimes[String(post.id)] = {
          postedTime: Number.isFinite(postedTime) ? postedTime : dateTime,
          createdTime: Number.isFinite(createdTime) ? createdTime : 0,
        };
      });

      if (!data || data.length < pageSize) break;
    }

    setPhotoPostTimes(allPostTimes);
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

      await deleteFromR2([
        getR2Key(photo.image_url),
        getR2Key(photo.thumbnail_url),
      ]);

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

  function downloadPhoto(photo) {
    try {
      const imageUrl = new URL(photo.image_url);
      const pathExtension =
        imageUrl.pathname.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase() || "jpg";
      const extension = pathExtension === "jpeg" ? "jpg" : pathExtension;
      const fileName = `riwoo_${photo.date || "photo"}_${photo.id}.${extension}`;

      /*
        갤럭시의 삼성 인터넷/Chrome에서는 fetch 후 만든 Blob 링크가
        사용자 클릭 다운로드로 인정되지 않는 경우가 있습니다.
        Supabase Storage가 Content-Disposition: attachment로 응답하도록
        원본 공개 URL에 download 파일명을 직접 붙여 다운로드합니다.
      */
      imageUrl.searchParams.set("download", fileName);

      const link = document.createElement("a");
      link.href = imageUrl.toString();
      link.download = fileName;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
      void trackMediaEngagement("photo", photo.id, "download");
    } catch (error) {
      console.error("사진 다운로드 오류:", error);
      window.location.href = photo.image_url;
    }
  }

  function togglePhotoSelection(photoId) {
    setSelectedPhotoIds((current) => {
      const next = new Set(current);
      if (next.has(photoId)) next.delete(photoId);
      else next.add(photoId);
      return next;
    });
  }

  function normalizeWeverseUrl(value) {
    if (!value) return "";
    try {
      const url = new URL(value);
      url.search = "";
      url.hash = "";
      return url.toString().replace(/\/$/, "");
    } catch {
      return String(value).trim();
    }
  }

  function openSelectedWeversePosts() {
    const selectedWithLinks = photos.filter(
      (photo) =>
        selectedPhotoIds.has(photo.id) && normalizeWeverseUrl(photo.weverse_url),
    );
    const urls = [...new Set(
      selectedWithLinks.map((photo) => normalizeWeverseUrl(photo.weverse_url)),
    )];

    if (!urls.length) {
      showCopyNotice("선택한 사진에 위버스 링크가 없습니다.");
      return;
    }

    selectedWithLinks.forEach((photo) => {
      void trackMediaEngagement("photo", photo.id, "weverse");
    });
    urls.forEach((url) => window.open(url, "_blank", "noopener,noreferrer"));
    showCopyNotice(`중복을 제외한 위버스 게시글 ${urls.length}개를 열었습니다.`);
  }

  async function downloadSelectedPhotos() {
    const selected = filteredPhotos.filter((photo) => selectedPhotoIds.has(photo.id));
    if (!selected.length || bulkDownloading) return;

    setBulkDownloading(true);
    setBulkDownloadProgress(`0 / ${selected.length}`);

    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      const failed = [];

      for (let index = 0; index < selected.length; index++) {
        const photo = selected[index];
        try {
          const response = await fetch(photo.image_url);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const blob = await response.blob();
          const mimeExtension = blob.type?.startsWith("image/")
            ? blob.type.split("/")[1]?.split("+")[0]?.toLowerCase()
            : "";
          const urlExtension = new URL(photo.image_url).pathname
            .match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase();
          const rawExtension = mimeExtension || urlExtension || "jpg";
          const extension = rawExtension === "jpeg" ? "jpg" : rawExtension;
          const order = String(index + 1).padStart(String(selected.length).length, "0");
          zip.file(`${order}_riwoo_${photo.date || "photo"}_${photo.id}.${extension}`, blob);
          void trackMediaEngagement("photo", photo.id, "download");
        } catch (error) {
          console.error("묶음 다운로드 사진 불러오기 오류:", photo.id, error);
          failed.push(photo.id);
        }
        setBulkDownloadProgress(`${index + 1} / ${selected.length}`);
      }

      if (failed.length === selected.length) {
        throw new Error("선택한 사진을 불러오지 못했습니다.");
      }

      setBulkDownloadProgress("ZIP 만드는 중…");
      const zipBlob = await zip.generateAsync({ type: "blob", compression: "STORE" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(zipBlob);
      link.download = `riwoo_archive_${new Date().toISOString().slice(0, 10)}_${selected.length}photos.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);

      showCopyNotice(
        failed.length
          ? `${selected.length - failed.length}장 다운로드 완료 · ${failed.length}장 실패`
          : `${selected.length}장 다운로드를 시작했습니다.`,
      );
    } catch (error) {
      console.error("사진 묶음 다운로드 오류:", error);
      showCopyNotice(error.message || "사진 묶음 다운로드에 실패했습니다.");
    } finally {
      setBulkDownloading(false);
      setBulkDownloadProgress("");
    }
  }

  async function sharePhoto(photo) {
    try {
      const response = await fetch(photo.image_url);

      if (!response.ok) {
        throw new Error("공유할 사진을 불러오지 못했습니다.");
      }

      const blob = await response.blob();
      const responseExtension = blob.type?.startsWith("image/")
        ? blob.type.split("/")[1]?.split("+")[0]?.toLowerCase()
        : "";
      const urlExtension =
        new URL(photo.image_url).pathname.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase();
      const rawExtension = responseExtension || urlExtension || "jpg";
      const extension = rawExtension === "jpeg" ? "jpg" : rawExtension;
      const fileName = `riwoo_${photo.date || "photo"}_${photo.id}.${extension}`;
      const mimeByExtension = {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        webp: "image/webp",
        gif: "image/gif",
      };
      const fileType = blob.type?.startsWith("image/")
        ? blob.type
        : mimeByExtension[extension] || "image/jpeg";
      const file = new File([blob], fileName, {
        type: fileType,
      });
      const isMobileDevice =
        navigator.userAgentData?.mobile ??
        /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      const shareData = isMobileDevice
        ? { files: [file] }
        : {
            files: [file],
            title: "리우 아카이브",
            text: "리우 아카이브 사진",
            url: window.location.href,
          };
      let fileShareError = null;

      if (typeof navigator.share === "function") {
        try {
          // 일부 모바일 브라우저는 실제 공유가 가능해도
          // navigator.canShare({ files })를 false로 잘못 반환하므로
          // canShare 판정만으로 PC용 경로로 보내지 않고 직접 시도합니다.
          await navigator.share(shareData);
          return;
        } catch (shareError) {
          if (shareError?.name === "AbortError") return;
          fileShareError = shareError;
          console.error("사진 파일 직접 공유 실패:", shareError);
        }
      }

      alert(
        `현재 앱 안의 브라우저에서는 사진 파일을 공유할 수 없습니다${
          fileShareError?.name ? ` (${fileShareError.name})` : ""
        }. 메뉴에서 '기본 브라우저로 열기'를 선택한 뒤 다시 공유해주세요.`,
      );
    } catch (error) {
      if (error?.name === "AbortError") return;

      console.error("사진 공유 오류:", error);
      alert(
        "이 브라우저에서 사진 파일을 공유하지 못했습니다. 브라우저의 파일 다운로드 및 공유 권한을 확인해주세요.",
      );
    }
  }

  async function copyPhotoToClipboard(photo) {
    try {
      if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
        throw new Error("사진 클립보드 복사를 지원하지 않는 브라우저입니다.");
      }

      const response = await fetch(photo.image_url);
      if (!response.ok) throw new Error("사진을 불러오지 못했습니다.");

      const sourceBlob = await response.blob();
      let clipboardBlob = sourceBlob;

      // Windows Chrome/Edge의 이미지 붙여넣기는 PNG가 가장 안정적입니다.
      if (sourceBlob.type !== "image/png") {
        const bitmap = await createImageBitmap(sourceBlob);
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;

        const context = canvas.getContext("2d");
        if (!context) throw new Error("사진 변환 화면을 만들지 못했습니다.");
        context.drawImage(bitmap, 0, 0);
        bitmap.close?.();

        clipboardBlob = await new Promise((resolve, reject) => {
          canvas.toBlob(
            (blob) =>
              blob
                ? resolve(blob)
                : reject(new Error("사진을 PNG로 변환하지 못했습니다.")),
            "image/png",
          );
        });
      }

      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": clipboardBlob }),
      ]);
      showCopyNotice("사진이 복사되었습니다");
    } catch (error) {
      console.error("사진 복사 오류:", error);
      alert(
        "사진을 복사하지 못했습니다. Chrome 또는 Edge에서 클립보드 권한을 허용한 뒤 다시 시도해주세요.",
      );
    }
  }

  // =========================
  // 검색 / 필터
  // =========================

const hairColorAliases = {
  흑발: ["검머", "검은머리", "검정머리", "블랙", "톤다운"],
  갈발: ["갈머", "갈색머리", "브라운", "염색"],
  금발: ["금머", "노란머리", "블론드", "탈색"],
  적발: ["빨간머리", "빨머", "염색"],
  은발: ["백발", "실버", "하얀머리", "탈색"],
  핑머: ["핑크머리", "분홍머리", "염색"],
  주머: ["주황머리", "오렌지머리", "염색"],
  와인: ["와인머리", "버건디", "버건디머리", "염색"],
  베이지: ["베이지머리", "염색"],
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

  function getHomeExtraGroups(photo) {
    const realTags = Array.isArray(photo.tags) ? photo.tags : [];
    return {
      scenery: realTags.includes("풍경"),
      food: realTags.includes("음식"),
      members: ["성호", "명재현", "태산", "이한", "운학"]
        .some((name) => realTags.includes(name)),
    };
  }

  function isVisibleOnPublicHome(photo) {
    const groups = getHomeExtraGroups(photo);
    const extraKeys = Object.keys(groups).filter((key) => groups[key]);

    // 분류 태그가 있는 사진은 개별 공개값 대신 홈 토글을 따른다.
    if (extraKeys.length) {
      return extraKeys.some((key) => homeExtras[key]);
    }

    return photo.archive_visible !== false;
  }

  const filteredPhotos =
    photos
      .filter((photo) => {
        if (!isAdmin && !isVisibleOnPublicHome(photo)) {
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
        const descending = sortOrder !== "오래된순";

        if (sortOrder === "인기순") {
          const popularityDiff = getPopularityScore(b) - getPopularityScore(a);
          if (popularityDiff !== 0) return popularityDiff;
        }

        const aPostKey = a.post_id || `photo-${a.id}`;
        const bPostKey = b.post_id || `photo-${b.id}`;

        // 같은 게시글 안에서도 앞 번호는 오래된 사진, 뒤 번호는 최신 사진으로 본다.
        // 따라서 오래된순은 1 → 2 → 3, 최신순은 3 → 2 → 1로 표시한다.
        if (aPostKey === bPostKey) {
          const mediaOrderDiff =
            Number(a.media_order ?? a.upload_order ?? 0) -
            Number(b.media_order ?? b.upload_order ?? 0);

          if (mediaOrderDiff !== 0) {
            return descending
              ? -mediaOrderDiff
              : mediaOrderDiff;
          }

          // 순서값까지 같은 경우에도 결과가 새로고침마다 섞이지 않게 고정한다.
          const idDiff = String(a.id).localeCompare(String(b.id));
          return descending ? -idDiff : idDiff;
        }

        const aDate = new Date(a.date || 0).getTime();
        const bDate = new Date(b.date || 0).getTime();
        const dateDiff =
          descending
            ? bDate - aDate
            : aDate - bDate;

        if (dateDiff !== 0) return dateDiff;

        // 날짜가 같다면 사진 업로드 시각이 아니라 원본 위버스 게시 시각을 우선한다.
        const aPostTime = photoPostTimes[String(a.post_id)]?.postedTime || 0;
        const bPostTime = photoPostTimes[String(b.post_id)]?.postedTime || 0;
        const postedTimeDiff =
          descending
            ? bPostTime - aPostTime
            : aPostTime - bPostTime;

        if (postedTimeDiff !== 0) return postedTimeDiff;

        const aPostCreatedTime = photoPostTimes[String(a.post_id)]?.createdTime || 0;
        const bPostCreatedTime = photoPostTimes[String(b.post_id)]?.createdTime || 0;
        const postCreatedDiff =
          descending
            ? bPostCreatedTime - aPostCreatedTime
            : aPostCreatedTime - bPostCreatedTime;

        if (postCreatedDiff !== 0) return postCreatedDiff;

        const aKey = postSortKeys.get(aPostKey) || {};
        const bKey = postSortKeys.get(bPostKey) || {};
        const orderDiff =
          descending
            ? (bKey.uploadOrder ?? 0) - (aKey.uploadOrder ?? 0)
            : (aKey.uploadOrder ?? 0) - (bKey.uploadOrder ?? 0);

        if (orderDiff !== 0) return orderDiff;

        const createdDiff =
          descending
            ? (bKey.createdTime ?? 0) - (aKey.createdTime ?? 0)
            : (aKey.createdTime ?? 0) - (bKey.createdTime ?? 0);

        if (createdDiff !== 0) return createdDiff;
        return String(aPostKey).localeCompare(String(bPostKey));
      });

  const visiblePhotoCount = photos.filter(
    (photo) => {
      if (isAdmin) return photo.archive_visible !== false;
      return isVisibleOnPublicHome(photo);
    },
  ).length;

  // =========================
  // 화면
  // =========================

  return (
    <>
      {copyNotice && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            left: "50%",
            bottom: "28px",
            zIndex: 3000,
            transform: "translateX(-50%)",
            padding: "9px 14px",
            border: "1px solid rgba(255,255,255,.25)",
            borderRadius: "5px",
            background: "rgba(60, 57, 52, .9)",
            boxShadow: "0 5px 18px rgba(0,0,0,.18)",
            color: "#fff",
            fontSize: "11px",
            whiteSpace: "nowrap",
            pointerEvents: "none",
          }}
        >
          {copyNotice}
        </div>
      )}

      <ArchiveLayout
        isAdmin={isAdmin}
        activeTab="photos"
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="사진이나 키워드를 검색해보세요"
      >
        <div className="archive-media-count" aria-label="사진 개수">
          {isAdmin ? (
            <>
              <span>
                ARCHIVE <strong>{visiblePhotoCount}</strong>
              </span>
              <i>/</i>
              <span>
                TOTAL <strong>{photos.length}</strong>
              </span>
            </>
          ) : (
            <span>
              TOTAL <strong>{visiblePhotoCount}</strong>
            </span>
          )}
        </div>

        {!isAdmin && (
          <div className="home-extra-toggles" aria-label="홈 사진 종류 선택">
            <span>함께 보기</span>
            {[
              ["scenery", "풍경"],
              ["food", "음식"],
              ["members", "멤버"],
            ].map(([key, label]) => (
              <button
                type="button"
                key={key}
                className={homeExtras[key] ? "active" : ""}
                aria-pressed={homeExtras[key]}
                onClick={() =>
                  setHomeExtras((current) => ({
                    ...current,
                    [key]: !current[key],
                  }))
                }
              >
                {label}
              </button>
            ))}
          </div>
        )}

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
          secondaryOptions={[
            "흑발",
            "갈발",
            "금발",
            "적발",
            "은발",
            "핑머",
            "주머",
            "와인색",
          ]}
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

        {selectedPhotoIds.size > 0 && (
          <div className="photo-selection-toolbar">
            <strong>{selectedPhotoIds.size}장 선택</strong>
            <button
              type="button"
              onClick={downloadSelectedPhotos}
              disabled={bulkDownloading}
            >
              {bulkDownloading
                ? `다운로드 ${bulkDownloadProgress}`
                : "한 번에 다운로드"}
            </button>
            <button type="button" onClick={openSelectedWeversePosts}>
              위버스 바로가기
            </button>
            <button
              type="button"
              className="photo-selection-clear"
              onClick={() => setSelectedPhotoIds(new Set())}
            >
              선택 해제
            </button>
          </div>
        )}

        <div className="photo-grid">
          {filteredPhotos.map((photo) => (
            <div
              className={`photo-item ${selectedPhotoIds.has(photo.id) ? "is-selected" : ""}`}
              key={photo.id}
              onClick={() => {
                setSelectedPhoto(photo);
                setEditMode(false);
                void trackMediaEngagement("photo", photo.id, "view");
              }}
            >
              <label
                className="photo-select-control"
                onClick={(event) => event.stopPropagation()}
                aria-label="사진 선택"
              >
                <input
                  type="checkbox"
                  checked={selectedPhotoIds.has(photo.id)}
                  onChange={() => togglePhotoSelection(photo.id)}
                />
                <span>✓</span>
              </label>
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
        <div
          className="photo-modal photo-detail-overlay"
          onClick={() => {
            if (!editMode && !saving) setSelectedPhoto(null);
          }}
        >
          <div
            ref={detailPanelRef}
            className={`photo-modal-content photo-detail-panel ${editMode ? "is-editing" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={editMode ? "사진 정보 수정" : "사진 상세"}
            tabIndex={-1}
            onKeyDown={handleDetailKeyDown}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="photo-detail-header">
              {!editMode ? (
                <details className="content-detail-menu photo-detail-menu">
                  <summary aria-label="사진 메뉴">⋯</summary>
                  <div>
                    <button
                      type="button"
                      onClick={() =>
                        setReportTarget({
                          type: "photo",
                          id: selectedPhoto.id,
                          label: `${selectedPhoto.date || ""} 사진`.trim(),
                          previewUrl:
                            selectedPhoto.thumbnail_url ||
                            selectedPhoto.image_url,
                          pageUrl:
                            selectedPhoto.weverse_url || window.location.href,
                        })
                      }
                    >
                      태그 제안 · 수정 요청
                    </button>
                    <button
                      type="button"
                      onClick={() => sharePhoto(selectedPhoto)}
                    >
                      공유
                    </button>
                    {isDesktopDevice && (
                      <button
                        type="button"
                        onClick={() => copyPhotoToClipboard(selectedPhoto)}
                      >
                        사진 복사
                      </button>
                    )}
                    {isAdmin && (
                      <>
                        <button
                          type="button"
                          onClick={() => openEditMode(selectedPhoto)}
                        >
                          사진 정보 수정
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeletePhoto(selectedPhoto)}
                        >
                          사진 삭제
                        </button>
                      </>
                    )}
                  </div>
                </details>
              ) : (
                <strong>사진 정보 수정</strong>
              )}
              <button
                type="button"
                className="photo-detail-close"
                disabled={saving}
                aria-label={
                  editMode ? "수정 취소하고 상세로 돌아가기" : "사진 상세 닫기"
                }
                onClick={() =>
                  editMode ? cancelEdit() : setSelectedPhoto(null)
                }
              >
                ×
              </button>
            </header>

            {!editMode && (
              <button
                type="button"
                className="modal-image photo-detail-image"
                aria-label="사진 원본 확대 보기"
                onClick={() => setZoomedPhoto(true)}
              >
                <img
                  className="modal-image-main"
                  src={selectedPhoto.image_url}
                  alt="선택한 사진"
                />
              </button>
            )}

            <div className="modal-info">
              {!editMode ? (
                <>
                  <div className="modal-date">{selectedPhoto.date}</div>
                  {selectedPhoto.tags?.length > 0 && (
                    <>
                      <div
                        ref={detailTagsRef}
                        className={`modal-tags photo-detail-tags ${expandedTags ? "is-expanded" : ""}`}
                        id="photo-detail-tags"
                        onFocusCapture={() => {
                          if (tagsOverflow) setExpandedTags(true);
                        }}
                      >
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
                      {tagsOverflow && (
                        <button
                          type="button"
                          className="photo-tags-toggle"
                          aria-expanded={expandedTags}
                          aria-controls="photo-detail-tags"
                          onClick={() => setExpandedTags((value) => !value)}
                        >
                          {expandedTags ? "태그 접기" : "태그 더보기"}
                        </button>
                      )}
                    </>
                  )}
                  <div className="photo-detail-actions">
                    <button
                      type="button"
                      className="media-download-button"
                      onClick={() => downloadPhoto(selectedPhoto)}
                    >
                      다운로드 ↓
                    </button>
                    {selectedPhoto.weverse_url && (
                      <a
                        className="weverse-link"
                        href={selectedPhoto.weverse_url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={() =>
                          void trackMediaEngagement(
                            "photo",
                            selectedPhoto.id,
                            "weverse",
                          )
                        }
                      >
                        위버스 바로가기 ↗
                      </a>
                    )}
                  </div>
                </>
              ) : (
                /* =========================
                   수정 화면
                ========================= */

                <div className="edit-form">
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
                    <option value="와인">와인</option>
                    <option value="베이지">베이지</option>
                  </select>

                  {/* 태그 */}

                  <label>태그</label>

                  <TagPicker value={editTags} onChange={setEditTags} />

                  {/* 위버스 */}

                  <label>위버스 링크</label>

                  <input
                    type="url"
                    value={editWeverseUrl}
                    onChange={(e) => setEditWeverseUrl(e.target.value)}
                  />
                </div>
              )}
            </div>
            {editMode && (
              <div className="edit-actions">
                <button type="button" onClick={cancelEdit} disabled={saving}>
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
            )}
            {zoomedPhoto && !editMode && (
              <div
                className="photo-detail-zoom"
                onClick={() => setZoomedPhoto(false)}
              >
                <button
                  type="button"
                  className="photo-detail-zoom-close"
                  aria-label="원본 확대 닫기"
                  onClick={() => setZoomedPhoto(false)}
                >
                  ×
                </button>
                <img src={selectedPhoto.image_url} alt="확대한 원본 사진" />
              </div>
            )}
          </div>
        </div>
      )}
      <ContentReport
        target={reportTarget}
        onClose={() => setReportTarget(null)}
      />
    </>
  );
}

export default Archive;
