import { supabase } from "./supabaseClient";

async function callStorageApi(body) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("관리자 로그인이 필요합니다.");

  const response = await fetch("/api/r2-storage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "R2 요청에 실패했습니다.");
  return result;
}

export async function uploadToR2(bucket, path, file, contentType = file.type) {
  const key = `${bucket}/${path.replace(/^\/+/, "")}`;
  const type = contentType || "application/octet-stream";
  const { uploadUrl, publicUrl } = await callStorageApi({
    action: "sign-upload",
    key,
    contentType: type,
  });

  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": type },
    body: file,
  });
  if (!uploadResponse.ok) {
    throw new Error(`R2 업로드 실패 (HTTP ${uploadResponse.status})`);
  }
  return { key, publicUrl };
}

export async function deleteFromR2(keys) {
  const safeKeys = [...new Set((keys || []).filter(Boolean))];
  if (!safeKeys.length) return;
  await callStorageApi({ action: "delete", keys: safeKeys });
}

export function getR2Key(publicUrl) {
  if (!publicUrl) return null;
  try {
    const url = new URL(publicUrl);
    if (url.hostname !== "media.riwooarchive.com") return null;
    return decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  } catch {
    return null;
  }
}
