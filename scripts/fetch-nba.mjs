#!/usr/bin/env node
// 从 balldontlie 拉取一个 NBA 赛季的赛程，精简后写入 sports/nba-<赛季>.json。
// 只输出赛程（时间、对阵、常规赛 / 季后赛、状态）和已结束比赛的最终比分；不输出每节比分、球员和技术统计：
// 这份文件只给 TabTerrace 扩展用，不是替代 balldontlie 的数据接口（见其服务条款第 6 条）。
//
// 用法：BALLDONTLIE_KEY=xxx node scripts/fetch-nba.mjs [赛季开始年份]
//   不写赛季时按当前日期推算：8 月及以后是当年开始的赛季，之前是上一年开始的赛季。
// 任何一步失败都直接退出、不写文件，保留上一份数据。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://api.balldontlie.io/v1/games';
const PER_PAGE = 100;
// 免费版每分钟 5 次：每次请求间隔 13 秒，留一点余量
const GAP_MS = 13_000;
const MAX_PAGES = 40;
const MAX_RETRIES = 4;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function seasonFor(now = new Date()) {
  return now.getUTCMonth() >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

const STATES = new Set(['scheduled', 'in_progress', 'final', 'postponed', 'canceled', 'delayed', 'suspended', 'abandoned']);
const team = value => ({ abbr: String(value?.abbreviation || ''), name: String(value?.full_name || value?.name || '') });

// 把一场比赛精简成扩展需要的字段；数据不完整的比赛返回 null，由调用方丢弃
export function slim(game) {
  if (!Number.isSafeInteger(game?.id)) return null;
  const start = Date.parse(game.datetime || '');
  const home = team(game.home_team), away = team(game.visitor_team);
  if (!home.abbr || !away.abbr) return null;
  const state = game.postponed === true ? 'postponed' : STATES.has(game.status_state) ? game.status_state : 'scheduled';
  // 只有已结束的比赛给最终比分；进行中的比分我们更新不够快，不给
  const score = state === 'final' && Number.isSafeInteger(game.home_team_score) && Number.isSafeInteger(game.visitor_team_score)
    ? { home: game.home_team_score, away: game.visitor_team_score } : null;
  return {
    id: game.id,
    // 有确切开赛时间时给 UTC；还没定时间（常见于季后赛）只给日期
    start: Number.isFinite(start) ? new Date(start).toISOString() : null,
    date: /^\d{4}-\d{2}-\d{2}$/.test(game.date || '') ? game.date : null,
    home, away,
    postseason: game.postseason === true,
    state,
    score,
  };
}

// 生成的内容与上一份相同时不改 updatedAt，避免每天产生无意义的提交
export function build(season, games, previous, now = new Date()) {
  const seen = new Set();
  const list = games.map(slim).filter(game => game && (game.start || game.date) && !seen.has(game.id) && seen.add(game.id))
    .sort((a, b) => (a.start || a.date).localeCompare(b.start || b.date) || a.id - b.id);
  const same = previous?.season === season && JSON.stringify(previous.games) === JSON.stringify(list);
  return { version: 1, league: 'nba', season, source: 'balldontlie.io', updatedAt: same ? previous.updatedAt : now.toISOString(), games: list };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function page(key, season, cursor) {
  const url = new URL(API);
  url.searchParams.append('seasons[]', String(season));
  url.searchParams.set('per_page', String(PER_PAGE));
  if (cursor) url.searchParams.set('cursor', String(cursor));
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { Authorization: key } });
    if (res.ok) return res.json();
    // 429 限速、5xx 服务端错误：等一会儿再试；其他错误（如 401 key 不对）直接失败
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) { await sleep(GAP_MS * (attempt + 2)); continue; }
    throw new Error(`balldontlie ${res.status} ${res.statusText}`);
  }
}

export async function fetchSeason(key, season, { gap = GAP_MS, log = () => {} } = {}) {
  const games = [];
  let cursor = null;
  for (let n = 1; n <= MAX_PAGES; n++) {
    if (n > 1) await sleep(gap);
    const body = await page(key, season, cursor);
    if (!Array.isArray(body?.data)) throw new Error('balldontlie 返回格式不对');
    games.push(...body.data);
    log(`第 ${n} 页：${body.data.length} 场，累计 ${games.length}`);
    cursor = body.meta?.next_cursor;
    if (!cursor) return games;
  }
  throw new Error(`超过 ${MAX_PAGES} 页仍未结束，可能是接口变了`);
}

async function main() {
  const key = process.env.BALLDONTLIE_KEY;
  if (!key) throw new Error('缺少环境变量 BALLDONTLIE_KEY');
  const season = Number(process.argv[2]) || seasonFor();
  const file = path.join(ROOT, 'sports', `nba-${season}.json`);
  const previous = await readFile(file, 'utf8').then(JSON.parse, () => null);
  const games = await fetchSeason(key, season, { log: message => console.log(message) });
  const data = build(season, games, previous);
  // 一场都没有多半是赛程还没公布或接口出错：不覆盖已有文件
  if (!data.games.length) throw new Error(`${season} 赛季没有拿到比赛，不写文件`);
  if (previous?.games?.length && data.games.length < previous.games.length * 0.5) throw new Error(`比赛数从 ${previous.games.length} 骤减到 ${data.games.length}，疑似接口异常，不写文件`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data) + '\n');
  await writeFile(path.join(ROOT, 'sports', 'index.json'), JSON.stringify({ version: 1, nba: { season, file: `nba-${season}.json`, updatedAt: data.updatedAt, count: data.games.length } }, null, 1) + '\n');
  console.log(`写入 ${file}：${data.games.length} 场，updatedAt ${data.updatedAt}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exit(1); });
}
