/**
 * Sign-in for the game server: Google accounts, invite only. Built-in Node only.
 *
 *   GET  /auth/signin?return=/game   the sign-in page
 *   GET  /auth/google?return=...     off to Google (OpenID Connect, authorization code + PKCE)
 *   GET  /auth/callback              back from Google: check the answer, the invite list, start a session
 *   POST /auth/email                 (email mode) sign in with an invited email and the session code, no Google
 *   POST /auth/signout               end this browser's session
 *   GET  /auth/me                    who is signed in: { email, name, admin } or 401
 *
 * Files in the data folder (DATA_DIR): allowed-emails.txt (the invite list, edit it any time), sessions.json
 * (only hashes of the session cookies) and sign-ins.log (one JSON line per sign-in, refused ones too).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface User { email: string; name: string; admin: boolean }

export interface AuthOptions {
  /**
   * 'google': Sign in with Google. 'email': type an invited email and the session code (the host tells it, e.g. on a
   * call); without a session code (only for --dev-login on your own computer) the email alone is enough.
   */
  mode: 'google' | 'email';
  /** The session code for email mode: the same for everyone, changed for each session. */
  sessionCode?: string;
  /** The address people type, without a trailing slash: https://name.synology.me, or http://localhost:4200. */
  publicUrl: string;
  dataDir: string;
  /**
   * The invite list as text (ALLOWED_EMAILS: addresses separated by commas or new lines, " admin" after one): used
   * instead of allowed-emails.txt, e.g. in a container where the list sits in the settings. Read at start.
   */
  invites?: string;
  clientId?: string;
  clientSecret?: string;
  /** Behind the DSM reverse proxy: take the visitor's address from X-Forwarded-For. */
  trustProxy?: boolean;
  /** For tests: stand-ins for Google's token endpoint and the clock. */
  fetch?: typeof fetch;
  now?: () => number;
}

export const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const SESSION_DAYS = 30;
const LOGIN_MINUTES = 10;
const MAX_PENDING = 1000;
/** Wrong session codes: this many from one address, then it must wait this long. */
const MAX_WRONG_CODES = 10;
const WRONG_CODE_MINUTES = 15;

/** Same code? Case and spaces around it don't matter; compared in constant time (no clues from the timing). */
export function sameCode(typed: string, code: string): boolean {
  const h = (s: string) => createHash('sha256').update(s.trim().toLowerCase()).digest();
  return timingSafeEqual(h(typed), h(code));
}

const INVITES_TEMPLATE = `# Who may sign in to Statistical Football: one Google email address per line.
# Add " admin" after an address to let that person take the master seat (sees both teams).
# Changes count at once, no restart needed. Removing someone also signs them out.
#
# you@gmail.com admin
# friend@gmail.com
`;

// ---------- the invite list ----------
export interface Invite { admin: boolean }

