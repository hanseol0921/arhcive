import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createClient } from "@supabase/supabase-js";

const required = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_ENDPOINT",
  "R2_BUCKET",
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
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

const bucket = process.env.R2_BUCKET;
const tempRoot = path.join(tmpdir(), "riwoo-r2-migration");
const concurrency = Math.max(1, Math.min(6, Number(process.env.MIGRATION_CONCURRENCY || 3)));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readAll(table, columns) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

function parseSupabaseObject(publicUrl, expectedBucket) {
  if (!publicUrl) return null;
  const url = new URL(publicUrl);
  if (!url.hostname.endsWith("supabase.co")) return null;
  const marker = `/storage/v1/object/public/${expectedBucket}/`;
  const markerIndex = url.pathname.indexOf(marker);
  if (markerIndex < 0) return null;
  const encodedPath = url.pathname.slice(markerIndex + marker.length);
  let objectPath = encodedPath;
  try {
    objectPath = decodeURIComponent(encodedPath);
  } catch {
    // 이미 안전한 경로라면 원문을 사용한다.
  }
  return {
    sourceUrl: publicUrl,
    key: `${expectedBucket}/${objectPath}`,
  };
}

function buildTasks(photos, videos) {
  const unique = new Map();
  const add = (url, sourceBucket, kind) => {
    const parsed = parseSupabaseObject(url, sourceBucket);
    if (parsed && !unique.has(parsed.key)) {
      unique.set(parsed.key, { ...parsed, kind });
    }
  };
  for (const photo of photos) {
    add(photo.image_url, "photos", "사진 원본");
    add(photo.thumbnail_url, "photos", "사진 썸네일");
  }
  for (const video of videos) {
    add(video.video_url, "videos", "동영상 원본");
    add(video.thumbnail_url, "videos", "동영상 썸네일");
  }
  return [...unique.values()];
}

async function sourceMetadata(url) {
  const response = await fetch(url, { method: "HEAD" });
  if (!response.ok) throw new Error(`원본 HEAD HTTP ${response.status}`);
  const lengthHeader = response.headers.get("content-length");
  return {
    length: lengthHeader ? Number(lengthHeader) : null,
    contentType: response.headers.get("content-type") || "application/octet-stream",
  };
}

async function targetMetadata(key) {
  try {
    const result = await r2.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return { length: Number(result.ContentLength), metadata: result.Metadata || {} };
  } catch (error) {
    const status = error?.$metadata?.httpStatusCode;
    if (status === 404 || error?.name === "NotFound" || error?.name === "NoSuchKey") {
      return null;
    }
    throw error;
  }
}

async function downloadToTemp(task) {
  const response = await fetch(task.sourceUrl);
  if (!response.ok || !response.body) {
    throw new Error(`원본 다운로드 HTTP ${response.status}`);
  }
  const tempPath = path.join(tempRoot, `${randomUUID()}.part`);
  const hash = createHash("sha256");
  const hashStream = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(response.body),
    hashStream,
    createWriteStream(tempPath),
  );
  const fileStat = await stat(tempPath);
  return {
    tempPath,
    size: fileStat.size,
    sha256: hash.digest("hex"),
    contentType: response.headers.get("content-type") || "application/octet-stream",
  };
}

async function migrateOne(task) {
  const source = await sourceMetadata(task.sourceUrl);
  const existing = await targetMetadata(task.key);
  if (existing && source.length !== null && existing.length === source.length) {
    return { status: "skipped", bytes: existing.length };
  }

  const downloaded = await downloadToTemp(task);
  try {
    if (source.length !== null && source.length !== downloaded.size) {
      throw new Error(`원본 크기 불일치: HEAD ${source.length}, 다운로드 ${downloaded.size}`);
    }
    await r2.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: task.key,
        Body: createReadStream(downloaded.tempPath),
        ContentLength: downloaded.size,
        ContentType: downloaded.contentType || source.contentType,
        CacheControl: "public, max-age=31536000, immutable",
        Metadata: { "source-sha256": downloaded.sha256 },
      }),
    );
    const copied = await targetMetadata(task.key);
    if (!copied || copied.length !== downloaded.size) {
      throw new Error(`R2 크기 검증 실패: ${copied?.length ?? "없음"}`);
    }
    return { status: "copied", bytes: downloaded.size };
  } finally {
    await rm(downloaded.tempPath, { force: true });
  }
}

async function withRetry(task) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await migrateOne(task);
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(attempt * 1000);
    }
  }
  throw lastError;
}

await mkdir(tempRoot, { recursive: true });
const [photos, videos] = await Promise.all([
  readAll("photos", "id,image_url,thumbnail_url"),
  readAll("videos", "id,video_url,thumbnail_url"),
]);
const tasks = buildTasks(photos, videos);

console.log(`이전 대상 고유 파일: ${tasks.length.toLocaleString("ko-KR")}개`);
console.log(`동시 처리: ${concurrency}개`);
console.log("DB 수정: 안 함 / Supabase 삭제: 안 함");

let nextIndex = 0;
let completed = 0;
let copied = 0;
let skipped = 0;
let failed = 0;
let copiedBytes = 0;
const errors = [];

async function worker() {
  while (true) {
    const index = nextIndex++;
    if (index >= tasks.length) return;
    const task = tasks[index];
    try {
      const result = await withRetry(task);
      if (result.status === "copied") {
        copied++;
        copiedBytes += result.bytes;
      } else {
        skipped++;
      }
    } catch (error) {
      failed++;
      errors.push({ key: task.key, message: error?.message || String(error) });
      console.error(`실패: ${task.key} - ${error?.message || error}`);
    } finally {
      completed++;
      if (completed % 10 === 0 || completed === tasks.length) {
        console.log(
          `[${completed.toLocaleString("ko-KR")}/${tasks.length.toLocaleString("ko-KR")}] ` +
          `복사 ${copied.toLocaleString("ko-KR")} / 건너뜀 ${skipped.toLocaleString("ko-KR")} / 실패 ${failed.toLocaleString("ko-KR")}`,
        );
      }
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));
await rm(tempRoot, { recursive: true, force: true });

console.log("\nR2 파일 복사 작업 완료");
console.log(`새로 복사: ${copied.toLocaleString("ko-KR")}개`);
console.log(`기존 파일 건너뜀: ${skipped.toLocaleString("ko-KR")}개`);
console.log(`실패: ${failed.toLocaleString("ko-KR")}개`);
console.log(`이번 실행 복사량: ${(copiedBytes / 1024 / 1024 / 1024).toFixed(2)} GB`);

if (errors.length) {
  console.log("실패 목록:");
  for (const item of errors) console.log(`- ${item.key}: ${item.message}`);
  process.exitCode = 1;
}
