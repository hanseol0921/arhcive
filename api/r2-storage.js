import { DeleteObjectsCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createClient } from "@supabase/supabase-js";
import process from "node:process";

const requiredEnv = [
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_ENDPOINT",
  "R2_BUCKET",
  "R2_PUBLIC_BASE_URL",
];

function json(response, status, body) {
  response.status(status).json(body);
}

function validKey(key) {
  return typeof key === "string"
    && /^(photos|videos)\//.test(key)
    && !key.includes("..")
    && !key.includes("\\")
    && key.length <= 1024;
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return json(response, 405, { error: "POST 요청만 허용됩니다." });
  }

  const missing = requiredEnv.filter((name) => !process.env[name]);
  if (missing.length) {
    return json(response, 500, { error: `서버 설정 누락: ${missing.join(", ")}` });
  }

  const token = request.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) return json(response, 401, { error: "로그인이 필요합니다." });

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return json(response, 401, { error: "관리자 로그인이 만료되었습니다." });

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

  const { action, key, keys, contentType } = request.body || {};

  try {
    if (action === "sign-upload") {
      if (!validKey(key)) return json(response, 400, { error: "올바르지 않은 파일 경로입니다." });
      const command = new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: key,
        ContentType: contentType || "application/octet-stream",
        CacheControl: "public, max-age=31536000, immutable",
      });
      const uploadUrl = await getSignedUrl(r2, command, { expiresIn: 900 });
      const encodedKey = key.split("/").map(encodeURIComponent).join("/");
      return json(response, 200, {
        uploadUrl,
        publicUrl: `${process.env.R2_PUBLIC_BASE_URL.replace(/\/$/, "")}/${encodedKey}`,
      });
    }

    if (action === "delete") {
      const safeKeys = Array.isArray(keys) ? [...new Set(keys)].filter(validKey) : [];
      if (!safeKeys.length || safeKeys.length > 1000) {
        return json(response, 400, { error: "삭제할 파일 경로가 올바르지 않습니다." });
      }
      await r2.send(new DeleteObjectsCommand({
        Bucket: process.env.R2_BUCKET,
        Delete: { Objects: safeKeys.map((item) => ({ Key: item })), Quiet: true },
      }));
      return json(response, 200, { deleted: safeKeys.length });
    }

    return json(response, 400, { error: "알 수 없는 작업입니다." });
  } catch (error) {
    console.error("R2 storage API error", error);
    return json(response, 500, { error: "R2 작업을 완료하지 못했습니다." });
  }
}
