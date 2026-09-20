-- Supabase SQL Editor에서 한 번에 실행합니다.
-- 기존 URL은 백업 테이블에 보존하며, R2 파일이나 Supabase 원본은 삭제하지 않습니다.

begin;

create table if not exists public.media_url_backup_20260912 (
  source_table text not null,
  row_id text not null,
  image_url text,
  video_url text,
  thumbnail_url text,
  backed_up_at timestamptz not null default now(),
  primary key (source_table, row_id)
);

insert into public.media_url_backup_20260912
  (source_table, row_id, image_url, thumbnail_url)
select 'photos', id::text, image_url, thumbnail_url
from public.photos
where coalesce(image_url, '') like '%supabase.co/storage/v1/object/public/photos/%'
   or coalesce(thumbnail_url, '') like '%supabase.co/storage/v1/object/public/photos/%'
on conflict (source_table, row_id) do nothing;

insert into public.media_url_backup_20260912
  (source_table, row_id, video_url, thumbnail_url)
select 'videos', id::text, video_url, thumbnail_url
from public.videos
where coalesce(video_url, '') like '%supabase.co/storage/v1/object/public/videos/%'
   or coalesce(thumbnail_url, '') like '%supabase.co/storage/v1/object/public/videos/%'
on conflict (source_table, row_id) do nothing;

update public.photos
set image_url = regexp_replace(
  image_url,
  '^https://[^/]+\.supabase\.co/storage/v1/object/public/photos/',
  'https://media.riwooarchive.com/photos/'
)
where image_url ~ '^https://[^/]+\.supabase\.co/storage/v1/object/public/photos/';

update public.photos
set thumbnail_url = regexp_replace(
  thumbnail_url,
  '^https://[^/]+\.supabase\.co/storage/v1/object/public/photos/',
  'https://media.riwooarchive.com/photos/'
)
where thumbnail_url ~ '^https://[^/]+\.supabase\.co/storage/v1/object/public/photos/';

update public.videos
set video_url = regexp_replace(
  video_url,
  '^https://[^/]+\.supabase\.co/storage/v1/object/public/videos/',
  'https://media.riwooarchive.com/videos/'
)
where video_url ~ '^https://[^/]+\.supabase\.co/storage/v1/object/public/videos/';

update public.videos
set thumbnail_url = regexp_replace(
  thumbnail_url,
  '^https://[^/]+\.supabase\.co/storage/v1/object/public/videos/',
  'https://media.riwooarchive.com/videos/'
)
where thumbnail_url ~ '^https://[^/]+\.supabase\.co/storage/v1/object/public/videos/';

commit;

select
  (select count(*) from public.photos
   where image_url like 'https://media.riwooarchive.com/%') as photo_originals_on_r2,
  (select count(*) from public.photos
   where thumbnail_url like 'https://media.riwooarchive.com/%') as photo_thumbnails_on_r2,
  (select count(*) from public.videos
   where video_url like 'https://media.riwooarchive.com/%') as video_originals_on_r2,
  (select count(*) from public.videos
   where thumbnail_url like 'https://media.riwooarchive.com/%') as video_thumbnails_on_r2;
