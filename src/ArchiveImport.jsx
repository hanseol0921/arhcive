import {
  useEffect,
  useRef,
  useState,
} from "react";

import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import { supabase } from "./supabaseClient";
import "./App.css";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  pdfWorker;

function ArchiveImport() {
  // 불러온 게시글 초안
  const [drafts, setDrafts] =
    useState([]);

  // 폴더/PDF 분석 중 여부
  const [parsing, setParsing] =
    useState(false);

  // 선택 가능한 게시글 폴더 목록
  const [foundGroups, setFoundGroups] =
    useState([]);

  // 체크한 게시글 폴더
  const [
    selectedFolderPaths,
    setSelectedFolderPaths,
  ] = useState([]);

  // 900개 이상 폴더를 한꺼번에 화면에 만들지 않도록
  // 발견 목록은 50개씩 나눠서 표시
  const [importPage, setImportPage] =
    useState(1);

  const IMPORT_PAGE_SIZE = 50;

  const objectUrlsRef =
    useRef([]);

  // =========================
  // preview URL 정리
  // =========================

  useEffect(() => {
    return () => {
      objectUrlsRef.current.forEach(
        (url) =>
          URL.revokeObjectURL(url)
      );
    };
  }, []);

  function makePreviewUrl(file) {
    const url =
      URL.createObjectURL(file);

    objectUrlsRef.current.push(url);

    return url;
  }

  // =========================
  // 고유 ID
  // =========================

  function makeId() {
    return crypto.randomUUID();
  }

  // =========================
  // 폴더명에서 날짜 추출
  //
  // 2026-08-22
  // 2026-08-22_2
  // 2026-08-22_3
  //
  // 전부 2026-08-22 반환
  // =========================

  function getDateFromFolderName(
    folderName
  ) {
    const match =
      folderName.match(
        /^(\d{4}-\d{2}-\d{2})(?:_\d+)?/
      );

    return match
      ? match[1]
      : "";
  }

  // =========================
  // 자연 정렬
  //
  // _2가 _10보다 먼저 오도록
  // =========================

  function naturalCompare(a, b) {
    return a.localeCompare(
      b,
      undefined,
      {
        numeric: true,
        sensitivity: "base",
      }
    );
  }

  // =========================
  // 파일명
  // =========================

  function getBaseName(file) {
    return file.name.toLowerCase();
  }

  function isPdf(file) {
    return (
      file.type ===
        "application/pdf" ||
      getBaseName(file).endsWith(
        ".pdf"
      )
    );
  }

  function isImage(file) {
    return (
      file.type.startsWith(
        "image/"
      ) ||
      /\.(jpg|jpeg|png|webp)$/i.test(
        file.name
      )
    );
  }

  function isVideo(file) {
    return (
      file.type.startsWith(
        "video/"
      ) ||
      /\.(mp4|mov|webm|m4v)$/i.test(
        file.name
      )
    );
  }

  // =========================
  // 영상 썸네일 파일인지
  //
  // *_thumb.jpg는
  // 일반 사진으로 올리면 안 됨
  // =========================

  function isVideoThumbnail(file) {
    return /(?:video.*_thumb|_thumb)\.(jpg|jpeg|png|webp)$/i.test(
      file.name
    );
  }

  // =========================
  // PDF 텍스트 읽기
  // =========================

  async function readPdfText(file) {
  const buffer =
    await file.arrayBuffer();

  const pdf =
    await pdfjsLib.getDocument({
      data: buffer,
    }).promise;

  const pages = [];

  for (
    let pageNumber = 1;
    pageNumber <= pdf.numPages;
    pageNumber++
  ) {
    const page =
      await pdf.getPage(pageNumber);

    const content =
      await page.getTextContent();

    const lines = [];

    for (const item of content.items) {
      if (
        !item.str ||
        !item.transform
      ) {
        continue;
      }

      const x =
        item.transform[4];

      const y =
        item.transform[5];

      // 같은 줄인지 판단할 Y좌표 오차
      const tolerance = 2;

      let line =
        lines.find(
          (existingLine) =>
            Math.abs(
              existingLine.y - y
            ) <= tolerance
        );

      if (!line) {
        line = {
          y,
          items: [],
        };

        lines.push(line);
      }

      line.items.push({
        x,
        text: item.str,
      });
    }

    // PDF는 위쪽일수록 y값이 큼
    lines.sort(
      (a, b) => b.y - a.y
    );

    const pageLines =
      lines.map((line) => {
        // 같은 줄 안에서는
        // 왼쪽 → 오른쪽 순서
        line.items.sort(
          (a, b) => a.x - b.x
        );

        return line.items
          .map(
            (item) => item.text
          )
          .join("")
          .trim();
      });

    pages.push(
      pageLines
        .filter(Boolean)
        .join("\n")
    );
  }

  return pages.join("\n");
}

  // =========================
  // PDF 정보 분석
  // =========================

  function parsePdfMetadata(
  text,
  fallbackDate
) {
  // PDF.js가 글자를 여러 text item으로
  // 쪼개도 최대한 정상적으로 읽게 정리
  const normalizedText = String(
    text || ""
  )
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();

  // =========================
  // 날짜 + 시간
  // =========================

  const dateTimeMatch =
    normalizedText.match(
      /(\d{4}-\d{2}-\d{2})[\s\n]+(\d{1,2}:\d{2})/
    );

  const date =
    dateTimeMatch?.[1] ||
    fallbackDate ||
    "";

  const time =
    dateTimeMatch?.[2]
      ? dateTimeMatch[2].padStart(
          5,
          "0"
        )
      : "";

  // =========================
  // 원본 링크
  // =========================

  const linkMatch =
    normalizedText.match(
      /원본\s*링크\s*:\s*(https?:\/\/[^\s]+)/i
    );

  const weverseUrl =
    linkMatch?.[1] || "";

  // =========================
  // 본문
  //
  // "원본 링크" 뒤부터
  // 첫 사진/영상 표시 전까지
  //
  // 줄 단위가 아니라 전체 텍스트에서
  // 위치를 찾아 잘라냄
  // =========================

  let content = "";

  if (linkMatch) {
    const linkEndIndex =
      linkMatch.index +
      linkMatch[0].length;

    let afterLink =
      normalizedText
        .slice(linkEndIndex)
        .trim();

    // 첫 미디어 표시 위치
    const mediaMatch =
      afterLink.match(
        /(?:^|\n|\s)(?:사진|영상)\s*\d+/i
      );

    if (
      mediaMatch &&
      mediaMatch.index !== undefined
    ) {
      afterLink =
        afterLink.slice(
          0,
          mediaMatch.index
        );
    }

    content =
      afterLink
        .split("\n")
        .map((line) =>
          line.trim()
        )
        .filter(Boolean)
        .join("\n")
        .trim();
  }

  return {
    date,
    time,
    weverseUrl,
    content,
  };
}

  // =========================
  // PDF에서 영상 원본 파일명 순서
  // =========================

  function extractVideoNames(
    pdfText
  ) {
    const matches = [
      ...pdfText.matchAll(
        /([^\s()]+?\.(?:mp4|mov|webm|m4v))/gi
      ),
    ];

    const names = [];

    matches.forEach((match) => {
      const name =
        match[1];

      if (
        !names.some(
          (existing) =>
            existing.toLowerCase() ===
            name.toLowerCase()
        )
      ) {
        names.push(name);
      }
    });

    return names;
  }

  // =========================
// =========================
// 대용량 백업 폴더 탐색
//
// 중요: 여기서는 File을 읽지 않고
// DirectoryHandle만 보관한다.
// 900개 폴더의 JPG/MP4/PDF를 한 번에
// 메모리에 올리지 않기 위한 구조.
// =========================

async function collectPostFolders(
  directoryHandle,
  parentPath = ""
) {
  const groups = [];

  for await (const [name, handle] of
    directoryHandle.entries()) {
    if (handle.kind !== "directory") {
      continue;
    }

    const folderPath = parentPath
      ? `${parentPath}/${name}`
      : name;

    const lowerPath =
      folderPath.toLowerCase();

    // 모먼트는 일반 게시글 가져오기에서 제외
    if (lowerPath.includes("모먼트")) {
      continue;
    }

    // 날짜로 시작하는 폴더 = 게시글 폴더
    if (/^\d{4}-\d{2}-\d{2}/.test(name)) {
      groups.push({
        folderPath,
        folderName: name,
        directoryHandle: handle,
      });
      continue;
    }

    // 날짜 폴더가 더 아래에 있을 수도 있으므로
    // 상위 분류 폴더만 재귀 탐색
    const childGroups =
      await collectPostFolders(
        handle,
        folderPath
      );

    groups.push(...childGroups);
  }

  return groups;
}

async function readFilesFromDirectoryHandle(
  directoryHandle
) {
  const files = [];

  async function walk(handle) {
    for await (const [, child] of
      handle.entries()) {
      if (child.kind === "file") {
        files.push(
          await child.getFile()
        );
      } else if (
        child.kind === "directory"
      ) {
        await walk(child);
      }
    }
  }

  await walk(directoryHandle);
  return files;
}

  // =========================
  // 폴더 하나 → 초안 하나
  // =========================

  async function createDraft(
    group
  ) {
    const {
      folderPath,
      folderName,
      directoryHandle,
    } = group;

    // 이 게시글을 실제로 초안으로 만들 때만
    // 해당 폴더의 파일을 읽는다.
    const files = group.files ||
      await readFilesFromDirectoryHandle(
        directoryHandle
      );

    const fallbackDate =
      getDateFromFolderName(
        folderName
      );

    // =========================
// 멤버쉽 게시글 여부
// =========================

const isMembership =
  folderPath
    .toLowerCase()
    .includes(
      "멤버쉽"
    ) ||
  folderPath
    .toLowerCase()
    .includes(
      "멤버십"
    );  

    // PDF
    const pdfFile =
      files.find(isPdf);

    let pdfText = "";

    let metadata = {
      date: fallbackDate,
      time: "",
      content: "",
      weverseUrl: "",
    };

    if (pdfFile) {
      try {
        pdfText =
          await readPdfText(
            pdfFile
          );

        metadata =
          parsePdfMetadata(
            pdfText,
            fallbackDate
          );
      } catch (error) {
        console.error(
          `${folderPath} PDF 읽기 실패`,
          error
        );
      }
    }

    // =========================
    // 사진
    //
    // 영상 썸네일 제외
    // =========================

    const imageFiles =
      files
        .filter(
          (file) =>
            isImage(file) &&
            !isVideoThumbnail(
              file
            )
        )
        .sort((a, b) =>
          naturalCompare(
            a.name,
            b.name
          )
        );

    // =========================
    // 동영상
    // =========================

    const videoFiles =
      files
        .filter(isVideo)
        .sort((a, b) =>
          naturalCompare(
            a.name,
            b.name
          )
        );

    // PDF에서 발견한 영상 파일명
    const pdfVideoNames =
      extractVideoNames(
        pdfText
      );

    // =========================
    // 사진 객체
    // =========================

    const photoItems = imageFiles.map((file) => ({
      id: makeId(),

      kind: "photo",

      file,

      fileName: file.name,

      previewUrl: makePreviewUrl(file),

      type: "셀카",

      hairColor: "",

      archiveVisible: true,

      // ★ 멤버쉽 폴더면 자동 태그
      tags: isMembership 
        ? "멤버쉽"
        : "",

      searchTags: "",

      cropX: 50,
      cropY: 50,
    }));

    // =========================
    // 영상 객체
    // =========================

    const videoItems =
      videoFiles.map(
        (file) => {
          // 대응되는 thumb 찾기
          const base =
            file.name.replace(
              /\.[^.]+$/,
              ""
            );

          const thumbnailFile =
            files.find(
              (candidate) =>
                isImage(
                  candidate
                ) &&
                candidate.name
                  .toLowerCase()
                  .includes(
                    base
                      .replace(
                        /_\d+$/,
                        ""
                      )
                      .toLowerCase()
                  ) &&
                /_thumb\./i.test(
                  candidate.name
                )
            );

          return {
            id: makeId(),

            kind: "video",

            type: "셀카",

            file,

            fileName:
              file.name,

            previewUrl:
              makePreviewUrl(
                file
              ),

            thumbnailFile:
              thumbnailFile ||
              null,

            thumbnailPreviewUrl:
              thumbnailFile
                ? makePreviewUrl(
                    thumbnailFile
                  )
                : "",

            cropX: 50,
            cropY: 50,
          };
        }
      );

    // =========================
    // 미디어 순서
    //
    // 현재 백업 형식에서는
    // 사진 번호 순 → 영상 순
    //
    // PDF에 영상 파일명이 있으면
    // PDF의 영상 파일명 순서 우선
    // =========================

    const sortedVideos = [
      ...videoItems,
    ].sort((a, b) => {
      const aIndex =
        pdfVideoNames.findIndex(
          (name) =>
            name.toLowerCase() ===
            a.fileName.toLowerCase()
        );

      const bIndex =
        pdfVideoNames.findIndex(
          (name) =>
            name.toLowerCase() ===
            b.fileName.toLowerCase()
        );

      if (
        aIndex !== -1 &&
        bIndex !== -1
      ) {
        return aIndex - bIndex;
      }

      if (aIndex !== -1) {
        return -1;
      }

      if (bIndex !== -1) {
        return 1;
      }

      return naturalCompare(
        a.fileName,
        b.fileName
      );
    });

    const media = [
      ...photoItems,
      ...sortedVideos,
    ];

    return {
      // ★ 날짜가 아니라
      // 폴더 경로 기반 고유 ID
      id: makeId(),

      folderPath,
      folderName,

      pdfFile:
        pdfFile || null,

      pdfFound:
        Boolean(pdfFile),

      postDate:
        metadata.date,

      postTime:
        metadata.time,

      postAuthor:
        "리우",

      postContent:
        metadata.content,

      postWeverseUrl:
        metadata.weverseUrl,

      media,

      status: "draft",

      error: "",
    };
  }

async function chooseArchiveRoot() {
  if (!("showDirectoryPicker" in window)) {
    alert(
      "이 브라우저에서는 대용량 폴더 선택 기능을 사용할 수 없습니다. Chrome/Edge/Whale 최신 버전에서 열어주세요."
    );
    return;
  }

  setParsing(true);

  try {
    const rootHandle =
      await window.showDirectoryPicker({
        mode: "read",
      });

    const groups =
      await collectPostFolders(
        rootHandle,
        rootHandle.name
      );

    groups.sort((a, b) =>
      naturalCompare(
        b.folderPath,
        a.folderPath
      )
    );

    setFoundGroups(groups);
    setSelectedFolderPaths([]);
    setImportPage(1);

    if (groups.length === 0) {
      alert(
        "날짜 이름의 게시글 폴더를 찾지 못했습니다."
      );
    }
  } catch (error) {
    // 사용자가 폴더 선택 창을 취소한 경우는 오류 표시 X
    if (error?.name !== "AbortError") {
      console.error(
        "백업 폴더 탐색 오류:",
        error
      );
      alert(
        `폴더를 읽는 중 오류가 발생했습니다.\n${error.message}`
      );
    }
  } finally {
    setParsing(false);
  }
}

function toggleImportFolder(
  folderPath
) {
  setSelectedFolderPaths(
    (prev) => {

      if (
        prev.includes(
          folderPath
        )
      ) {
        return prev.filter(
          (path) =>
            path !==
            folderPath
        );
      }

      return [
        ...prev,
        folderPath,
      ];
    }
  );
}


function selectAllImportFolders() {
  const start =
    (importPage - 1) *
    IMPORT_PAGE_SIZE;

  const pagePaths =
    foundGroups
      .slice(
        start,
        start + IMPORT_PAGE_SIZE
      )
      .map(
        (group) =>
          group.folderPath
      );

  setSelectedFolderPaths(
    pagePaths
  );
}


function clearImportFolders() {
  setSelectedFolderPaths([]);
}

async function loadSelectedFolders() {
  if (
    selectedFolderPaths.length ===
    0
  ) {
    alert(
      "불러올 게시글 폴더를 선택해주세요."
    );

    return;
  }

  setParsing(true);

  try {

    const selectedGroups =
      foundGroups.filter(
        (group) =>
          selectedFolderPaths.includes(
            group.folderPath
          )
      );

    const newDrafts = [];
    let skippedDuplicateCount = 0;

    // 이미 DB에 등록된 Weverse 원본 링크를 한 번만 가져온다.
    // 각 폴더마다 DB를 다시 조회하지 않아도 되도록 Set으로 보관한다.
    const {
      data: existingPostRows,
      error: existingPostError,
    } = await supabase
      .from("weverse_posts")
      .select("weverse_url")
      .not("weverse_url", "is", null);

    if (existingPostError) {
      throw existingPostError;
    }

    const existingPostUrls = new Set(
      (existingPostRows || [])
        .map((row) =>
          String(row.weverse_url || "").trim()
        )
        .filter(Boolean)
    );

    for (
      const group of
      selectedGroups
    ) {
      const draft =
        await createDraft(
          group
        );

      const draftUrl = String(
        draft.postWeverseUrl || ""
      ).trim();

      if (
        draftUrl &&
        existingPostUrls.has(draftUrl)
      ) {
        skippedDuplicateCount++;

        // createDraft에서 만든 미리보기 Object URL도 정리
        draft.media.forEach((item) => {
          if (item.previewUrl) {
            URL.revokeObjectURL(
              item.previewUrl
            );
          }

          if (
            item.thumbnailPreviewUrl
          ) {
            URL.revokeObjectURL(
              item.thumbnailPreviewUrl
            );
          }
        });

        continue;
      }

      // 같은 선택 묶음 안에 동일 URL이 두 번 들어온 경우도 제외
      if (draftUrl) {
        existingPostUrls.add(draftUrl);
      }

      newDrafts.push(
        draft
      );
    }

    // 날짜 → 시간 → 폴더명
    newDrafts.sort(
      (a, b) => {

        const aKey =
          `${a.postDate} ${a.postTime}`;

        const bKey =
          `${b.postDate} ${b.postTime}`;

        const dateCompare =
          bKey.localeCompare(
            aKey
          );

        if (
          dateCompare !== 0
        ) {
          return dateCompare;
        }

        return naturalCompare(
          a.folderName,
          b.folderName
        );
      }
    );

    // 기존 초안을 날리지 않고 추가
    setDrafts(
      (prev) => {

        const existingPaths =
          new Set(
            prev.map(
              (draft) =>
                draft.folderPath
            )
          );

        const onlyNew =
          newDrafts.filter(
            (draft) =>
              !existingPaths.has(
                draft.folderPath
              )
          );

        return [
          ...prev,
          ...onlyNew,
        ];
      }
    );

    // 불러온 폴더만 발견 목록에서 제거해서
    // DirectoryHandle/File 참조를 오래 붙잡지 않게 한다.
    setFoundGroups((prev) =>
      prev.filter(
        (group) =>
          !selectedFolderPaths.includes(
            group.folderPath
          )
      )
    );
    setSelectedFolderPaths([]);

    if (skippedDuplicateCount > 0) {
      alert(
        `새 게시글 ${newDrafts.length}개를 불러왔습니다.\n이미 등록된 게시글 ${skippedDuplicateCount}개는 자동으로 제외했습니다.`
      );
    }

  } catch (error) {

    console.error(
      "선택 폴더 분석 오류:",
      error
    );

    alert(
      `게시글을 불러오는 중 오류가 발생했습니다.\n${error.message}`
    );

  } finally {

    setParsing(false);
  }
}

  // =========================
  // 게시글 값 수정
  // =========================

  function updateDraft(
    draftId,
    field,
    value
  ) {
    setDrafts((prev) =>
      prev.map((draft) =>
        draft.id === draftId
          ? {
              ...draft,
              [field]: value,
            }
          : draft
      )
    );
  }

  // =========================
  // 미디어 값 수정
  // =========================

  function updateMedia(
    draftId,
    mediaId,
    field,
    value
  ) {
    setDrafts((prev) =>
      prev.map((draft) => {
        if (
          draft.id !==
          draftId
        ) {
          return draft;
        }

        return {
          ...draft,

          media:
            draft.media.map(
              (item) =>
                item.id ===
                mediaId
                  ? {
                      ...item,
                      [field]:
                        value,
                    }
                  : item
            ),
        };
      })
    );
  }

  // =========================
  // 미디어 순서 변경
  // =========================

  function moveMedia(
    draftId,
    index,
    direction
  ) {
    setDrafts((prev) =>
      prev.map((draft) => {
        if (
          draft.id !==
          draftId
        ) {
          return draft;
        }

        const media = [
          ...draft.media,
        ];

        const target =
          index + direction;

        if (
          target < 0 ||
          target >=
            media.length
        ) {
          return draft;
        }

        [
          media[index],
          media[target],
        ] = [
          media[target],
          media[index],
        ];

        return {
          ...draft,
          media,
        };
      })
    );
  }


  // =========================
// 가져온 게시글 초안 삭제
// =========================

function removeDraft(draftId) {
  const draft = drafts.find(
    (item) => item.id === draftId
  );

  if (!draft) return;

  const ok = window.confirm(
    `"${draft.folderName}" 게시글을 업로드 목록에서 삭제할까요?`
  );

  if (!ok) return;

  // 만들어 둔 미리보기 URL 정리
  draft.media.forEach((item) => {
    if (item.previewUrl) {
      URL.revokeObjectURL(
        item.previewUrl
      );
    }

    if (
      item.thumbnailPreviewUrl
    ) {
      URL.revokeObjectURL(
        item.thumbnailPreviewUrl
      );
    }
  });

  setDrafts((prev) =>
    prev.filter(
      (item) =>
        item.id !== draftId
    )
  );
}
// =========================
// 초안 전체 삭제
// =========================

function clearAllDrafts() {
  if (drafts.length === 0) {
    return;
  }

  const ok = window.confirm(
    `현재 불러온 게시글 ${drafts.length}개를 목록에서 전부 삭제할까요?`
  );

  if (!ok) return;

  // 미리보기 URL 정리
  drafts.forEach((draft) => {
    draft.media.forEach((item) => {
      if (item.previewUrl) {
        URL.revokeObjectURL(
          item.previewUrl
        );
      }

      if (
        item.thumbnailPreviewUrl
      ) {
        URL.revokeObjectURL(
          item.thumbnailPreviewUrl
        );
      }
    });
  });

  setDrafts([]);
}

  // =========================
  // Storage 파일명 안전하게
  // =========================

  function safeFileName(
    fileName
  ) {
    const extension =
      fileName.includes(".")
        ? "." +
          fileName
            .split(".")
            .pop()
            .toLowerCase()
        : "";

    return (
      `${Date.now()}_` +
      `${makeId()}` +
      extension
    );
  }

  // =========================
  // Storage 파일 삭제용
  // 업로드 실패 rollback
  // =========================

  async function removeUploadedFiles(
    uploaded
  ) {
    const photoPaths =
      uploaded
        .filter(
          (item) =>
            item.bucket ===
            "photos"
        )
        .map(
          (item) =>
            item.path
        );

    const videoPaths =
      uploaded
        .filter(
          (item) =>
            item.bucket ===
            "videos"
        )
        .map(
          (item) =>
            item.path
        );

    if (
      photoPaths.length
    ) {
      await supabase.storage
        .from("photos")
        .remove(
          photoPaths
        );
    }

    if (
      videoPaths.length
    ) {
      await supabase.storage
        .from("videos")
        .remove(
          videoPaths
        );
    }
  }

  // =========================
  // 게시글 하나 업로드
  // =========================

  async function uploadDraft(
    draftId
  ) {
    const draft =
      drafts.find(
        (item) =>
          item.id === draftId
      );

    if (!draft) return;

    if (
      draft.status ===
      "uploading"
    ) {
      return;
    }

    if (!draft.postDate) {
      alert(
        "게시 날짜가 없습니다."
      );
      return;
    }

    // =========================
    // 상태 변경
    // =========================

    updateDraft(
      draftId,
      "status",
      "uploading"
    );

    updateDraft(
      draftId,
      "error",
      ""
    );

    let createdPostId =
      null;

    const uploadedFiles =
      [];

    try {
      // =========================
      // posted_at
      // =========================

      let postedAt = null;

      if (
        draft.postDate &&
        draft.postTime
      ) {
        postedAt =
          `${draft.postDate}T${draft.postTime}:00`;
      }

      // =========================
      // 중복 체크
      //
      // 날짜가 아니라
      // 원본 Weverse URL 기준
      //
      // 같은 날 여러 게시글 허용!
      // =========================

      if (
        draft.postWeverseUrl
      ) {
        const {
          data:
            existingPost,
          error:
            duplicateError,
        } =
          await supabase
            .from(
              "weverse_posts"
            )
            .select("id")
            .eq(
              "weverse_url",
              draft.postWeverseUrl
            )
            .maybeSingle();

        if (
          duplicateError
        ) {
          throw duplicateError;
        }

        if (
          existingPost
        ) {
          throw new Error(
            "이미 같은 원본 링크의 게시글이 업로드되어 있습니다."
          );
        }
      }

      // =========================
      // 게시글 생성
      // =========================

      const {
        data: postData,
        error: postError,
      } =
        await supabase
          .from(
            "weverse_posts"
          )
          .insert({
            date:
              draft.postDate,

            posted_at:
              postedAt,

            content:
              draft.postContent.trim() ||
              null,

            weverse_url:
              draft.postWeverseUrl.trim() ||
              null,

            author:
              draft.postAuthor ||
              null,
          })
          .select()
          .single();

      if (postError) {
        throw postError;
      }

      createdPostId =
        postData.id;

      // =========================
      // upload_order 기준값
      // =========================

      const {
        data:
          latestPhoto,
        error:
          latestError,
      } =
        await supabase
          .from("photos")
          .select(
            "upload_order"
          )
          .order(
            "upload_order",
            {
              ascending: false,
              nullsFirst: false,
            }
          )
          .limit(1)
          .maybeSingle();

      if (latestError) {
        throw latestError;
      }

      let nextUploadOrder =
        Number(
          latestPhoto
            ?.upload_order ||
            0
        ) + 1;

      // =========================
      // 미디어 순서대로 업로드
      // =========================

      for (
        let index = 0;
        index <
        draft.media.length;
        index++
      ) {
        const item =
          draft.media[index];

        const mediaOrder =
          index + 1;

        // =====================
        // 사진
        // =====================

        if (
          item.kind ===
          "photo"
        ) {
          const path =
            `${draft.postDate}/${createdPostId}/${safeFileName(
              item.file.name
            )}`;

          const {
            error:
              uploadError,
          } =
            await supabase.storage
              .from("photos")
              .upload(
                path,
                item.file,
                {
                  upsert: false,
                }
              );

          if (uploadError) {
            throw uploadError;
          }

          uploadedFiles.push({
            bucket: "photos",
            path,
          });

          const {
            data: urlData,
          } =
            supabase.storage
              .from("photos")
              .getPublicUrl(
                path
              );

          const { error: insertError } = await supabase.from("photos").insert({
            post_id: createdPostId,

            image_url: urlData.publicUrl,

            date: draft.postDate,

            type: item.type || null,

            hair_color: item.hairColor || null,

            archive_visible: item.archiveVisible !== false,

            tags: (item.tags || "")
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean),

            search_tags: (item.searchTags || "")
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean),

            weverse_url: draft.postWeverseUrl || null,

            crop_position: `${item.cropX}% ${item.cropY}%`,

            media_order: mediaOrder,

            upload_order: nextUploadOrder,
          });

          if (
            insertError
          ) {
            throw insertError;
          }

          nextUploadOrder++;
        }

        // =====================
        // 동영상
        // =====================

        if (
          item.kind ===
          "video"
        ) {
          const path =
            `${draft.postDate}/${createdPostId}/${safeFileName(
              item.file.name
            )}`;

          const {
            error:
              uploadError,
          } =
            await supabase.storage
              .from("videos")
              .upload(
                path,
                item.file,
                {
                  upsert: false,
                }
              );

          if (uploadError) {
            throw uploadError;
          }

          uploadedFiles.push({
            bucket: "videos",
            path,
          });

          const {
            data: urlData,
          } =
            supabase.storage
              .from("videos")
              .getPublicUrl(
                path
              );

          let thumbnailUrl =
            null;

          /*
            현재 videos 테이블의
            thumbnail_url은
            그대로 사용할 수 있게 둠.

            썸네일을 Storage에 따로
            올리고 싶으면 다음 단계에서
            붙이면 됨.
          */

          const {
            error:
              insertError,
          } =
            await supabase
              .from("videos")
              .insert({
                post_id:
                  createdPostId,

                video_url:
                  urlData
                    .publicUrl,

                thumbnail_url:
                  thumbnailUrl,

                type:
                  item.type || null,

                crop_position:
                  `${item.cropX}% ${item.cropY}%`,

                media_order:
                  mediaOrder,
              });

          if (
            insertError
          ) {
            throw insertError;
          }
        }
      }

      // =========================
      // 완료
      // =========================

      setDrafts((prev) =>
        prev.map((item) =>
          item.id ===
          draftId
            ? {
                ...item,
                status:
                  "uploaded",
                uploadedPostId:
                  createdPostId,
                error: "",
              }
            : item
        )
      );

    } catch (error) {
      console.error(
        "게시글 업로드 오류:",
        error
      );

      // =========================
      // 실패 rollback
      // =========================

      await removeUploadedFiles(
        uploadedFiles
      );

      if (
        createdPostId
      ) {
        // 중간에 생성된 미디어 DB 정리
        await supabase
          .from("photos")
          .delete()
          .eq(
            "post_id",
            createdPostId
          );

        await supabase
          .from("videos")
          .delete()
          .eq(
            "post_id",
            createdPostId
          );

        await supabase
          .from(
            "weverse_posts"
          )
          .delete()
          .eq(
            "id",
            createdPostId
          );
      }

      setDrafts((prev) =>
        prev.map((item) =>
          item.id ===
          draftId
            ? {
                ...item,
                status:
                  "error",
                error:
                  error.message,
              }
            : item
        )
      );
    }
  }

  const totalImportPages =
    Math.max(
      1,
      Math.ceil(
        foundGroups.length /
        IMPORT_PAGE_SIZE
      )
    );

  const importPageStart =
    (importPage - 1) *
    IMPORT_PAGE_SIZE;

  const visibleImportGroups =
    foundGroups.slice(
      importPageStart,
      importPageStart +
        IMPORT_PAGE_SIZE
    );

  // =========================
  // 화면
  // =========================

  return (
    <div className="archive-import-page">
      <div className="archive-import-top">
        <div className="archive-import-header">
          <button
            type="button"
            className="archive-import-back-button"
            onClick={() => {
              window.location.href = "/admin";
            }}
          >
            ← 뒤로가기
          </button>

          <h1>아카이브 가져오기</h1>
        </div>

        <p>
          여러 게시글 폴더를 한 번에 불러온 뒤 게시글별로 수정하고 각각 업로드할
          수 있습니다.
        </p>

        <button
          type="button"
          className="folder-import-button"
          disabled={parsing}
          onClick={chooseArchiveRoot}
        >
          {parsing ? "폴더 목록 읽는 중..." : "📁 백업 상위 폴더 선택"}
        </button>

        <div className="import-folder-help">
          900개 폴더의 파일을 한꺼번에 읽지 않습니다. 먼저 게시글 폴더 이름만
          찾고, 선택한 50개 이하의 게시글만 PDF/사진/영상을 불러옵니다.
        </div>

        {/* =========================
    발견된 게시글 폴더 선택
========================= */}

        {foundGroups.length > 0 && (
          <div className="import-folder-selector">
            <div className="import-folder-selector-header">
              <div>
                <strong>게시글 폴더 선택</strong>

                <div className="import-folder-help">
                  총 {foundGroups.length}개를 찾았습니다. 현재 페이지에서 불러올
                  게시글만 선택하세요. 모먼트 폴더는 자동 제외됩니다.
                </div>
              </div>

              <div className="import-folder-select-actions">
                <button type="button" onClick={selectAllImportFolders}>
                  현재 50개 선택
                </button>

                <button type="button" onClick={clearImportFolders}>
                  선택 해제
                </button>
              </div>
            </div>

            <div className="import-folder-list">
              {visibleImportGroups.map((group) => {
                const checked = selectedFolderPaths.includes(group.folderPath);

                const membership =
                  group.folderPath.toLowerCase().includes("멤버쉽") ||
                  group.folderPath.toLowerCase().includes("멤버십");

                return (
                  <label
                    className={`import-folder-item ${
                      checked ? "selected" : ""
                    }`}
                    key={group.folderPath}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleImportFolder(group.folderPath)}
                    />

                    <div className="import-folder-item-main">
                      <div className="import-folder-name">
                        {group.folderName}

                        {membership && (
                          <span className="membership-badge">멤버쉽</span>
                        )}
                      </div>

                      <div className="import-folder-meta">
                        파일은 초안으로 불러올 때 확인
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>

            <div className="import-folder-pagination">
              <button
                type="button"
                disabled={importPage <= 1 || parsing}
                onClick={() => {
                  setImportPage((prev) => Math.max(1, prev - 1));
                  setSelectedFolderPaths([]);
                }}
              >
                이전 50개
              </button>

              <span>
                {importPage} / {totalImportPages}
              </span>

              <button
                type="button"
                disabled={importPage >= totalImportPages || parsing}
                onClick={() => {
                  setImportPage((prev) => Math.min(totalImportPages, prev + 1));
                  setSelectedFolderPaths([]);
                }}
              >
                다음 50개
              </button>
            </div>

            <div className="import-folder-bottom">
              <span>{selectedFolderPaths.length}개 선택</span>

              <button
                type="button"
                className="load-selected-folders"
                disabled={parsing || selectedFolderPaths.length === 0}
                onClick={loadSelectedFolders}
              >
                {parsing
                  ? "불러오는 중..."
                  : `선택한 ${selectedFolderPaths.length}개 게시글 불러오기`}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* =========================
          초안 목록
      ========================= */}
      {drafts.length > 0 && (
        <div className="archive-draft-list-header">
          <span>불러온 게시글 {drafts.length}개</span>

          <button
            type="button"
            className="archive-clear-all-button"
            onClick={clearAllDrafts}
          >
            목록 전체 삭제
          </button>
        </div>
      )}
      <div className="archive-draft-list">
        {drafts.map((draft) => (
          <section className="archive-draft-card" key={draft.id}>
            {/* =====================
                  카드 제목
              ===================== */}

            <div className="archive-draft-header">
              <div>
                <strong>{draft.folderName}</strong>

                <div className="archive-draft-path">{draft.folderPath}</div>
              </div>

              <div className={`archive-draft-status ${draft.status}`}>
                {draft.status === "draft" && "작성 중"}

                {draft.status === "uploading" && "업로드 중..."}

                {draft.status === "uploaded" && "✓ 업로드 완료"}

                {draft.status === "error" && "업로드 실패"}
              </div>
            </div>

            {!draft.pdfFound && (
              <div className="archive-import-warning">
                PDF를 찾지 못했습니다. 날짜 외 정보는 직접 확인해주세요.
              </div>
            )}

            {draft.error && (
              <div className="archive-import-error">{draft.error}</div>
            )}

            {/* =====================
                  게시글 정보
              ===================== */}

            <div className="archive-draft-fields">
              <label>
                날짜
                <input
                  type="date"
                  value={draft.postDate}
                  disabled={draft.status === "uploaded"}
                  onChange={(e) =>
                    updateDraft(draft.id, "postDate", e.target.value)
                  }
                />
              </label>

              <label>
                시간
                <input
                  type="time"
                  value={draft.postTime}
                  disabled={draft.status === "uploaded"}
                  onChange={(e) =>
                    updateDraft(draft.id, "postTime", e.target.value)
                  }
                />
              </label>

              <label>
                작성자
                <select
                  value={draft.postAuthor}
                  disabled={draft.status === "uploaded"}
                  onChange={(e) =>
                    updateDraft(draft.id, "postAuthor", e.target.value)
                  }
                >
                  <option value="리우">리우</option>
                </select>
              </label>
            </div>

            <label className="archive-draft-full-field">
              본문
              <textarea
                value={draft.postContent}
                disabled={draft.status === "uploaded"}
                onChange={(e) =>
                  updateDraft(draft.id, "postContent", e.target.value)
                }
              />
            </label>

            <label className="archive-draft-full-field">
              원본 링크
              <input
                type="url"
                value={draft.postWeverseUrl}
                disabled={draft.status === "uploaded"}
                onChange={(e) =>
                  updateDraft(draft.id, "postWeverseUrl", e.target.value)
                }
              />
            </label>

            {/* =====================
                  미디어
              ===================== */}

            <div className="archive-import-media-title">
              미디어{" "}
              <span>
                사진{" "}
                {draft.media.filter((item) => item.kind === "photo").length}
                {" / "}
                동영상{" "}
                {draft.media.filter((item) => item.kind === "video").length}
              </span>
            </div>

            <div className="archive-import-media-list">
              {draft.media.map((item, index) => (
                <div className="archive-import-media" key={item.id}>
                  <div className="archive-import-media-preview">
                    {item.kind === "photo" ? (
                      <img src={item.previewUrl} alt="" />
                    ) : (
                      <video
                        src={item.previewUrl}
                        poster={item.thumbnailPreviewUrl || undefined}
                        controls
                      />
                    )}
                  </div>

                  <div className="archive-import-media-info">
                    <strong>
                      {index + 1}. {item.kind === "photo" ? "사진" : "동영상"}
                    </strong>

                    <span>{item.fileName}</span>

                    {/* 사진 정보 */}

                    {item.kind === "photo" && (
                      <>
                        <select
                          value={item.type}
                          disabled={draft.status === "uploaded"}
                          onChange={(e) =>
                            updateMedia(
                              draft.id,
                              item.id,
                              "type",
                              e.target.value,
                            )
                          }
                        >
                          <option value="셀카">셀카</option>

                          <option value="남찍사">남찍사</option>

                          <option value="거울셀카">거울셀카</option>

                          <option value="그외">그외</option>
                        </select>

                        <select
                          value={item.hairColor}
                          disabled={draft.status === "uploaded"}
                          onChange={(e) =>
                            updateMedia(
                              draft.id,
                              item.id,
                              "hairColor",
                              e.target.value,
                            )
                          }
                        >
                          <option value="">머리색 선택</option>
                          <option value="흑발">흑발</option>
                          <option value="갈발">갈발</option>
                          <option value="금발">금발</option>
                          <option value="적발">적발</option>
                          <option value="은발">은발</option>
                          <option value="핑크">핑크</option>
                        </select>

                        <label className="archive-visible-toggle import-visible-toggle">
                          <input
                            type="checkbox"
                            checked={item.archiveVisible !== false}
                            disabled={draft.status === "uploaded"}
                            onChange={(e) =>
                              updateMedia(
                                draft.id,
                                item.id,
                                "archiveVisible",
                                e.target.checked,
                              )
                            }
                          />
                          사진 아카이브에 표시
                        </label>

                        <input
                          type="text"
                          placeholder="태그 (쉼표로 구분)"
                          value={item.tags}
                          disabled={draft.status === "uploaded"}
                          onChange={(e) =>
                            updateMedia(
                              draft.id,
                              item.id,
                              "tags",
                              e.target.value,
                            )
                          }
                        />

                        <input
                          type="text"
                          placeholder="검색 태그 (쉼표로 구분)"
                          value={item.searchTags}
                          disabled={draft.status === "uploaded"}
                          onChange={(e) =>
                            updateMedia(
                              draft.id,
                              item.id,
                              "searchTags",
                              e.target.value,
                            )
                          }
                        />
                      </>
                    )}

                    {item.kind === "video" && (
                      <select
                        value={item.type || ""}
                        disabled={draft.status === "uploaded"}
                        onChange={(e) =>
                          updateMedia(draft.id, item.id, "type", e.target.value)
                        }
                      >
                        <option value="">동영상 유형</option>
                        <option value="셀카">셀카</option>
                        <option value="남찍사">남찍사</option>
                        <option value="거울셀카">거울셀카</option>
                        <option value="그외">그외</option>
                      </select>
                    )}

                    {/* 순서 */}

                    <div className="archive-import-order">
                      <button
                        type="button"
                        disabled={index === 0 || draft.status === "uploaded"}
                        onClick={() => moveMedia(draft.id, index, -1)}
                      >
                        ↑
                      </button>

                      <button
                        type="button"
                        disabled={
                          index === draft.media.length - 1 ||
                          draft.status === "uploaded"
                        }
                        onClick={() => moveMedia(draft.id, index, 1)}
                      >
                        ↓
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* =====================
                  업로드
              ===================== */}

            <div className="archive-draft-actions">
              <button
                type="button"
                className="archive-draft-delete-button"
                disabled={draft.status === "uploading"}
                onClick={() => removeDraft(draft.id)}
              >
                목록에서 삭제
              </button>

              {draft.status === "uploaded" ? (
                <button
                  type="button"
                  onClick={() => {
                    window.location.href = "/admin/posts";
                  }}
                >
                  업로드된 게시글 보기
                </button>
              ) : (
                <button
                  type="button"
                  disabled={draft.status === "uploading"}
                  onClick={() => uploadDraft(draft.id)}
                >
                  {draft.status === "uploading"
                    ? "업로드 중..."
                    : "이 게시글 업로드"}
                </button>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

export default ArchiveImport;