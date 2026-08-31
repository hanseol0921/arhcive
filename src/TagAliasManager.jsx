import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";
import "./TagAliasManager.css";

function TagAliasManager() {
  const [tagAliases, setTagAliases] = useState([]);
  const [loading, setLoading] = useState(true);

  // =========================
  // 새 태그 등록
  // =========================

  const [newTag, setNewTag] = useState("");
  const [newAlias, setNewAlias] = useState("");
  const [addingTag, setAddingTag] = useState(false);

  // =========================
  // 등록된 태그 검색
  // =========================

  const [tagSearch, setTagSearch] = useState("");

  // =========================
  // 기존 태그에 검색어 추가
  // =========================

  const [addingAliasTag, setAddingAliasTag] = useState(null);
  const [aliasInput, setAliasInput] = useState("");
  const [addingAlias, setAddingAlias] = useState(false);

  // =========================
  // 문자열 정리
  // 띄어쓰기 무시
  // =========================

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\s+/g, "")
      .trim();
  }

  // =========================
  // 데이터 불러오기
  // =========================

  useEffect(() => {
    getTagAliases();
  }, []);

  async function getTagAliases() {
    setLoading(true);

    const { data, error } = await supabase
      .from("tag_aliases")
      .select("id, tag, alias")
      .order("tag", {
        ascending: true,
      });

    if (error) {
      console.error(
        "검색용 태그 불러오기 실패:",
        error
      );

      alert(
        `검색용 태그를 불러오지 못했습니다.\n${error.message}`
      );

      setLoading(false);
      return;
    }

    setTagAliases(data || []);
    setLoading(false);
  }

  // =========================
  // 실제 태그 목록
  // =========================

  const tagList = useMemo(() => {
    const tags = [];

    tagAliases.forEach((item) => {
      if (!item.tag) return;

      const exists = tags.some(
        (tag) =>
          normalize(tag) ===
          normalize(item.tag)
      );

      if (!exists) {
        tags.push(item.tag);
      }
    });

    return tags.sort((a, b) =>
      a.localeCompare(b)
    );
  }, [tagAliases]);

  // =========================
  // 실제 태그별 묶기
  // =========================

  const groupedTags = useMemo(() => {
    return tagAliases.reduce(
      (groups, item) => {
        const tag = item.tag || "";

        if (!groups[tag]) {
          groups[tag] = [];
        }

        groups[tag].push(item);

        return groups;
      },
      {}
    );
  }, [tagAliases]);

  // =========================
  // 등록된 태그 검색
  // 태그 + 검색어 둘 다 검색
  // =========================

  const filteredGroups = useMemo(() => {
    const keyword = normalize(tagSearch);

    if (!keyword) {
      return Object.entries(groupedTags);
    }

    return Object.entries(groupedTags).filter(
      ([tag, aliases]) => {
        // 실제 태그 검색
        if (
          normalize(tag).includes(keyword)
        ) {
          return true;
        }

        // 검색어 검색
        return aliases.some((item) =>
          normalize(item.alias).includes(
            keyword
          )
        );
      }
    );
  }, [groupedTags, tagSearch]);

  // =========================
  // 새 태그 중복 검사
  // =========================

  const duplicateTag = useMemo(() => {
    const keyword = normalize(newTag);

    if (!keyword) {
      return false;
    }

    return tagList.some(
      (tag) =>
        normalize(tag) === keyword
    );
  }, [newTag, tagList]);

  // =========================
  // 새 태그의 검색어 중복
  // =========================

  const duplicateNewAlias = useMemo(() => {
    if (
      !newTag.trim() ||
      !newAlias.trim()
    ) {
      return false;
    }

    return tagAliases.some(
      (item) =>
        normalize(item.tag) ===
          normalize(newTag) &&
        normalize(item.alias) ===
          normalize(newAlias)
    );
  }, [
    newTag,
    newAlias,
    tagAliases,
  ]);

  // =========================
  // 새 태그 등록
  // =========================

  async function handleAddTag() {
    const tag = newTag.trim();
    const alias = newAlias.trim();

    if (!tag) {
      alert("실제 태그를 입력해주세요.");
      return;
    }

    if (duplicateTag) {
      return;
    }

    if (!alias) {
      alert("검색어를 입력해주세요.");
      return;
    }

    if (duplicateNewAlias) {
      alert("이미 등록된 검색어입니다.");
      return;
    }

    setAddingTag(true);

    const { data, error } = await supabase
      .from("tag_aliases")
      .insert({
        tag,
        alias,
      })
      .select("id, tag, alias")
      .single();

    if (error) {
      console.error(
        "태그 등록 실패:",
        error
      );

      alert(
        `태그 등록 중 오류가 발생했습니다.\n${error.message}`
      );

      setAddingTag(false);
      return;
    }

    setTagAliases((prev) => [
      ...prev,
      data,
    ]);

    setNewTag("");
    setNewAlias("");

    setAddingTag(false);
  }

  // =========================
  // 기존 태그 검색어 추가
  // =========================

  async function handleAddAlias(tag) {
    const alias = aliasInput.trim();

    if (!alias) {
      return;
    }

    // 같은 태그에 같은 검색어가 있는지
    const alreadyExists = tagAliases.some(
      (item) =>
        normalize(item.tag) ===
          normalize(tag) &&
        normalize(item.alias) ===
          normalize(alias)
    );

    if (alreadyExists) {
      alert("이미 등록된 검색어입니다.");
      return;
    }

    setAddingAlias(true);

    const { data, error } = await supabase
      .from("tag_aliases")
      .insert({
        tag,
        alias,
      })
      .select("id, tag, alias")
      .single();

    if (error) {
      console.error(
        "검색어 추가 실패:",
        error
      );

      alert(
        `검색어 추가 중 오류가 발생했습니다.\n${error.message}`
      );

      setAddingAlias(false);
      return;
    }

    setTagAliases((prev) => [
      ...prev,
      data,
    ]);

    setAliasInput("");
    setAddingAliasTag(null);
    setAddingAlias(false);
  }

  // =========================
  // 검색어 추가 취소
  // =========================

  function cancelAddAlias() {
    setAddingAliasTag(null);
    setAliasInput("");
  }

  // =========================
  // 검색어 삭제
  // =========================

  async function handleDeleteAlias(id) {
    const confirmed = window.confirm(
      "이 검색어를 삭제할까요?"
    );

    if (!confirmed) {
      return;
    }

    const { error } = await supabase
      .from("tag_aliases")
      .delete()
      .eq("id", id);

    if (error) {
      console.error(
        "검색어 삭제 실패:",
        error
      );

      alert(
        `삭제 중 오류가 발생했습니다.\n${error.message}`
      );

      return;
    }

    setTagAliases((prev) =>
      prev.filter(
        (item) => item.id !== id
      )
    );
  }

  // =========================
  // 실제 태그 전체 삭제
  // =========================

  async function handleDeleteTag(tag) {
    const confirmed = window.confirm(
      `"${tag}" 태그와 연결된 검색어를 전부 삭제할까요?`
    );

    if (!confirmed) {
      return;
    }

    const { error } = await supabase
      .from("tag_aliases")
      .delete()
      .eq("tag", tag);

    if (error) {
      console.error(
        "태그 삭제 실패:",
        error
      );

      alert(
        `태그 삭제 중 오류가 발생했습니다.\n${error.message}`
      );

      return;
    }

    setTagAliases((prev) =>
      prev.filter(
        (item) => item.tag !== tag
      )
    );

    if (
      addingAliasTag &&
      normalize(addingAliasTag) ===
        normalize(tag)
    ) {
      cancelAddAlias();
    }
  }

  // =========================
  // 화면
  // =========================

  return (
    <div className="tag-manager-page">

      <div className="tag-manager-box">

        {/* =========================
            헤더
        ========================= */}

        <header className="tag-manager-header">

          <div>
            <span className="tag-manager-small">
              PHOTO ARCHIVE
            </span>

            <h1>검색어 관리</h1>
          </div>

          <button
            type="button"
            className="tag-manager-home"
            onClick={() => {
              window.location.href =
                "/admin";
            }}
          >
            관리자
          </button>

        </header>


        {/* =========================
            새 태그 등록
        ========================= */}

        <section className="tag-add-section">

          <div className="tag-section-title">
            새 태그 등록
          </div>

          <div className="tag-add-form">

            <input
              type="text"
              placeholder="실제 태그"
              value={newTag}
              onChange={(e) =>
                setNewTag(
                  e.target.value
                )
              }
            />

            <span>→</span>

            <input
              type="text"
              placeholder="검색어"
              value={newAlias}
              onChange={(e) =>
                setNewAlias(
                  e.target.value
                )
              }
            />

            <button
              type="button"
              onClick={handleAddTag}
              disabled={
                addingTag ||
                !newTag.trim() ||
                !newAlias.trim() ||
                duplicateTag ||
                duplicateNewAlias
              }
            >
              {addingTag
                ? "등록 중..."
                : "등록"}
            </button>

          </div>


          {/* 중복 태그 */}

          {duplicateTag && (
            <div className="tag-error">
              이미 등록된 태그입니다.
            </div>
          )}


          {/* 중복 검색어 */}

          {!duplicateTag &&
            duplicateNewAlias && (
              <div className="tag-error">
                이미 등록된 검색어입니다.
              </div>
            )}


          <div className="tag-input-help">
            예: 오늘만 I LOVE YOU → 오알럽
          </div>

        </section>


        {/* =========================
            등록된 태그
        ========================= */}

        <section className="tag-list-section">

          <div className="tag-list-header">

            <div className="tag-section-title">
              등록된 태그
            </div>

            <input
              className="tag-search-input"
              type="text"
              placeholder="태그 또는 검색어 검색"
              value={tagSearch}
              onChange={(e) =>
                setTagSearch(
                  e.target.value
                )
              }
            />

          </div>


          {loading ? (

            <div className="tag-empty">
              불러오는 중...
            </div>

          ) : filteredGroups.length ===
            0 ? (

            <div className="tag-empty">
              {tagSearch
                ? "검색 결과가 없습니다."
                : "등록된 태그가 없습니다."}
            </div>

          ) : (

            <div className="tag-list">

              {filteredGroups.map(
                ([tag, aliases]) => (

                  <div
                    className="tag-row"
                    key={tag}
                  >

                    {/* =================
                        실제 태그
                    ================= */}

                    <div className="real-tag">
                      {tag}
                    </div>

                    <div className="tag-arrow">
                      →
                    </div>


                    {/* =================
                        검색어 영역
                    ================= */}

                    <div className="alias-list">

                      {aliases.map(
                        (item) => (

                          <div
                            className="alias-item"
                            key={item.id}
                          >

                            <span>
                              {item.alias}
                            </span>

                            <button
                              type="button"
                              onClick={() =>
                                handleDeleteAlias(
                                  item.id
                                )
                              }
                            >
                              ×
                            </button>

                          </div>

                        )
                      )}


                      {/* =================
                          검색어 추가 입력
                      ================= */}

                      {addingAliasTag ===
                      tag ? (

                        <div className="alias-add-inline">

                          <input
                            type="text"
                            autoFocus
                            placeholder="새 검색어"
                            value={
                              aliasInput
                            }
                            onChange={(e) =>
                              setAliasInput(
                                e.target.value
                              )
                            }
                            onKeyDown={(e) => {
                              if (
                                e.key ===
                                "Enter"
                              ) {
                                handleAddAlias(
                                  tag
                                );
                              }

                              if (
                                e.key ===
                                "Escape"
                              ) {
                                cancelAddAlias();
                              }
                            }}
                          />

                          <button
                            type="button"
                            onClick={() =>
                              handleAddAlias(
                                tag
                              )
                            }
                            disabled={
                              addingAlias ||
                              !aliasInput.trim()
                            }
                          >
                            {addingAlias
                              ? "..."
                              : "추가"}
                          </button>

                          <button
                            type="button"
                            onClick={
                              cancelAddAlias
                            }
                          >
                            취소
                          </button>

                        </div>

                      ) : (

                        <button
                          type="button"
                          className="add-alias-button"
                          onClick={() => {
                            setAddingAliasTag(
                              tag
                            );
                            setAliasInput("");
                          }}
                        >
                          + 검색어 추가
                        </button>

                      )}

                    </div>


                    {/* =================
                        태그 삭제
                    ================= */}

                    <button
                      type="button"
                      className="delete-tag-button"
                      onClick={() =>
                        handleDeleteTag(tag)
                      }
                    >
                      태그 삭제
                    </button>

                  </div>

                )
              )}

            </div>

          )}

        </section>

      </div>

    </div>
  );
}

export default TagAliasManager;