/**
 * The game server: it holds the games and sends each coach only his own view (seats.ts). Built-in Node only.
 *
 *   npm run server        (then the app at localhost:4200 can play "online" against it)
 *
 * Addresses:
 *   GET  /api/games                      the games here, and which seats are taken
 *   POST /api/games                      start a game: { homeTeamId, awayTeamId }
 *   POST /api/games/:id/join             take a seat: { seat: 'home' | 'away' | 'master', name } -> { key }
 *   GET  /api/games/:id/events?key=...   a live stream of your view (Server-Sent Events)
 *   POST /api/games/:id/act              a decision: { key, entry } (a journal entry), refused if it isn't yours
 *   POST /api/games/:id/draft            a coach's call as it takes shape: { key, kind, draft }, for the master only
 *   DELETE /api/games/:id                end a game (an admin, or a coach in it); its viewers are told
 *
 *   GET  /anything-else                  the app itself (the "ng build" output), only for signed-in people;
 *                                        everyone else is sent to the sign-in page first
 *
 * Every address but /auth/... needs a signed-in, invited person (auth.ts, which also answers /auth/...).
 * Settings (environment): PORT, PUBLIC_URL, DATA_DIR, APP_DIR, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, TRUST_PROXY=1.
 * `--dev-login` (npm run server) replaces Google with a type-your-email form, for your own computer.
 */
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes, randomInt } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import {
  applyEntry, COACH_NAME_MAX, createGame, Drafts, Fac, GameContext, GameState, JournalEntry, mayAct, newCoachMemory, otherSide, PROTOCOL, Seat, Team, viewFor, withEntry,
} from '../src/app/engine';
import { displayDivision, displayName } from '../src/app/services/team-names';
import { SETTINGS } from '../src/app/settings';
import { Auth, createAuth, User } from './auth';

const PORT = Number(process.env['PORT'] ?? 3000);
const CARDS = join(process.cwd(), 'public', 'cards');

// ---------- sign-in ----------
// --dev-login: email only (your computer). SIGNIN_CODE: email + that session code. Otherwise Sign in with Google.
const DEV_LOGIN = process.argv.includes('--dev-login');
const SIGNIN_CODE = (process.env['SIGNIN_CODE'] ?? '').trim();
if (!DEV_LOGIN && !SIGNIN_CODE && !process.env['GOOGLE_CLIENT_ID']) {
  console.error('No sign-in set up. Set SIGNIN_CODE (email + session code), or GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or start with --dev-login on your own computer.');
  process.exit(1);
}
if (/^change-?me/i.test(SIGNIN_CODE)) {
  console.error('SIGNIN_CODE still says "change-me": set your own session code in docker-compose.yml first.');
  process.exit(1);
}
if (SIGNIN_CODE && SIGNIN_CODE.length < 6) {
  console.error('SIGNIN_CODE is too short: use at least 6 characters, say two words and a number.');
  process.exit(1);
}
let auth: Auth;
try {
  auth = createAuth({
    mode: DEV_LOGIN || SIGNIN_CODE ? 'email' : 'google',
    sessionCode: DEV_LOGIN ? undefined : SIGNIN_CODE || undefined,
    publicUrl: process.env['PUBLIC_URL'] || 'http://localhost:4200',
    dataDir: process.env['DATA_DIR'] || join(process.cwd(), 'data'),
    invites: process.env['ALLOWED_EMAILS'] || undefined,
    clientId: process.env['GOOGLE_CLIENT_ID'],
    clientSecret: process.env['GOOGLE_CLIENT_SECRET'],
    trustProxy: process.env['TRUST_PROXY'] === '1',
  });
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
if (DEV_LOGIN) console.warn('Developer sign-in is on (--dev-login): anyone who can reach this server can sign in as any invited email.');
else if (SIGNIN_CODE) console.log('Sign-in: invited email + the session code (SIGNIN_CODE).');
else console.log('Sign-in: Google.');
console.log(`Invite list: ${auth.invitesFrom}`);

// ---------- cards ----------
type Entry = { id: string; year: number; name: string; city?: string; division: string; path: string };
const catalog: Entry[] = JSON.parse(readFileSync(join(CARDS, 'teams', 'index.json'), 'utf8'));
const deck: Fac[] = JSON.parse(readFileSync(join(CARDS, 'fac-deck.json'), 'utf8'));
function loadTeam(id: string): Team {
  const entry = catalog.find(t => t.id === id);
  if (!entry) throw new Error(`No team ${id}`);
  const team: Team = JSON.parse(readFileSync(join(process.cwd(), 'public', entry.path), 'utf8'));
  // The same names as in the app ("New England", not the card's full name), so the play-by-play reads the same.
  const shown = displayName({ id: team.id, year: team.year, name: team.name, city: team.city, division: team.division }, catalog);
  return { ...team, name: shown, shortName: shown, division: displayDivision(team.division) };
}

// ---------- the app (npm run build puts it in dist/spf/browser) ----------
const APP_DIR = resolve(process.env['APP_DIR'] || join(process.cwd(), 'dist', 'spf', 'browser'));
const HAS_APP = existsSync(join(APP_DIR, 'index.html'));
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.ico': 'image/x-icon', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
};

