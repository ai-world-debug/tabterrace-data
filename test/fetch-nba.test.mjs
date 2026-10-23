import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seasonFor, slim, build } from '../scripts/fetch-nba.mjs';

const game = (id, extra = {}) => ({
  id, date: '2026-10-21', datetime: '2026-10-21T23:30:00.000Z', season: 2026, status: '7:30 pm ET', status_state: 'scheduled',
  postseason: false, postponed: false, home_team_score: 0, visitor_team_score: 0, home_q1: null,
  home_team: { id: 2, abbreviation: 'BOS', full_name: 'Boston Celtics' }, visitor_team: { id: 14, abbreviation: 'LAL', full_name: 'Los Angeles Lakers' }, ...extra,
});

test('赛季按开始年份推算：8 月起是新赛季', () => {
  assert.equal(seasonFor(new Date('2026-10-23T00:00:00Z')), 2026);
  assert.equal(seasonFor(new Date('2027-04-15T00:00:00Z')), 2026);
  assert.equal(seasonFor(new Date('2027-08-01T00:00:00Z')), 2027);
});

test('只输出赛程和已结束比赛的最终比分，不带每节比分和统计', () => {
  assert.deepEqual(slim(game(1, { home_team_score: 110, visitor_team_score: 104, home_q1: 30, status_state: 'final' })), {
    id: 1, start: '2026-10-21T23:30:00.000Z', date: '2026-10-21',
    home: { abbr: 'BOS', name: 'Boston Celtics' }, away: { abbr: 'LAL', name: 'Los Angeles Lakers' }, postseason: false, state: 'final',
    score: { home: 110, away: 104 },
  });
  assert.equal(slim(game(2, { home_team_score: 50, visitor_team_score: 48, status_state: 'in_progress' })).score, null, '进行中不给比分');
  assert.equal(slim(game(3)).score, null, '未开赛不给比分');
});

test('延期以 postponed 字段为准；未定时间只留日期；缺队伍丢弃', () => {
  assert.equal(slim(game(1, { postponed: true })).state, 'postponed');
  const tbd = slim(game(2, { datetime: null }));
  assert.equal(tbd.start, null); assert.equal(tbd.date, '2026-10-21');
  assert.equal(slim(game(3, { home_team: null })), null);
  assert.equal(slim({}), null);
});

test('按开赛时间排序并去重；内容没变时保留原 updatedAt', () => {
  const games = [game(2, { datetime: '2026-10-22T00:00:00Z' }), game(1), game(1)];
  const first = build(2026, games, null, new Date('2026-10-23T00:00:00Z'));
  assert.deepEqual(first.games.map(g => g.id), [1, 2]);
  assert.equal(first.updatedAt, '2026-10-23T00:00:00.000Z');
  assert.equal(build(2026, games, first, new Date('2026-10-24T00:00:00Z')).updatedAt, first.updatedAt);
  assert.equal(build(2026, [game(1)], first, new Date('2026-10-24T00:00:00Z')).updatedAt, '2026-10-24T00:00:00.000Z');
});
