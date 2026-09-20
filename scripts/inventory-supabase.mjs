import { createClient } from "@supabase/supabase-js";

const url = process.env.VITE_SUPABASE_URL?.trim();
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

if (!url || !key) {
  console.error(".env.local에서 Supabase 공개 연결 설정을 찾지 못했습니다.");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function exactCount(table, configure = (query) => query) {
  const query = configure(
    supabase.from(table).select("*", { count: "exact", head: true }),
  );
  const { count, error } = await query;
  if (error) throw new Error(`${table} 개수 조회 실패: ${error.message}`);
  return count ?? 0;
}

function classifyUrl(value) {
  if (!value) return "없음";
  try {
    const hostname = new URL(value).hostname;
    if (hostname.endsWith("supabase.co")) return "Supabase Storage";
    if (hostname.endsWith("r2.dev")) return "Cloudflare R2";
    return `기타 도메인(${hostname})`;
  } catch {
    return "잘못된 URL";
  }
}

try {
  const [photos, videos, posts, photoThumbs, videoThumbs] = await Promise.all([
    exactCount("photos"),
    exactCount("videos"),
    exactCount("weverse_posts"),
    exactCount("photos", (query) => query.not("thumbnail_url", "is", null)),
    exactCount("videos", (query) => query.not("thumbnail_url", "is", null)),
  ]);

  const [photoResult, videoResult] = await Promise.all([
    supabase.from("photos").select("image_url,thumbnail_url").limit(1).maybeSingle(),
    supabase.from("videos").select("video_url,thumbnail_url").limit(1).maybeSingle(),
  ]);

  if (photoResult.error) {
    throw new Error(`사진 URL 확인 실패: ${photoResult.error.message}`);
  }
  if (videoResult.error) {
    throw new Error(`동영상 URL 확인 실패: ${videoResult.error.message}`);
  }

  console.log("Supabase 이전 대상 조사 완료");
  console.log(`사진 레코드: ${photos.toLocaleString("ko-KR")}개`);
  console.log(`사진 썸네일 레코드: ${photoThumbs.toLocaleString("ko-KR")}개`);
  console.log(`동영상 레코드: ${videos.toLocaleString("ko-KR")}개`);
  console.log(`동영상 썸네일 레코드: ${videoThumbs.toLocaleString("ko-KR")}개`);
  console.log(`게시글 레코드: ${posts.toLocaleString("ko-KR")}개`);
  console.log(`사진 원본 위치: ${classifyUrl(photoResult.data?.image_url)}`);
  console.log(`사진 썸네일 위치: ${classifyUrl(photoResult.data?.thumbnail_url)}`);
  console.log(`동영상 원본 위치: ${classifyUrl(videoResult.data?.video_url)}`);
  console.log(`동영상 썸네일 위치: ${classifyUrl(videoResult.data?.thumbnail_url)}`);
} catch (error) {
  console.error(error?.message || String(error));
  process.exit(1);
}
