/**
 * 索引库表结构（M2b T3.1）。
 *
 * 两条跟计划原文不一样、值得记住的地方：
 *
 * 1. **`files.path` 上不是普通 unique，而是「只在没被软删除时唯一」的部分索引**。
 *    软删除（`missing_at`）要求同一路径可以同时存在「历史行」和「新行」：
 *    把 A 移出目录（行标 missing，标签留着），几天后又在同路径新建一张同名稿 ——
 *    如果 path 是全局 unique，这一下就插不进去。
 *
 * 2. **标签按 `files.id` 关联，不按 path**。改名沿用旧 id 是「改名不丢标签」的
 *    唯一实现方式；删旧插新会 `on delete cascade` 把标签一起删掉。
 */
export const SCHEMA_VERSION = 1

export const DDL = `
create table if not exists projects (
  id       integer primary key,
  name     text not null unique,
  client   text not null default '',
  color    text,
  archived integer not null default 0
);

create table if not exists tags (
  id    integer primary key,
  name  text not null unique,
  color text
);

create table if not exists files (
  id         integer primary key,
  path       text not null,
  dir        text not null,
  name       text not null,
  ext        text not null,
  size       integer not null,
  mtime      integer not null,
  dev        text,
  ino        text,
  width      integer,
  height     integer,
  thumb_key  text,
  project_id integer references projects(id) on delete set null,
  first_seen integer not null,
  last_seen  integer not null,
  missing_at integer
);

create unique index if not exists files_path_live
  on files(path) where missing_at is null;

-- 身份索引：改名 / 同盘移动后靠它认出"还是同一个文件"
create index if not exists files_ident
  on files(dev, ino) where dev is not null and ino is not null;

create index if not exists files_mtime on files(mtime desc);

-- 过期清理只扫这一小撮
create index if not exists files_missing
  on files(missing_at) where missing_at is not null;

create table if not exists file_tags (
  file_id integer not null references files(id) on delete cascade,
  tag_id  integer not null references tags(id)  on delete cascade,
  source  text not null default 'manual',
  primary key (file_id, tag_id)
);

create index if not exists file_tags_tag on file_tags(tag_id);

create table if not exists auto_tag_rules (
  prefix text primary key,
  tag_id integer not null references tags(id) on delete cascade
);
`
