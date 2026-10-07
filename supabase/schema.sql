-- ============================================================
-- 作业打卡 APP 数据库脚本：在 Supabase → SQL Editor 里粘贴执行
-- ============================================================

-- 用户资料（挂在 auth.users 上，存角色）
create table if not exists public.profiles (
  id         uuid primary key references auth.users on delete cascade,
  name       text,
  role       text not null default 'student' check (role in ('student','parent','admin')),
  parent_id  uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- 作业
create table if not exists public.homework (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles(id) on delete cascade,
  subject           text,
  title             text not null,
  description       text,
  deadline          timestamptz,
  estimated_minutes int default 30,
  difficulty        text default '中等',
  status            text not null default 'pending' check (status in ('pending','done')),
  plan_date         date,
  plan_order        int,
  done_at           timestamptz,
  created_at        timestamptz not null default now()
);

-- 每日打卡记录
create table if not exists public.checkins (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  date       date not null default current_date,
  created_at timestamptz not null default now()
);

create index if not exists idx_hw_user on public.homework(user_id);
create index if not exists idx_ck_user on public.checkins(user_id);

-- 开启行级安全
alter table public.profiles enable row level security;
alter table public.homework  enable row level security;
alter table public.checkins  enable row level security;

-- profiles：都能读（看名字/角色），本人可建可改，管理员可改所有人
create policy "profiles_read"       on public.profiles for select using (true);
create policy "profiles_insert_own" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id);
create policy "profiles_update_admin" on public.profiles for update
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- homework：本人可增删改查；家长看自己孩子；管理员看全部
create policy "hw_select" on public.homework for select using (
  auth.uid() = user_id
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  or exists (select 1 from public.profiles s where s.id = homework.user_id and s.parent_id = auth.uid())
);
create policy "hw_insert_own" on public.homework for insert with check (auth.uid() = user_id);
create policy "hw_update_own" on public.homework for update using (auth.uid() = user_id);
create policy "hw_delete_own" on public.homework for delete using (auth.uid() = user_id);

-- checkins：同上
create policy "ck_select" on public.checkins for select using (
  auth.uid() = user_id
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  or exists (select 1 from public.profiles s where s.id = checkins.user_id and s.parent_id = auth.uid())
);
create policy "ck_insert_own" on public.checkins for insert with check (auth.uid() = user_id);
