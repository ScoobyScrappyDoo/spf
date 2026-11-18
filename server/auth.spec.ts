// Sign-in tests: npm run test:server. A real HTTP server around auth.handle, Google's token endpoint faked.
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Auth, AuthOptions, checkIdToken, createAuth, GOOGLE_AUTH, parseInvites, safeReturn } from './auth';

const CLIENT = 'test-client.apps.googleusercontent.com';
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const idToken = (claims: object) => `${b64({ alg: 'RS256' })}.${b64(claims)}.sig`;

describe('invite list', () => {
  it('reads emails, comments and the admin flag', () => {
    const m = parseInvites('# a comment\n  Owner@Gmail.com  admin \nfriend@gmail.com # pal\nnot-an-email\n\n');
    expect([...m.keys()]).toEqual(['owner@gmail.com', 'friend@gmail.com']);
    expect(m.get('owner@gmail.com')!.admin).toBe(true);
    expect(m.get('friend@gmail.com')!.admin).toBe(false);
  });
});

describe('return paths', () => {
  it('only allows paths on this site', () => {
    expect(safeReturn('/game')).toBe('/game');
    expect(safeReturn('//evil.com')).toBe('/');
    expect(safeReturn('/\\evil.com')).toBe('/');
    expect(safeReturn('https://evil.com')).toBe('/');
    expect(safeReturn(null)).toBe('/');
  });
});

describe('ID token checks', () => {
  const good = { iss: 'https://accounts.google.com', aud: CLIENT, exp: 2000, nonce: 'n', email: 'A@x.com', email_verified: true, name: 'Al' };
  const check = (c: object) => checkIdToken(idToken(c), { clientId: CLIENT, nonce: 'n', now: 1_000_000 });
  it('accepts a good one', () => expect(check(good)).toEqual({ email: 'a@x.com', name: 'Al' }));
  it('refuses the wrong issuer', () => expect(check({ ...good, iss: 'https://evil.com' })).toBe('wrong issuer'));
  it('refuses another app', () => expect(check({ ...good, aud: 'other' })).toBe('wrong audience'));
  it('refuses an expired one', () => expect(check({ ...good, exp: 999 })).toBe('expired'));
  it('refuses a replayed one', () => expect(check({ ...good, nonce: 'x' })).toBe('wrong nonce'));
  it('refuses an unverified email', () => expect(check({ ...good, email_verified: false })).toBe('no verified email'));
  it('refuses garbage', () => expect(checkIdToken('nope', { clientId: CLIENT, nonce: 'n', now: 0 })).toBe('unreadable ID token'));
});