/** A file of the app, or index.html for the app's own pages (/game, /offense, ...). Never anything outside APP_DIR. */
function serveApp(res: ServerResponse, pathname: string, head: boolean) {
  let rel: string;
  try { rel = decodeURIComponent(pathname); } catch { return json(res, 400, { error: 'Bad address' }); }
  let file = resolve(APP_DIR, `.${rel}`);
  if (file !== APP_DIR && !file.startsWith(APP_DIR + sep)) return json(res, 404, { error: 'Not found' });
  if (!statSync(file, { throwIfNoEntry: false })?.isFile()) {
    if (extname(rel)) return json(res, 404, { error: 'Not found' }); // a missing file, not a page of the app
    file = join(APP_DIR, 'index.html');
  }
  // Built files with a hash in their name (main-AB12CD34.js) never change: the browser may keep them. Others: ask each time.
  const forever = /-[A-Z0-9]{8}\.\w+$/.test(file);
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': forever ? 'private, max-age=31536000, immutable' : 'no-cache',
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
  });
  if (head) return res.end();
  createReadStream(file).pipe(res);
}

// ---------- games ----------
interface Client { res: ServerResponse; seat: Seat }
interface Room {
  id: string;
  state: GameState;
  ctx: GameContext;
  seats: Partial<Record<Seat, { key: string; name: string; email: string }>>;
  clients: Set<Client>;
  /** The coaches' calls as they take shape: for the master's eyes only (see send). */
  drafts: Drafts;
}
const rooms = new Map<string, Room>();
const newId = () => randomBytes(4).toString('hex');

function summary(room: Room) {
  const s = room.state;
  return {
    protocol: PROTOCOL, id: room.id, homeTeamId: s.homeTeamId, awayTeamId: s.awayTeamId, home: room.ctx.teams.home.name, away: room.ctx.teams.away.name,
    phase: s.phase, quarter: s.quarter, clock: s.clock, score: s.score,
    seats: Object.fromEntries(Object.entries(room.seats).map(([seat, v]) => [seat, v!.name])),
  };
}

/** An admin may end any game; a coach the game they sit in (say the other coach has gone). */
function mayEnd(room: Room, me: User): boolean {
  return me.admin || Object.values(room.seats).some(s => s?.email === me.email);
}

/** The seat this key opens, for the account that took it (a key passed on to someone else is no use to them). */
function seatOf(room: Room, key: string | null, me: User): Seat | null {
  for (const [seat, v] of Object.entries(room.seats)) if (v && v.key === key && v.email === me.email) return seat as Seat;
  return null;
}

