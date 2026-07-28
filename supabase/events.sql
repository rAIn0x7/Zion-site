-- ══ Zion 站极简事件度量表 ══
-- 只记"发生了什么类型的事",不记是谁、不记用户输入。
--
-- 这份 DDL 就是线上表的唯一真源(已在 project uzvguynixndzusrlqryo 执行过,幂等可重跑)。
-- 重跑方式:
--   BODY=$(python3 -c 'import json;print(json.dumps({"query":open("supabase/events.sql").read()}))')
--   curl -X POST https://api.supabase.com/v1/projects/uzvguynixndzusrlqryo/database/query \
--     -H "Authorization: Bearer $(cat ~/.supabase_pat)" -H 'Content-Type: application/json' \
--     --data-binary "$BODY"
--
-- 前端埋点:assets/track.js(唯一真源)+ ce/engine.js 里的调用点;看数:node scripts/stats.js
-- 隐私声明:privacy.html → "Product Analytics (Self-Hosted, Cookie-Free)"
create table if not exists public.events (
  id   bigint generated always as identity primary key,
  ts   timestamptz  not null default now(),
  name text         not null,
  tool text,
  host text         not null default 'other',
  ref  text         not null default 'other',
  meta jsonb,
  -- 事件名白名单(库层兜底,前端也有一份)
  constraint events_name_ck check (name in
    ('result_shown','share_click','copy_report','unlock','cross_click','qr_shown')),
  -- 工具 id:短、无个人信息
  constraint events_tool_ck check (tool is null or tool ~ '^[a-z0-9_-]{1,24}$'),
  -- host 归一成大类:main=qizh.space 主站 / mirror=rain0x7.github.io 镜像
  constraint events_host_ck check (host in ('main','mirror','local','other')),
  -- 来源大类(从 referrer 归类,绝不存完整 URL)
  constraint events_ref_ck  check (ref  in ('wechat','search','social','internal','direct','other')),
  -- meta 只能是小对象:防止有人拿它当免费图床/塞长文本
  constraint events_meta_ck check (meta is null or (jsonb_typeof(meta)='object' and pg_column_size(meta) < 300))
);

create index if not exists events_ts_idx        on public.events (ts desc);
create index if not exists events_name_ts_idx   on public.events (name, ts desc);
create index if not exists events_tool_ts_idx   on public.events (tool, ts desc);

-- ══ 服务端防爆表:全站每分钟插入上限(anon key 是公开的,客户端节流可被绕过)══
create or replace function public.events_rate_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  select count(*) into n from public.events where ts > now() - interval '1 minute';
  if n > 600 then
    raise exception 'events rate limit exceeded';
  end if;
  return new;
end $$;

drop trigger if exists events_rate_guard_t on public.events;
create trigger events_rate_guard_t before insert on public.events
  for each row execute function public.events_rate_guard();

-- ══ RLS:anon 只能 insert,绝不能 select/update/delete ══
alter table public.events enable row level security;
alter table public.events force row level security;

revoke all on public.events from anon, authenticated, public;
grant insert on public.events to anon;

drop policy if exists events_anon_insert on public.events;
create policy events_anon_insert on public.events for insert to anon with check (true);
