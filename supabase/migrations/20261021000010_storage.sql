-- =============================================================================
-- Médico en Casa Palmira — 0010: almacenamiento de archivos (Supabase Storage)
-- Rutas: <bucket>/<user_id>/<archivo>. Solo se ejecuta si existe el esquema storage.
-- =============================================================================
do $outer$
begin
  if not exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    raise notice 'Esquema storage no existe: se omiten buckets (entorno sin Supabase).';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
    ('professional-photos', 'professional-photos', true, 3145728, array['image/jpeg', 'image/png', 'image/webp']),
    ('professional-documents', 'professional-documents', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png']),
    ('payout-receipts', 'payout-receipts', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png'])
  on conflict (id) do nothing;

  -- Fotos: lectura pública; escritura solo en la carpeta propia.
  execute $p$create policy photos_owner_write on storage.objects for insert to authenticated
    with check (bucket_id = 'professional-photos' and (storage.foldername(name))[1] = auth.uid()::text)$p$;
  execute $p$create policy photos_owner_update on storage.objects for update to authenticated
    using (bucket_id = 'professional-photos' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()))$p$;
  execute $p$create policy photos_owner_delete on storage.objects for delete to authenticated
    using (bucket_id = 'professional-photos' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()))$p$;
  execute $p$create policy photos_admin_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'professional-photos' and public.is_admin())$p$;

  -- Documentos privados: el profesional ve y sube lo suyo; el administrador ve todo.
  execute $p$create policy docs_owner_read on storage.objects for select to authenticated
    using (bucket_id = 'professional-documents' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()))$p$;
  execute $p$create policy docs_owner_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'professional-documents' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()))$p$;

  -- Comprobantes de liquidación: solo administrador escribe; el profesional lee su carpeta.
  execute $p$create policy receipts_read on storage.objects for select to authenticated
    using (bucket_id = 'payout-receipts' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()))$p$;
  execute $p$create policy receipts_admin_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'payout-receipts' and public.is_admin())$p$;
end $outer$;
