import { supabase } from "./supabaseClient";

export function getPopularityScore(item) {
  return (
    Number(item?.view_count || 0) * 2 +
    Number(item?.download_count || 0) * 5 +
    Number(item?.weverse_click_count || 0) * 3
  );
}

export async function trackMediaEngagement(mediaType, mediaId, metric) {
  if (!mediaId || !["photo", "video"].includes(mediaType)) return;

  const { error } = await supabase.rpc("increment_media_engagement", {
    p_media_type: mediaType,
    p_media_id: String(mediaId),
    p_metric: metric,
  });

  if (error) console.warn("인기도 집계 실패:", error.message);
}
