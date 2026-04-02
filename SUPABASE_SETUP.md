# Supabase Kurulum (Üretim Hazırlığı)

## 1) Tablo
```sql
create table if not exists public.spots (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  location text,
  historical_note text,
  tags jsonb not null default '[]'::jsonb,
  photos jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  last_visit_at timestamptz,
  visit_count integer not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists spots_user_created_idx on public.spots(user_id, created_at desc);
```

## 2) RLS
```sql
alter table public.spots enable row level security;

create policy "spot_select_own" on public.spots
for select using (auth.uid() = user_id);

create policy "spot_insert_own" on public.spots
for insert with check (auth.uid() = user_id);

create policy "spot_update_own" on public.spots
for update using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "spot_delete_own" on public.spots
for delete using (auth.uid() = user_id);
```

## 3) İstemci yapılandırması
Uygulama `window.__SUPABASE_CONFIG` bekler:

```html
<script>
window.__SUPABASE_CONFIG = {
  url: "https://YOUR_PROJECT.supabase.co",
  anonKey: "YOUR_ANON_KEY"
};
</script>
```

Bu script `index.html` içindeki uygulama scriptinden önce yüklenmelidir.
