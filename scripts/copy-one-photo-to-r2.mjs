import { createHash } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
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

const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length) {
  console.error(`누락된 설정: ${missing.join(", ")}`);
  process.exit(1);
}

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

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sourcePath(publicUrl, bucket) {
  const url = new URL(publicUrl);
  const marker = `/storage/v1/object/public/${bucket}/`;
  const index = url.pathname.indexOf(marker);
  if (index < 0) throw new Error(`Supabase ${bucket} 공개 URL 형식이 아닙니다.`);
  return decodeURIComponent(url.pathname.slice(index + marker.length));
}

function publicR2Url(key) {
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `${process.env.R2_PUBLIC_BASE_URL.replace(/\/$/, "")}/${encodedKey}`;
}

const { data: photo, error } = await supabase
  .from("photos")
  .select("id,image_url")
  .not("image_url", "is", null)
  .order("id", { ascending: true })
  .limit(1)
  .single();

if (error) throw new Error(`사진 레코드 조회 실패: ${error.message}`);

const originalResponse = await fetch(photo.image_url);
if (!originalResponse.ok) {
  throw new Error(`Supabase 원본 다운로드 실패: HTTP ${originalResponse.status}`);
}

const originalBytes = Buffer.from(await originalResponse.arrayBuffer());
const path = sourcePath(photo.image_url, "photos");
const key = `photos/${path}`;
const contentType = originalResponse.headers.get("content-type") || "application/octet-stream";

await r2.send(
  new PutObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: key,
    Body: originalBytes,
    ContentType: contentType,
    CacheControl: "public, max-age=31536000, immutable",
  }),
);

const copiedResponse = await fetch(publicR2Url(key), { cache: "no-store" });
if (!copiedResponse.ok) {
  throw new Error(`R2 사본 확인 실패: HTTP ${copiedResponse.status}`);
}

const copiedBytes = Buffer.from(await copiedResponse.arrayBuffer());
const originalHash = sha256(originalBytes);
const copiedHash = sha256(copiedBytes);

if (originalHash !== copiedHash) {
  throw new Error("복사 후 SHA-256 해시가 일치하지 않습니다.");
}

console.log("사진 1장 R2 복사 및 검증 성공");
console.log(`DB 사진 ID: ${photo.id}`);
console.log(`R2 객체 경로: ${key}`);
console.log(`파일 크기: ${originalBytes.length.toLocaleString("ko-KR")} bytes`);
console.log("SHA-256 일치: 예");
