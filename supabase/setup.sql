-- Run once in a new Supabase project's SQL editor. (The piano-visualizer project already has the same bucket and
-- rules, made through the dashboard's Storage screens.)
-- A private place for song files, where each signed-in person reaches only the files under their own id.
insert into storage.buckets (id, name, public) values ('songs', 'songs', false) on conflict (id) do nothing;

create policy "read own songs" on storage.objects for select to authenticated
  using (bucket_id = 'songs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "add own songs" on storage.objects for insert to authenticated
  with check (bucket_id = 'songs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "replace own songs" on storage.objects for update to authenticated
  using (bucket_id = 'songs' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'songs' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "remove own songs" on storage.objects for delete to authenticated
  using (bucket_id = 'songs' and (storage.foldername(name))[1] = (select auth.uid())::text);
