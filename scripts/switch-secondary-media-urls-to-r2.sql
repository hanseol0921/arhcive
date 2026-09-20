begin;

-- 방명록에서 선택한 사진 프로필 URL
update public.guestbook
set profile_image_url = regexp_replace(
  profile_image_url,
  '^https://[^/]+\.supabase\.co/storage/v1/object/public/photos/',
  'https://media.riwooarchive.com/photos/'
)
where profile_image_url ~ '^https://[^/]+\.supabase\.co/storage/v1/object/public/photos/';

-- 사진·동영상 제보에 저장된 미리보기 URL
update public.content_reports
set preview_url = regexp_replace(
  preview_url,
  '^https://[^/]+\.supabase\.co/storage/v1/object/public/(photos|videos)/',
  'https://media.riwooarchive.com/\1/'
)
where preview_url ~ '^https://[^/]+\.supabase\.co/storage/v1/object/public/(photos|videos)/';

commit;

select
  (select count(*) from public.guestbook
   where coalesce(profile_image_url, '') like '%supabase.co/storage/v1/object/public/photos/%')
    as guestbook_supabase_urls,
  (select count(*) from public.content_reports
   where coalesce(preview_url, '') like '%supabase.co/storage/v1/object/public/%')
    as report_supabase_urls;
