-- Town Red
-- Optional source URL for markers captured from external property listings.

alter table public.markers
  add column source_url text;

alter table public.markers
  add constraint markers_source_url_length
  check (source_url is null or char_length(source_url) <= 2048);

create unique index markers_map_source_url_unique
  on public.markers(map_id, source_url)
  where source_url is not null;
