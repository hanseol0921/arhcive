import process from "node:process";
import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";

const required = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_ENDPOINT",
  "R2_BUCKET",
  "R2_PUBLIC_BASE_URL",
];
const missingEnv = required.filter((name) => !process.env[name]);
if (missingEnv.length) throw new Error(`누락된 설정: ${missingEnv.join(", ")}`);

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const r2 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT.replace(/\/$/, ""),
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function readAll(table, columns) {
  const result = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + 999);
    if (error) throw error;
    result.push(...(data || []));
    if (!data || data.length < 1000) return result;
  }
}

async function listAllR2Keys() {
  const keys = new Set();
  let token;
  do {
    const page = await r2.send(new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET,
      ContinuationToken: token,
    }));
    for (const object of page.Contents || []) keys.add(object.Key);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

function keyFromR2Url(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    const base = new URL(process.env.R2_PUBLIC_BASE_URL);
    if (url.origin !== base.origin) return null;
    return decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  } catch {
    return null;
  }
}

const [photos, videos, r2Keys] = await Promise.all([
  readAll("photos", "id,image_url,thumbnail_url"),
  readAll("videos", "id,video_url,thumbnail_url"),
  listAllR2Keys(),
]);

const references = [];
for (const photo of photos) {
  references.push({ table: "photos", id: photo.id, column: "image_url", url: photo.image_url });
  if (photo.thumbnail_url) references.push({ table: "photos", id: photo.id, column: "thumbnail_url", url: photo.thumbnail_url });
}
for (const video of videos) {
  references.push({ table: "videos", id: video.id, column: "video_url", url: video.video_url });
  if (video.thumbnail_url) references.push({ table: "videos", id: video.id, column: "thumbnail_url", url: video.thumbnail_url });
}

const nonR2 = references.filter((item) => !keyFromR2Url(item.url));
const missing = references.filter((item) => {
  const key = keyFromR2Url(item.url);
  return key && !r2Keys.has(key);
});

console.log(`DB 사진 행: ${photos.length}`);
console.log(`DB 동영상 행: ${videos.length}`);
console.log(`DB 미디어 URL: ${references.length}`);
console.log(`R2 전체 객체: ${r2Keys.size}`);
console.log(`R2가 아닌 미디어 URL: ${nonR2.length}`);
console.log(`R2에서 누락된 참조 파일: ${missing.length}`);

if (nonR2.length) console.log("R2가 아닌 URL 예시:", nonR2.slice(0, 10));
if (missing.length) console.log("누락 예시:", missing.slice(0, 10));
if (nonR2.length || missing.length) process.exit(1);

console.log("전환 전수 검증 통과");