/** Every connected coach gets his own view of the game, now. */
function broadcast(room: Room) {
  for (const c of room.clients) send(c, room);
}
function send(c: Client, room: Room) {
  // The coaches' calls in progress go to the master only: a coach never receives the other's, not even hidden.
  const drafts = c.seat === 'master' ? { drafts: room.drafts } : {};
  c.res.write(`data: ${JSON.stringify({ protocol: PROTOCOL, seat: c.seat, game: summary(room), state: viewFor(room.state, c.seat), ...drafts })}\n\n`);
}
/** Only the master's view changes with a draft: the coaches aren't sent anything. */
function sendMasters(room: Room) {
  for (const c of room.clients) if (c.seat === 'master') send(c, room);
}

// ---------- http ----------
function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error('Request too large');
  }
  return raw ? JSON.parse(raw) : {};
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (await auth.handle(req, res, url)) return;
    const parts = url.pathname.split('/').filter(Boolean); // ['api', 'games', id, action]

    // The app: only for signed-in people. Anyone else gets the sign-in page first, and comes back here afterwards.
    if (parts[0] !== 'api' && HAS_APP) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Not allowed' });
      if (!auth.user(req)) {
        if (extname(url.pathname) && !url.pathname.endsWith('.html')) return json(res, 401, { error: 'Sign in first' });
        res.writeHead(302, { Location: `/auth/signin?return=${encodeURIComponent(url.pathname + url.search)}`, 'Cache-Control': 'no-store' });
        return res.end();
      }
      return serveApp(res, url.pathname, req.method === 'HEAD');
    }

    // No app built here (your laptop, before "npm run build"): point people to the app on port 4200.
    if (url.pathname === '/' && req.method === 'GET') {
      const app = process.env['PUBLIC_URL'] || 'http://localhost:4200';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<!doctype html><meta charset="utf-8"><title>Game server</title>
<body style="font-family: system-ui, sans-serif; max-width: 34rem; margin: 4rem auto; line-height: 1.5">
<h1 style="font-weight: 300">This is the game server</h1>
<p>It's running fine. It only does the behind-the-scenes work for online games, there's nothing to see here.</p>
<p><b>To play, open the app: <a href="${app}">${app}</a></b></p>
<p style="color: #555">Nothing there? Start it in a second terminal with <code>npm start</code> and leave this one running.</p>
</body>`);
    }
    if (parts[0] !== 'api' || parts[1] !== 'games') return json(res, 404, { error: 'Not found' });
    const me = auth.user(req);
    if (!me) return json(res, 401, { error: 'Sign in first', signIn: '/auth/signin' });
    if (req.method !== 'GET' && !auth.sameOrigin(req)) return json(res, 403, { error: 'Refused: not from this site' });
    const room = parts[2] ? rooms.get(parts[2]) : undefined;

    if (!parts[2] && req.method === 'GET') return json(res, 200, [...rooms.values()].map(r => ({ ...summary(r), mayEnd: mayEnd(r, me) })));

    if (!parts[2] && req.method === 'POST') {
      const b = await body(req);
      const home = loadTeam(String(b['homeTeamId'])), away = loadTeam(String(b['awayTeamId']));
      const state = createGame({ homeTeamId: home.id, awayTeamId: away.id, seed: randomInt(2 ** 31), rules: { ...SETTINGS.houseRules } }, deck);
      const created: Room = { id: newId(), state, ctx: { cards: deck, teams: { home, away } }, seats: {}, clients: new Set(), drafts: {} };
      rooms.set(created.id, created);
      console.log(`New game ${created.id}: ${away.name} at ${home.name}`);
      return json(res, 201, summary(created));
    }

    if (!room) return json(res, 404, { error: 'No such game' });

    if (!parts[3] && req.method === 'DELETE') {
      if (!mayEnd(room, me)) return json(res, 403, { error: 'Only an admin or a coach in this game may end it' });
      rooms.delete(room.id);
      // Tell everyone still watching, then close their streams: their browsers go back to their own local game.
      for (const c of room.clients) c.res.end(`data: ${JSON.stringify({ protocol: PROTOCOL, ended: true, by: me.name })}\n\n`);
      console.log(`Game ${room.id} ended by ${me.email}`);
      return json(res, 200, { ok: true });
    }

    if (parts[3] === 'join' && req.method === 'POST') {
      const b = await body(req);
      const seat = String(b['seat']) as Seat;
      if (!['home', 'away', 'master'].includes(seat)) return json(res, 400, { error: 'Seat must be home, away or master' });
      if (seat === 'master' && !me.admin) return json(res, 403, { error: 'Only an admin may take the master seat (it sees both teams)' });
      if (room.seats[seat]) return json(res, 409, { error: `The ${seat === 'master' ? 'master' : seat + ' coach'}'s seat is taken (${room.seats[seat]!.name})` });
      const key = randomBytes(16).toString('hex');
      const name = String(b['name'] || me.name).trim().slice(0, COACH_NAME_MAX) || 'Coach';
      room.seats[seat] = { key, name, email: me.email };
      // Who plays which side, for the Game Book.
      if (seat !== 'master') room.state = { ...room.state, coaches: { ...room.state.coaches, [seat]: room.seats[seat]!.name } };
      console.log(`Game ${room.id}: ${room.seats[seat]!.name} takes the ${seat} seat`);
      broadcast(room);
      return json(res, 200, { key, seat, game: summary(room) });
    }

    if (parts[3] === 'events' && req.method === 'GET') {
      const seat = seatOf(room, url.searchParams.get('key'), me);
      if (!seat) return json(res, 403, { error: 'Not your game: join it first' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      const client: Client = { res, seat };
      room.clients.add(client);
      send(client, room);
      const ping = setInterval(() => res.write(': ping\n\n'), 25_000); // keeps the stream open through proxies
      req.on('close', () => { clearInterval(ping); room.clients.delete(client); });
      return;
    }

    if (parts[3] === 'act' && req.method === 'POST') {
      const b = await body(req);
      const seat = seatOf(room, String(b['key'] ?? ''), me);
      if (!seat) return json(res, 403, { error: 'Not your game: join it first' });
      const entry = b['entry'] as JournalEntry;
      const why = mayAct(room.state, seat, entry);
      if (why) return json(res, 403, { error: why });
      const before = { plays: room.state.log.length, possession: room.state.possession };
      try {
        room.state = withEntry(room.state, applyEntry(room.state, entry, room.ctx, newCoachMemory()), entry);
      } catch (e) {
        return json(res, 422, { error: (e as Error).message });
      }
      // A play was run (or the ball changed hands): the calls in progress were for the play before.
      if (room.state.log.length !== before.plays || room.state.possession !== before.possession) room.drafts = {};
      broadcast(room);
      return json(res, 200, { ok: true });
    }

    if (parts[3] === 'draft' && req.method === 'POST') {
      const b = await body(req);
      const seat = seatOf(room, String(b['key'] ?? ''), me);
      if (!seat || seat === 'master') return json(res, 403, { error: 'Not your game: join it first' });
      const kind = b['kind'], has = room.state.possession;
      if (room.state.phase !== 'PLAY' || !has) return json(res, 409, { error: 'No play is being called' });
      if (kind === 'offense' && seat === has) room.drafts = { ...room.drafts, offense: b['draft'] as Drafts['offense'] };
      else if (kind === 'defense' && seat === otherSide(has)) room.drafts = { ...room.drafts, defense: b['draft'] as Drafts['defense'] };
      else return json(res, 403, { error: "That's the other coach's call" });
      sendMasters(room);
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { error: 'Not found' });
  } catch (e) {
    return json(res, 500, { error: (e as Error).message });
  }
});

server.on('error', (e: NodeJS.ErrnoException) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${PORT} is in use: is the game server already running?` : e.message);
  process.exit(1);
});
server.listen(PORT, () => {
  console.log(`Statistical Football game server on http://localhost:${PORT}`);
  if (HAS_APP) console.log(`It also serves the app from ${APP_DIR} (sign-in first): http://localhost:${PORT}`);
  if (DEV_LOGIN) console.log('While developing: run "npm start" in a second terminal, then open http://localhost:4200');
});
