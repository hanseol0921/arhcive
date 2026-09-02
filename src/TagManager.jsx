import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import { clearTagCache } from "./TagPicker";
import "./TagPicker.css";
import "./App.css";

const splitAliases = (value) => value.split(",").map((item) => item.trim()).filter(Boolean);

function TagManager() {
  const [tags, setTags] = useState([]);
  const [originalTags, setOriginalTags] = useState([]);
  const [newName, setNewName] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingAll, setSavingAll] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [highlightedId, setHighlightedId] = useState(null);
  const tagRowRefs = useRef(new Map());

  function moveToTag(id) {
    setSearch("");
    setHighlightedId(id);
    window.setTimeout(() => {
      const row = tagRowRefs.current.get(id);
      row?.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => {
        const input = row?.querySelector("input");
        input?.focus();
        input?.select();
      }, 350);
    }, 0);
    window.setTimeout(() => setHighlightedId((current) => current === id ? null : current), 1800);
  }

  const normalizedSearch = search.trim().toLocaleLowerCase("ko");
  const filteredTags = normalizedSearch
    ? tags.filter((tag) =>
        [tag.name, ...splitAliases(tag.aliasesText)].some((word) =>
          word.toLocaleLowerCase("ko").includes(normalizedSearch),
        ),
      )
    : tags;

  async function loadTags() {
    setLoading(true);
    const { data, error } = await supabase.from("archive_tags").select("id, name, aliases").order("name");
    if (error) alert("태그 사전을 불러오지 못했습니다. 먼저 SQL을 실행해주세요.");
    else {
      const rows = (data || []).map((tag) => ({ ...tag, aliasesText: (tag.aliases || []).join(", ") }));
      setTags(rows);
      setOriginalTags(rows);
    }
    setLoading(false);
  }

  useEffect(() => { loadTags(); }, []);

  async function createTag() {
    const name = newName.trim();
    if (!name) return;
    const duplicate = tags.find((tag) => tag.name.trim().toLocaleLowerCase("ko") === name.toLocaleLowerCase("ko"));
    if (duplicate) {
      alert(`“${name}” 태그는 이미 등록되어 있습니다. 기존 태그 위치로 이동합니다.`);
      moveToTag(duplicate.id);
      return;
    }
    const { error } = await supabase.from("archive_tags").insert({ name, aliases: [] });
    if (error) return alert(error.code === "23505" ? "이미 등록된 태그입니다." : "태그 등록에 실패했습니다.");
    setNewName("");
    clearTagCache();
    loadTags();
  }

  async function saveAllTags() {
    const cleaned = tags.map((tag) => ({
      ...tag,
      name: tag.name.trim(),
      aliases: [...new Set(splitAliases(tag.aliasesText))],
    }));

    if (cleaned.some((tag) => !tag.name)) {
      return alert("비어 있는 태그 이름이 있습니다.");
    }

    const seen = new Map();
    for (const tag of cleaned) {
      const key = tag.name.toLocaleLowerCase("ko");
      if (seen.has(key)) {
        alert(`“${tag.name}” 태그 이름이 중복되어 있습니다. 먼저 등록된 태그 위치로 이동합니다.`);
        moveToTag(seen.get(key));
        return;
      }
      seen.set(key, tag.id);
    }

    const originalById = new Map(originalTags.map((tag) => [tag.id, tag]));
    const changed = cleaned.filter((tag) => {
      const original = originalById.get(tag.id);
      if (!original || original.name !== tag.name) return true;
      return JSON.stringify(splitAliases(original.aliasesText)) !== JSON.stringify(tag.aliases);
    });

    if (!changed.length) return alert("변경된 태그가 없습니다.");

    setSavingAll(true);
    try {
      for (const tag of changed) {
        const { error } = await supabase
          .from("archive_tags")
          .update({ name: tag.name, aliases: tag.aliases })
          .eq("id", tag.id);
        if (error) throw error;
      }
      clearTagCache();
      await loadTags();
      alert(`${changed.length}개 태그를 저장했습니다.`);
    } catch (error) {
      console.error("태그 전체 저장 오류:", error);
      alert(error.code === "23505" ? "같은 이름의 태그가 이미 있습니다." : "태그 전체 저장에 실패했습니다.");
    } finally {
      setSavingAll(false);
    }
  }

  async function deleteTag(tag) {
    const confirmed = window.confirm(
      `“${tag.name}” 태그를 삭제할까요?\n이 태그는 연결된 모든 사진과 동영상에서도 제거됩니다.`,
    );
    if (!confirmed) return;

    setDeletingId(tag.id);
    const { error } = await supabase.from("archive_tags").delete().eq("id", tag.id);
    setDeletingId(null);
    if (error) {
      console.error("태그 삭제 오류:", error);
      return alert("태그를 삭제하지 못했습니다. 갱신된 SQL을 먼저 실행했는지 확인해주세요.");
    }
    clearTagCache();
    await loadTags();
  }

  return (
    <main className="tag-manager-page">
      <header>
        <button type="button" onClick={() => { window.location.href = "/admin"; }}>← 뒤로가기</button>
        <div><h1>태그 관리</h1><p>이름이나 검색용 태그를 바꾸면 해당 태그를 쓰는 모든 사진과 동영상에 반영됩니다.</p></div>
      </header>
      <section className="tag-manager-create">
        <input value={newName} onChange={(e) => setNewName(e.target.value.replace(/,/g, ""))} onKeyDown={(e) => { if (e.key === "Enter") createTag(); }} placeholder="새 태그 이름" />
        <button type="button" onClick={createTag}>태그 등록</button>
      </section>
      <div className="tag-manager-search">
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="태그 이름 또는 검색용 태그 검색"
        />
        {search && <button type="button" onClick={() => setSearch("")}>검색 지우기</button>}
        <span>{filteredTags.length} / {tags.length}개</span>
      </div>
      <div className="tag-manager-save-bar">
        <span>태그 이름과 검색용 태그를 모두 수정한 뒤 한 번에 저장하세요.</span>
        <button type="button" disabled={loading || savingAll || !tags.length} onClick={saveAllTags}>
          {savingAll ? "전체 저장 중..." : "전체 저장"}
        </button>
      </div>
      {loading ? <p>불러오는 중...</p> : (
        <div className="tag-manager-list">
          {filteredTags.map((tag) => (
            <section
              key={tag.id}
              ref={(element) => {
                if (element) tagRowRefs.current.set(tag.id, element);
                else tagRowRefs.current.delete(tag.id);
              }}
              className={`tag-manager-row ${highlightedId === tag.id ? "duplicate-highlight" : ""}`}
            >
              <label>태그 이름<input value={tag.name} onChange={(e) => setTags((current) => current.map((item) => item.id === tag.id ? { ...item, name: e.target.value.replace(/,/g, "") } : item))} /></label>
              <label>검색용 태그<input value={tag.aliasesText} placeholder="쉼표로 구분" onChange={(e) => setTags((current) => current.map((item) => item.id === tag.id ? { ...item, aliasesText: e.target.value } : item))} /></label>
              <button className="tag-manager-delete" type="button" disabled={deletingId === tag.id || savingAll} onClick={() => deleteTag(tag)}>
                {deletingId === tag.id ? "삭제 중..." : "삭제"}
              </button>
            </section>
          ))}
          {!filteredTags.length && <p className="tag-manager-empty">일치하는 태그가 없습니다.</p>}
        </div>
      )}
    </main>
  );
}

export default TagManager;
