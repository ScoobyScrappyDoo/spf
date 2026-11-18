import { Injectable, signal } from '@angular/core';

export interface SignedIn { email: string; name: string; admin: boolean }

/**
 * Who is signed in to the game server (server/auth.ts). The sign-in itself happens on the server's own pages
 * (/auth/signin, then Google); the app only asks /auth/me and links there.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  /** The person, 'signed-out' (the server answered 401), 'offline' (no server), or null before the first answer. */
  readonly status = signal<SignedIn | 'signed-out' | 'offline' | null>(null);

  async refresh(): Promise<void> {
    try {
      const res = await fetch('/auth/me');
      this.status.set(res.ok ? ((await res.json()) as SignedIn) : res.status === 401 ? 'signed-out' : 'offline');
    } catch {
      this.status.set('offline');
    }
  }

  /** The server's sign-in page, coming back to this page afterwards. */
  signInUrl(): string {
    return `/auth/signin?return=${encodeURIComponent(location.pathname + location.search)}`;
  }

  /**
   * Runs before the app shows anything (app.config.ts): not signed in → off to the sign-in page, and the app never
   * starts. No game server at all (your laptop, playing alone) → the app starts as before, for local games.
   * The real lock is on the server, which doesn't even hand out the app before sign-in; this is the same rule for
   * the development server on port 4200.
   */
  async gate(): Promise<void> {
    await this.refresh();
    if (this.status() !== 'signed-out') return;
    location.assign(this.signInUrl());
    return new Promise(() => { /* never: the browser is leaving */ });
  }
}

/** The person, when signed in (a type guard for templates). */
export function signedIn(s: ReturnType<AuthService['status']>): SignedIn | null {
  return s && typeof s === 'object' ? s : null;
}