export function parseInvites(text: string): Map<string, Invite> {
  const out = new Map<string, Invite>();
  for (const raw of text.split(/\r?\n/)) {
    const [email, flag] = raw.replace(/#.*/, '').trim().split(/\s+/);
    if (!email || !email.includes('@')) continue;
    out.set(email.toLowerCase(), { admin: flag?.toLowerCase() === 'admin' });
  }
  return out;
}

// ---------- Google's answer ----------
export interface IdClaims { email: string; name: string }

/**
 * Reads the ID token Google's token endpoint gave us. It came straight from Google over HTTPS (not through the
 * browser), so TLS vouches for it and the signature needn't be checked (OpenID Connect Core 3.1.3.7); the claims are.
 * Returns the person, or why not.
 */
export function checkIdToken(idToken: string, expect: { clientId: string; nonce: string; now: number }): IdClaims | string {
  let c: Record<string, unknown>;
  try {
    c = JSON.parse(Buffer.from(idToken.split('.')[1] ?? '', 'base64url').toString('utf8'));
    if (!c || typeof c !== 'object') return 'unreadable ID token';
  } catch {
    return 'unreadable ID token';
  }
  if (c['iss'] !== 'https://accounts.google.com' && c['iss'] !== 'accounts.google.com') return 'wrong issuer';
  const aud = Array.isArray(c['aud']) ? c['aud'] : [c['aud']];
  if (!aud.includes(expect.clientId)) return 'wrong audience';
  if (typeof c['exp'] !== 'number' || c['exp'] * 1000 < expect.now) return 'expired';
  if (c['nonce'] !== expect.nonce) return 'wrong nonce';
  const email = c['email'];
  if (typeof email !== 'string' || c['email_verified'] !== true) return 'no verified email';
  const name = typeof c['name'] === 'string' && c['name'].trim() ? c['name'].trim() : email.split('@')[0];
  return { email: email.toLowerCase(), name };
}

// ---------- small helpers ----------
export function readCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/** Only a path on this site (no "//evil.com", no "https://..."), so a sign-in link can't send anyone elsewhere. */
export function safeReturn(r: unknown): string {
  return typeof r === 'string' && /^\/(?![\/\\])/.test(r) ? r : '/';
}

const esc = (s: string) => s.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
const token = () => randomBytes(32).toString('base64url');
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

async function formBody(req: IncomingMessage): Promise<URLSearchParams> {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) throw new Error('Too much');
  }
  return new URLSearchParams(raw);
}

// ---------- the sign-in service ----------
interface Session { email: string; name: string; expires: number }
interface Pending { verifier: string; nonce: string; returnTo: string; expires: number }

export type Auth = ReturnType<typeof createAuth>;

