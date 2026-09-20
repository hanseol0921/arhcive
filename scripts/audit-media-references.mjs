import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

async function readAll(table, columns) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(from, from + pageSize - 1);
    if (error) return { rows: [], error };
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return { rows, error: null };
  }
}

function hasSupabaseMediaUrl(value) {
  return typeof value === "string" &&
    value.includes("supabase.co/storage/v1/object/public/");
}

function serializedHasMediaUrl(value) {
  return hasSupabaseMediaUrl(JSON.stringify(value));
}

const posts = await readAll("weverse_posts", "id,content_blocks");
if (posts.error) throw new Error(`게시글 조사 실패: ${posts.error.message}`);

const blocksWithUrls = posts.rows.filter((row) =>
  serializedHasMediaUrl(row.content_blocks),
);
const blocksWithMediaIndexes = posts.rows.filter((row) =>
  Array.isArray(row.content_blocks) &&
  row.content_blocks.some((block) => block?.type === "photo" || block?.type === "video"),
);

const guestbook = await readAll(
  "guestbook_public",
  "id,profile_image_url",
);
const guestbookMediaUrls = guestbook.error
  ? null
  : guestbook.rows.filter((row) => hasSupabaseMediaUrl(row.profile_image_url));

const reports = await readAll("content_reports", "id,preview_url");
const reportMediaUrls = reports.error
  ? null
  : reports.rows.filter((row) => hasSupabaseMediaUrl(row.preview_url));

const settings = await readAll("site_settings", "key,value");
const settingMediaUrls = settings.error
  ? null
  : settings.rows.filter((row) => serializedHasMediaUrl(row.value));

console.log("미디어 URL 중복 참조 조사 완료");
console.log(`content_blocks가 있는 게시글: ${blocksWithMediaIndexes.length.toLocaleString("ko-KR")}개`);
console.log(`content_blocks 안에 직접 URL이 있는 게시글: ${blocksWithUrls.length.toLocaleString("ko-KR")}개`);
console.log(
  guestbookMediaUrls === null
    ? `방명록 URL 조사 불가: ${guestbook.error.message}`
    : `방명록의 Supabase 미디어 URL: ${guestbookMediaUrls.length.toLocaleString("ko-KR")}개`,
);
console.log(
  reportMediaUrls === null
    ? `제보 URL 조사 불가: ${reports.error.message}`
    : `제보의 Supabase 미디어 URL: ${reportMediaUrls.length.toLocaleString("ko-KR")}개`,
);
console.log(
  settingMediaUrls === null
    ? `사이트 설정 URL 조사 불가: ${settings.error.message}`
    : `사이트 설정의 Supabase 미디어 URL: ${settingMediaUrls.length.toLocaleString("ko-KR")}개`,
);