describe('sign-in over HTTP', () => {
  let dir: string, server: Server, base: string, auth: Auth;
  let google: { email: string; nonce?: string; exchanged: URLSearchParams[] };

  async function start(extra: Partial<AuthOptions> = {}) {
    google = { email: 'friend@gmail.com', exchanged: [] };
    // Google's token endpoint, faked: answers with an ID token for google.email and the nonce sent to /auth/google.
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      google.exchanged.push(init.body as URLSearchParams);
      return new Response(JSON.stringify({ id_token: idToken({ iss: 'https://accounts.google.com', aud: CLIENT, exp: Date.now() / 1000 + 600, nonce: google.nonce, email: google.email, email_verified: true, name: 'Friend' }) }), { status: 200 });
    }) as typeof fetch;
    auth = createAuth({ mode: 'google', publicUrl: 'http://localhost:4200', dataDir: dir, clientId: CLIENT, clientSecret: 'secret', fetch: fakeFetch, ...extra });
    server = createServer(async (req, res) => {
      const url = new URL(req.url!, 'http://localhost');
      if (await auth.handle(req, res, url)) return;
      const u = auth.user(req);
      res.writeHead(u ? 200 : 401).end(JSON.stringify(u));
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }
  const get = (path: string, cookie = '') => fetch(base + path, { redirect: 'manual', headers: { cookie } });
  const cookiesOf = (r: Response) => r.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');

  /** Goes to Google and back, as the browser would. Returns the callback's response. */
  async function signIn(returnTo = '/game') {
    const go = await get(`/auth/google?return=${encodeURIComponent(returnTo)}`);
    expect(go.status).toBe(302);
    const to = new URL(go.headers.get('location')!);
    expect(to.origin + to.pathname).toBe(GOOGLE_AUTH);
    expect(to.searchParams.get('code_challenge_method')).toBe('S256');
    expect(to.searchParams.get('redirect_uri')).toBe('http://localhost:4200/auth/callback');
    google.nonce = to.searchParams.get('nonce')!;
    const state = to.searchParams.get('state')!;
    return get(`/auth/callback?code=abc&state=${state}`, cookiesOf(go));
  }

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'spf-auth-')); });
  afterEach(() => { server?.close(); rmSync(dir, { recursive: true, force: true }); });

  it('creates a commented invite list on first start', async () => {
    await start();
    expect(readFileSync(join(dir, 'allowed-emails.txt'), 'utf8')).toContain('one Google email address per line');
  });

  it('lets an invited person in, and back to where they were', async () => {
    await start();
    writeFileSync(auth.invitesFile, 'friend@gmail.com\n');
    const back = await signIn('/game');
    expect(back.status).toBe(303);
    expect(back.headers.get('location')).toBe('/game');
    const me = await get('/auth/me', cookiesOf(back));
    expect(await me.json()).toEqual({ email: 'friend@gmail.com', name: 'Friend', admin: false });
    // PKCE: the verifier went to Google with the code.
    expect(google.exchanged[0].get('code_verifier')).toMatch(/^[\w-]{43}$/);
    // Logged, and the session file holds no usable cookie.
    expect(readFileSync(join(dir, 'sign-ins.log'), 'utf8')).toContain('"ok":true');
    const sessionCookie = cookiesOf(back).split('; ').find(c => c.startsWith('spf_session='))!.split('=')[1];
    expect(readFileSync(join(dir, 'sessions.json'), 'utf8')).not.toContain(sessionCookie);
  });

  it('turns away someone not invited, and logs it', async () => {
    await start();
    google.email = 'stranger@gmail.com';
    const back = await signIn();
    expect(back.status).toBe(403);
    expect(await back.text()).toContain("stranger@gmail.com isn't on the invite list");
    expect(cookiesOf(back)).not.toContain('spf_session=');
    expect(readFileSync(join(dir, 'sign-ins.log'), 'utf8')).toContain('not invited');
  });

  it('refuses a callback without the login cookie (a link started in someone else\'s browser)', async () => {
    await start();
    writeFileSync(auth.invitesFile, 'friend@gmail.com\n');
    const go = await get('/auth/google');
    const state = new URL(go.headers.get('location')!).searchParams.get('state');
    const back = await get(`/auth/callback?code=abc&state=${state}`); // no cookie
    expect(back.status).toBe(400);
    expect(google.exchanged.length).toBe(0);
  });

  it('refuses a state used twice', async () => {
    await start();
    writeFileSync(auth.invitesFile, 'friend@gmail.com\n');
    const go = await get('/auth/google');
    const to = new URL(go.headers.get('location')!);
    google.nonce = to.searchParams.get('nonce')!;
    const url = `/auth/callback?code=abc&state=${to.searchParams.get('state')}`;
    expect((await get(url, cookiesOf(go))).status).toBe(303);
    expect((await get(url, cookiesOf(go))).status).toBe(400);
  });

  it('signs someone out when they leave the invite list', async () => {
    await start();
    writeFileSync(auth.invitesFile, 'friend@gmail.com admin\n');
    const cookie = cookiesOf(await signIn());
    expect((await get('/whoami', cookie)).status).toBe(200);
    writeFileSync(auth.invitesFile, '# nobody\n');
    expect((await get('/whoami', cookie)).status).toBe(401);
  });

  it('keeps sessions over a restart', async () => {
    await start();
    writeFileSync(auth.invitesFile, 'friend@gmail.com\n');
    const cookie = cookiesOf(await signIn());
    server.close();
    await start(); // a new auth, reading sessions.json
    expect((await get('/whoami', cookie)).status).toBe(200);
  });

  it('sign out ends the session; a post from another site is refused', async () => {
    await start();
    writeFileSync(auth.invitesFile, 'friend@gmail.com\n');
    const cookie = cookiesOf(await signIn());
    const foreign = await fetch(`${base}/auth/signout`, { method: 'POST', redirect: 'manual', headers: { cookie, origin: 'https://evil.com' } });
    expect(foreign.status).toBe(403);
    const out = await fetch(`${base}/auth/signout`, { method: 'POST', redirect: 'manual', headers: { cookie, origin: 'http://localhost:4200' } });
    expect(out.status).toBe(303);
    expect((await get('/whoami', cookie)).status).toBe(401);
  });

  it('uses __Host- cookies with Secure on https', async () => {
    await start({ publicUrl: 'https://football.example.synology.me' });
    const go = await get('/auth/google');
    expect(go.headers.get('set-cookie')).toMatch(/^__Host-spf_login=.*; Path=\/; .*HttpOnly; SameSite=Lax; Secure$/);
  });

  it('the email form is off in Google mode', async () => {
    await start();
    const r = await fetch(`${base}/auth/email`, { method: 'POST', body: new URLSearchParams({ email: 'friend@gmail.com' }), redirect: 'manual' });
    expect(r.status).toBe(404);
  });

  describe('email + session code', () => {
    const post = (form: Record<string, string>) =>
      fetch(`${base}/auth/email`, { method: 'POST', body: new URLSearchParams({ return: '/game', ...form }), redirect: 'manual' });
    beforeEach(async () => {
      await start({ mode: 'email', sessionCode: 'Blue Falcon 7' });
      writeFileSync(auth.invitesFile, 'friend@gmail.com\n');
    });

    it('shows a code field on the sign-in page', async () => {
      const html = await (await get('/auth/signin')).text();
      expect(html).toContain('name="code"');
      expect(html).not.toContain('Developer sign-in');
    });

    it('lets an invited person in with the right code (case and spaces don\'t matter)', async () => {
      const r = await post({ email: ' Friend@Gmail.com ', code: '  blue falcon 7 ' });
      expect(r.status).toBe(303);
      expect(r.headers.get('location')).toBe('/game');
      expect((await get('/whoami', cookiesOf(r))).status).toBe(200);
    });

    it('refuses a wrong or missing code, keeps the email typed, and logs it', async () => {
      const r = await post({ email: 'friend@gmail.com', code: 'red falcon 7' });
      expect(r.status).toBe(401);
      const html = await r.text();
      expect(html).toContain('That session code isn&#39;t right.');
      expect(html).toContain('value="friend@gmail.com"');
      expect(cookiesOf(r)).not.toContain('spf_session=');
      expect((await post({ email: 'friend@gmail.com' })).status).toBe(401);
      expect(readFileSync(join(dir, 'sign-ins.log'), 'utf8')).toContain('wrong session code');
    });

    it('a wrong code tells a stranger nothing about the invite list', async () => {
      const a = await (await post({ email: 'friend@gmail.com', code: 'nope' })).text();
      const b = await (await post({ email: 'stranger@gmail.com', code: 'nope' })).text();
      expect(a.replace('friend', 'X')).toBe(b.replace('stranger', 'X'));
    });

    it('the right code still needs an invited email', async () => {
      expect((await post({ email: 'stranger@gmail.com', code: 'blue falcon 7' })).status).toBe(403);
    });

    it('locks an address out after 10 wrong codes, even with the right one', async () => {
      for (let i = 0; i < 10; i++) expect((await post({ email: 'friend@gmail.com', code: `guess${i}` })).status).toBe(401);
      expect((await post({ email: 'friend@gmail.com', code: 'blue falcon 7' })).status).toBe(429);
    });
  });

  it('developer sign-in (email mode without a code) needs only an invited email', async () => {
    await start({ mode: 'email' });
    writeFileSync(auth.invitesFile, 'friend@gmail.com\n');
    expect(await (await get('/auth/signin')).text()).toContain('Developer sign-in');
    const r = await fetch(`${base}/auth/email`, { method: 'POST', body: new URLSearchParams({ email: 'friend@gmail.com' }), redirect: 'manual' });
    expect(r.status).toBe(303);
  });

  it('takes the invite list from the settings (ALLOWED_EMAILS) instead of the file', async () => {
    await start({ mode: 'email', sessionCode: 'blue falcon 7', invites: 'Owner@x.com admin, friend@gmail.com;  pal@gmx.de ' });
    expect(existsSync(auth.invitesFile)).toBe(false); // no file made or read
    expect(auth.invitesFrom).toBe('ALLOWED_EMAILS (3 addresses)');
    const post = (email: string) => fetch(`${base}/auth/email`, { method: 'POST', body: new URLSearchParams({ email, code: 'blue falcon 7' }), redirect: 'manual' });
    const owner = await post('owner@x.com');
    expect(await (await get('/auth/me', cookiesOf(owner))).json()).toMatchObject({ email: 'owner@x.com', admin: true });
    expect((await post('pal@gmx.de')).status).toBe(303);
    expect((await post('stranger@gmail.com')).status).toBe(403);
  });

  it('refuses to start Google mode without the client id and secret', () => {
    expect(() => createAuth({ mode: 'google', publicUrl: 'http://localhost:4200', dataDir: dir })).toThrow(/GOOGLE_CLIENT_ID/);
  });
});