export function createAuth(o: AuthOptions) {
  if (o.mode === 'google' && (!o.clientId || !o.clientSecret)) {
    throw new Error('Google sign-in needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (or start with --dev-login on your own computer).');
  }
  const now = o.now ?? Date.now;
  /** Email without a session code: the developer sign-in, for your own computer only. */
  const devLogin = o.mode === 'email' && !o.sessionCode;
  const doFetch = o.fetch ?? fetch;
  const publicUrl = o.publicUrl.replace(/\/+$/, '');
  const origin = new URL(publicUrl).origin;
  const secure = publicUrl.startsWith('https://');
  // "__Host-" cookies: the browser insists on HTTPS, this exact host and the whole site, so nothing else can set them.
  const SESSION = secure ? '__Host-spf_session' : 'spf_session';
  const LOGIN = secure ? '__Host-spf_login' : 'spf_login';

  mkdirSync(o.dataDir, { recursive: true });
  const invitesFile = join(o.dataDir, 'allowed-emails.txt');
  const sessionsFile = join(o.dataDir, 'sessions.json');
  const logFile = join(o.dataDir, 'sign-ins.log');
  const fixedInvites = o.invites !== undefined ? parseInvites(o.invites.replace(/[,;]/g, '\n')) : null;
  if (!fixedInvites && !existsSync(invitesFile)) writeFileSync(invitesFile, INVITES_TEMPLATE);

  // The invite list: from the settings, or the file, read again whenever it changes.
  let invites = new Map<string, Invite>();
  let invitesStamp = '';
  function invite(email: string): Invite | undefined {
    if (fixedInvites) return fixedInvites.get(email.toLowerCase());
    const st = statSync(invitesFile, { throwIfNoEntry: false });
    const stamp = st ? `${st.mtimeMs}:${st.size}` : 'none';
    if (stamp !== invitesStamp) {
      invitesStamp = stamp;
      try { invites = parseInvites(readFileSync(invitesFile, 'utf8')); } catch { invites = new Map(); }
    }
    return invites.get(email.toLowerCase());
  }

  // Sessions, keyed by a hash of the cookie: the file alone can't be used to sign in.
  const sessions = new Map<string, Session>();
  try {
    const saved = JSON.parse(readFileSync(sessionsFile, 'utf8')) as Record<string, Session>;
    for (const [k, v] of Object.entries(saved)) if (v.expires > now()) sessions.set(k, v);
  } catch { /* none yet */ }
  function saveSessions() {
    const tmp = `${sessionsFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(sessions)));
    renameSync(tmp, sessionsFile);
  }

  const pending = new Map<string, Pending>();
  const wrongCodes = new Map<string, { n: number; since: number }>(); // by visitor address

  function blocked(ip: string): boolean {
    const w = wrongCodes.get(ip);
    if (w && now() - w.since > WRONG_CODE_MINUTES * 60_000) wrongCodes.delete(ip);
    return (wrongCodes.get(ip)?.n ?? 0) >= MAX_WRONG_CODES;
  }
  function wrongCode(ip: string) {
    const w = wrongCodes.get(ip) ?? { n: 0, since: now() };
    wrongCodes.set(ip, { n: w.n + 1, since: w.since });
  }

  function cookie(name: string, value: string, maxAgeSeconds: number) {
    return `${name}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
  }

  function clientIp(req: IncomingMessage): string {
    const fwd = req.headers['x-forwarded-for'];
    if (o.trustProxy && typeof fwd === 'string' && fwd) return fwd.split(',').pop()!.trim(); // the one our proxy added
    return req.socket.remoteAddress ?? '?';
  }

  function log(req: IncomingMessage, entry: Record<string, unknown>) {
    const line = { t: new Date(now()).toISOString(), ip: clientIp(req), ua: String(req.headers['user-agent'] ?? '').slice(0, 200), ...entry };
    try { appendFileSync(logFile, `${JSON.stringify(line)}\n`); } catch (e) { console.error(`Can't write ${logFile}: ${(e as Error).message}`); }
    console.log(`Sign-in ${entry['ok'] ? 'OK' : 'refused'}: ${entry['email'] ?? '?'}${entry['reason'] ? ` (${entry['reason']})` : ''}`);
  }

  /** Who sent this request, or null. Also ends sessions that ran out or whose email left the invite list. */
  function user(req: IncomingMessage): User | null {
    const id = readCookies(req.headers.cookie)[SESSION];
    if (!id) return null;
    const key = hash(id);
    const s = sessions.get(key);
    if (!s) return null;
    const inv = s.expires > now() ? invite(s.email) : undefined;
    if (!inv) {
      sessions.delete(key);
      saveSessions();
      return null;
    }
    return { email: s.email, name: s.name, admin: inv.admin };
  }

  /** A change (POST) must come from our own pages: a second guard next to the SameSite cookie. */
  function sameOrigin(req: IncomingMessage): boolean {
    const from = req.headers.origin;
    return !from || from === origin || devLogin;
  }

  // ---------- pages ----------
  function page(res: ServerResponse, status: number, title: string, body: string, headers: Record<string, string | string[]> = {}) {
    res.writeHead(status, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      ...headers,
    });
    res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Statistical Football</title>
<style>
  body { font-family: system-ui, sans-serif; background: #f4f1ea; color: #222; display: grid; place-items: center; min-height: 100vh; margin: 0; }
  main { background: white; padding: 2.5rem 3rem; max-width: 30rem; box-shadow: 0 2px 12px #0002; }
  h1 { font-weight: 300; margin-top: 0; } .note { color: #555; } .error { color: #a40000; }
  a.button, button { display: inline-block; padding: .7rem 1.2rem; background: #1f4e8c; color: white; border: 0; font-size: 1rem; text-decoration: none; cursor: pointer; }
  input { font-size: 1rem; padding: .5rem; width: 100%; box-sizing: border-box; margin: .5rem 0 1rem; }
</style></head><body><main><h1>Statistical Football</h1>${body}</main></body></html>`);
  }

  function signInPage(res: ServerResponse, returnTo: string, message?: string, status = 200, headers: Record<string, string | string[]> = {}, email = '') {
    const msg = message ? `<p class="error">${esc(message)}</p>` : '';
    let body: string;
    if (o.mode === 'google') {
      body = `<p class="note">Invite only. Sign in with the Google account you were invited with.</p>
        <p><a class="button" href="/auth/google?return=${encodeURIComponent(returnTo)}">Sign in with Google</a></p>`;
    } else {
      const codeField = devLogin ? '' : `<label>Session code (you get it from the host)
          <input type="text" name="code" required autocomplete="off" autocapitalize="off" spellcheck="false" ${email ? 'autofocus' : ''}></label>`;
      body = `<p class="note">Invite only. ${devLogin ? 'Type an email address from the invite list.' : 'Type the email address you were invited with and the session code.'}</p>
        <form method="post" action="/auth/email"><input type="hidden" name="return" value="${esc(returnTo)}">
          <label>Your email address<input type="email" name="email" required autocomplete="email" value="${esc(email)}" ${email ? '' : 'autofocus'}></label>
          ${codeField}
          <button type="submit">Sign in</button></form>
        ${devLogin ? '<p class="note">Developer sign-in, without a session code: only for your own computer.</p>' : ''}`;
    }
    page(res, status, 'Sign in', msg + body, headers);
  }

  /** The person is known (Google or dev form): let them in if invited. */
  function finish(req: IncomingMessage, res: ServerResponse, who: IdClaims, returnTo: string, extraCookies: string[] = []) {
    const inv = invite(who.email);
    if (!inv) {
      log(req, { ok: false, email: who.email, reason: 'not invited' });
      return page(res, 403, 'Not invited', `<p class="error">${esc(who.email)} isn't on the invite list.</p>
        <p class="note">Ask the owner to add this address, or sign in with the account you were invited with.</p>
        <p><a class="button" href="/auth/signin?return=${encodeURIComponent(returnTo)}">Try another account</a></p>`, { 'Set-Cookie': extraCookies });
    }
    for (const [k, s] of sessions) if (s.expires <= now()) sessions.delete(k);
    const id = token();
    sessions.set(hash(id), { email: who.email, name: who.name, expires: now() + SESSION_DAYS * 86_400_000 });
    saveSessions();
    log(req, { ok: true, email: who.email, name: who.name });
    res.writeHead(303, { Location: returnTo, 'Cache-Control': 'no-store', 'Set-Cookie': [cookie(SESSION, id, SESSION_DAYS * 86_400), ...extraCookies] });
    res.end();
  }

  // ---------- the addresses ----------
  /** Answers /auth/... and returns true; anything else is left to the caller (false). */
  async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const path = url.pathname;
    if (!path.startsWith('/auth/')) return false;
    const returnTo = safeReturn(url.searchParams.get('return'));

    if (path === '/auth/me' && req.method === 'GET') {
      const u = user(req);
      res.writeHead(u ? 200 : 401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(u ?? { error: 'Not signed in' }));
      return true;
    }

    if (path === '/auth/signin' && req.method === 'GET') {
      if (user(req)) {
        res.writeHead(303, { Location: returnTo });
        res.end();
      } else signInPage(res, returnTo);
      return true;
    }

    if (path === '/auth/google' && req.method === 'GET' && o.mode === 'google') {
      for (const [k, p] of pending) if (p.expires <= now()) pending.delete(k);
      if (pending.size >= MAX_PENDING) {
        page(res, 503, 'Busy', '<p class="error">Too many sign-ins at once. Please try again in a minute.</p>');
        return true;
      }
      const state = token(), nonce = token(), verifier = token();
      pending.set(state, { verifier, nonce, returnTo, expires: now() + LOGIN_MINUTES * 60_000 });
      const q = new URLSearchParams({
        client_id: o.clientId!, redirect_uri: `${publicUrl}/auth/callback`, response_type: 'code', scope: 'openid email profile',
        state, nonce, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
        prompt: 'select_account',
      });
      // The login cookie ties Google's answer to this browser: a link someone else started can't sign you in.
      res.writeHead(302, { Location: `${GOOGLE_AUTH}?${q}`, 'Cache-Control': 'no-store', 'Set-Cookie': cookie(LOGIN, state, LOGIN_MINUTES * 60) });
      res.end();
      return true;
    }

    if (path === '/auth/callback' && req.method === 'GET' && o.mode === 'google') {
      const state = url.searchParams.get('state') ?? '';
      const p = pending.get(state);
      pending.delete(state);
      const clear = [cookie(LOGIN, '', 0)];
      const back = p?.returnTo ?? '/';
      if (url.searchParams.get('error')) {
        signInPage(res, back, 'Google sign-in was cancelled.', 200, { 'Set-Cookie': clear });
        return true;
      }
      const code = url.searchParams.get('code');
      if (!p || p.expires <= now() || !code || readCookies(req.headers.cookie)[LOGIN] !== state) {
        log(req, { ok: false, reason: 'stale or foreign sign-in link' });
        signInPage(res, back, 'That sign-in had expired or was started in another browser. Please try again.', 400, { 'Set-Cookie': clear });
        return true;
      }
      let idToken = '';
      try {
        const r = await doFetch(GOOGLE_TOKEN, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code, client_id: o.clientId!, client_secret: o.clientSecret!, redirect_uri: `${publicUrl}/auth/callback`,
            grant_type: 'authorization_code', code_verifier: p.verifier,
          }),
        });
        const t = (await r.json()) as Record<string, unknown>;
        if (!r.ok) throw new Error(String(t['error_description'] ?? t['error'] ?? r.status));
        idToken = String(t['id_token'] ?? '');
      } catch (e) {
        log(req, { ok: false, reason: `token exchange: ${(e as Error).message}` });
        signInPage(res, back, "Couldn't finish the sign-in with Google. Please try again.", 502, { 'Set-Cookie': clear });
        return true;
      }
      const who = checkIdToken(idToken, { clientId: o.clientId!, nonce: p.nonce, now: now() });
      if (typeof who === 'string') {
        log(req, { ok: false, reason: who });
        signInPage(res, back, "Google's answer didn't check out. Please try again.", 400, { 'Set-Cookie': clear });
        return true;
      }
      finish(req, res, who, back, clear);
      return true;
    }

    if (path === '/auth/email' && req.method === 'POST' && o.mode === 'email') {
      const ip = clientIp(req);
      if (!devLogin && blocked(ip)) {
        log(req, { ok: false, reason: 'too many wrong codes' });
        page(res, 429, 'Wait a moment', `<p class="error">Too many wrong session codes. Please wait ${WRONG_CODE_MINUTES} minutes and try again.</p>`);
        return true;
      }
      const form = await formBody(req);
      const back = safeReturn(form.get('return'));
      const email = (form.get('email') ?? '').trim().toLowerCase();
      // The code first: a wrong code says nothing about who is on the invite list.
      if (!devLogin && !sameCode(form.get('code') ?? '', o.sessionCode!)) {
        wrongCode(ip);
        log(req, { ok: false, email, reason: 'wrong session code' });
        signInPage(res, back, "That session code isn't right.", 401, {}, email);
        return true;
      }
      if (!email.includes('@')) {
        signInPage(res, back, 'Type an email address.', 400);
        return true;
      }
      wrongCodes.delete(ip);
      finish(req, res, { email, name: email.split('@')[0] }, back);
      return true;
    }

    if (path === '/auth/signout' && req.method === 'POST') {
      if (!sameOrigin(req)) {
        page(res, 403, 'Refused', '<p class="error">Refused.</p>');
        return true;
      }
      const id = readCookies(req.headers.cookie)[SESSION];
      if (id && sessions.delete(hash(id))) saveSessions();
      res.writeHead(303, { Location: '/auth/signin', 'Cache-Control': 'no-store', 'Set-Cookie': cookie(SESSION, '', 0) });
      res.end();
      return true;
    }

    page(res, 404, 'Not found', '<p class="error">Not found.</p>');
    return true;
  }

  const invitesFrom = fixedInvites ? `ALLOWED_EMAILS (${fixedInvites.size} addresses)` : invitesFile;
  return { handle, user, sameOrigin, invitesFile, invitesFrom };
}
