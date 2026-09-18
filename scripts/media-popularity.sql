alter table public.photos
  add column if not exists view_count bigint not null default 0,
  add column if not exists download_count bigint not null default 0,
  add column if not exists weverse_click_count bigint not null default 0;

alter table public.videos
  add column if not exists view_count bigint not null default 0,
  add column if not exists download_count bigint not null default 0,
  add column if not exists weverse_click_count bigint not null default 0;

create or replace function public.increment_media_engagement(
  p_media_type text,
  p_media_id text,
  p_metric text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_table text;
  target_column text;
begin
  target_table := case p_media_type
    when 'photo' then 'photos'
    when 'video' then 'videos'
    else null
  end;

  target_column := case p_metric
    when 'view' then 'view_count'
    when 'download' then 'download_count'
    when 'weverse' then 'weverse_click_count'
    else null
  end;

  if target_table is null or target_column is null then
    raise exception 'invalid media engagement target';
  end if;

  execute format(
    'update public.%I set %I = coalesce(%I, 0) + 1 where id::text = $1',
    target_table,
    target_column,
    target_column
  ) using p_media_id;
end;
$$;

revoke all on function public.increment_media_engagement(text, text, text) from public;
grant execute on function public.increment_media_engagement(text, text, text) to anon, authenticated;
