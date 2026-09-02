import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "./supabaseClient";
import "./TagPicker.css";

let tagCache = null;

const toArray = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value || "").split(",").map((tag) => tag.trim()).filter(Boolean);
};

async function fetchTags(force = false) {
  if (tagCache && !force) return tagCache;
  const { data, error } = await supabase
    .from("archive_tags")
    .select("id, name, aliases")
    .order("name", { ascending: true });
  if (error) throw error;
  tagCache = data || [];
  return tagCache;
}

export function clearTagCache() {
  tagCache = null;
  window.dispatchEvent(new Event("archive-tags-changed"));
}

function TagPicker({ value, onChange, allowCreate = true, placeholder = "태그 검색", disabled = false }) {
  const pickerRef = useRef(null);
  const [tags, setTags] = useState([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const selected = useMemo(() => toArray(value), [value]);

  useEffect(() => {
    let active = true;
    const load = async (force = false) => {
      try {
        const rows = await fetchTags(force);
        if (active) setTags(rows);
      } catch (error) {
        console.error("태그 사전 조회 오류:", error);
      }
    };
    load();
    const refresh = () => load(true);
    window.addEventListener("archive-tags-changed", refresh);
    return () => {
      active = false;
      window.removeEventListener("archive-tags-changed", refresh);
    };
  }, []);

  useEffect(() => {
    function closeOnOutsidePointer(event) {
      if (pickerRef.current && !pickerRef.current.contains(event.target)) {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, []);

  const emit = (next) => {
    if (!disabled) onChange(Array.isArray(value) ? next : next.join(", "));
  };
  const normalizedQuery = query.trim().toLowerCase();
  const matches = tags.filter((tag) => {
    if (selected.includes(tag.name)) return false;
    if (!normalizedQuery) return true;
    return [tag.name, ...(tag.aliases || [])]
      .some((word) => String(word).toLowerCase().includes(normalizedQuery));
  }).slice(0, 12);
  const exactTag = tags.find((tag) => tag.name.toLowerCase() === normalizedQuery);

  function add(name) {
    if (!name || selected.includes(name)) return;
    emit([...selected, name]);
    setQuery("");
    setOpen(false);
  }

  async function createTag() {
    const name = query.trim();
    if (!name || exactTag || saving) return;
    setSaving(true);
    try {
      const { data, error } = await supabase
        .from("archive_tags")
        .insert({ name, aliases: [] })
        .select("id, name, aliases")
        .single();
      if (error) throw error;
      tagCache = [...tags, data].sort((a, b) => a.name.localeCompare(b.name, "ko"));
      setTags(tagCache);
      add(data.name);
      window.dispatchEvent(new Event("archive-tags-changed"));
    } catch (error) {
      console.error("태그 등록 오류:", error);
      alert(error.code === "23505" ? "이미 등록된 태그입니다." : "태그를 등록하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="tag-picker" ref={pickerRef}>
      <div className="tag-picker-chips">
        {selected.map((name) => (
          <span className="tag-picker-chip" key={name}>
            {name}
            {!disabled && <button type="button" aria-label={`${name} 태그 제거`} onClick={() => emit(selected.filter((tag) => tag !== name))}>×</button>}
          </span>
        ))}
        <input
          value={query}
          disabled={disabled}
          placeholder={selected.length ? "태그 추가" : placeholder}
          onFocus={() => setOpen(true)}
          onChange={(event) => { setQuery(event.target.value.replace(/,/g, "")); setOpen(true); }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            if (exactTag) add(exactTag.name);
            else if (matches.length === 1) add(matches[0].name);
            else if (allowCreate && query.trim()) createTag();
          }}
        />
      </div>
      {!disabled && open && (matches.length > 0 || (allowCreate && query.trim() && !exactTag)) && (
        <div className="tag-picker-menu">
          {matches.map((tag) => (
            <button type="button" key={tag.id} onMouseDown={(event) => event.preventDefault()} onClick={() => add(tag.name)}>
              <strong>{tag.name}</strong>
              {!!tag.aliases?.length && <small>{tag.aliases.join(" · ")}</small>}
            </button>
          ))}
          {allowCreate && query.trim() && !exactTag && (
            <button type="button" className="tag-picker-create" disabled={saving} onMouseDown={(event) => event.preventDefault()} onClick={createTag}>
              {saving ? "등록 중..." : `“${query.trim()}” 새 태그 등록`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default TagPicker;
