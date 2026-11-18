import { Component, computed, inject, Injectable, signal } from '@angular/core';
import { DriveChart } from './drive-chart';
import { Scoreboard } from '../../components/scoreboard/scoreboard';
import { LogEntry } from '../../engine';
import { PageHeader } from '../../shell/page-header';
import { GameStore } from '../../state/game.store';

const QUARTER_NAMES = ['', '1st quarter', '2nd quarter', '3rd quarter', '4th quarter'];

/**
 * Which plays the coach opened or closed himself. Lives as long as the app does, so going to the Offense tab to run
 * the next play and coming back keeps them as they were.
 */
@Injectable({ providedIn: 'root' })
export class PlayByPlayView {
  private static readonly KEY = 'spf.pbp.open';
  readonly choices = signal(PlayByPlayView.load());

  set(key: string, open: boolean) {
    this.choices.update(m => new Map(m).set(key, open));
    try {
      // Session storage: survives a page reload (F5), forgotten when the browser closes.
      sessionStorage.setItem(PlayByPlayView.KEY, JSON.stringify([...this.choices()]));
    } catch {
      // Storage switched off: the choices just aren't remembered across reloads.
    }
  }

  private static load(): Map<string, boolean> {
    try {
      return new Map(JSON.parse(sessionStorage.getItem(PlayByPlayView.KEY) ?? '[]'));
    } catch {
      return new Map();
    }
  }
}

/** Every play of the game, grouped by quarter, oldest first, the way a scorepad reads. */
@Component({
  selector: 'spf-play-by-play-page',
  imports: [PageHeader, Scoreboard, DriveChart],
  template: `
    <spf-page-header title="Play by play" />
    <main>
      <div class="plays">
        <div class="tabs" role="tablist" aria-label="Play by play">
          <button type="button" role="tab" [attr.aria-selected]="mode() === 'drive'" [class.on]="mode() === 'drive'" (click)="show('drive')">By drive</button>
          <button type="button" role="tab" [attr.aria-selected]="mode() === 'quarter'" [class.on]="mode() === 'quarter'" (click)="show('quarter')">By quarter</button>
        </div>
        @if (mode() === 'drive') {
          <section class="frame" role="tabpanel"><h2>Drives</h2><spf-drive-chart /></section>
        } @else {
        @for (q of quarters(); track q.quarter) {
          <!-- Like the drives: the current quarter open, earlier ones folded to a summary; the coach's choice is kept. -->
          <details class="frame quarter" [open]="quarterOpen(q.quarter)" (toggle)="rememberQuarter(q.quarter, $any($event.target).open)">
            <summary>
              <h2>{{ q.name }}</h2>
              <span class="qline">{{ q.plays }} {{ q.plays === 1 ? 'play' : 'plays' }}@if (q.score) { · {{ q.score }} }</span>
              <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5" /></svg>
            </summary>
            <ol>
              @for (e of q.entries; track e.index) {
                <li>
                  <span class="time" aria-label="Time remaining">{{ clock(e.entry.clock) }}</span>
                  <!-- Only the latest play is open; earlier ones fold away to their result, a click opens them again. -->
                  <details [open]="isOpen(e.key, e.index)" (toggle)="remember(e.key, e.index, $any($event.target).open)">
                    <summary>
                      <span class="head">
                        <strong>{{ e.entry.title }}</strong>
                        @if (e.summary) { <span class="result">{{ e.summary }}</span> }
                        <!-- Who made the tackle, who got the pressure, and a timeout: straight from the play's steps. -->
                        @if (e.details) { <span class="details">{{ e.details }}</span> }
                      </span>
                      @if (e.entry.steps.length) {
                        <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3l5 5-5 5" /></svg>
                      }
                    </summary>
                    <ul>
                      @for (step of e.entry.steps; track $index) { <li>{{ step }}</li> }
                    </ul>
                  </details>
                </li>
              }
            </ol>
          </details>
        } @empty {
          <p class="empty">No plays yet.</p>
        }
        }
      </div>
      <aside><spf-scoreboard /></aside>
    </main>
  `,
  styles: `
    details.quarter > summary { list-style: none; cursor: pointer; display: flex; align-items: baseline; gap: .9rem; }
    details.quarter > summary::-webkit-details-marker { display: none; }
    details.quarter > summary h2 { margin: 0; }
    details.quarter > summary .qline { font-size: .9rem; opacity: .85; }
    details.quarter > summary .chevron { margin-left: auto; align-self: center; width: 1.1rem; height: 1.1rem; fill: none; stroke: currentColor; stroke-width: 2; opacity: .75; transition: transform .15s; }
    details.quarter[open] > summary .chevron { transform: rotate(90deg); }
    details.quarter[open] > summary { margin-bottom: .5rem; }
    .tabs { display: flex; gap: 2px; justify-self: end; }
    .tabs button {
      font: inherit; font-size: .95rem; padding: .45rem 1rem; cursor: pointer; border: 0; color: white;
      background: rgba(255, 255, 255, .14);
    }
    .tabs button:first-child { border-radius: 5px 0 0 5px; }
    .tabs button:last-child { border-radius: 0 5px 5px 0; }
    .tabs button.on { background: white; color: var(--page-pbp); font-weight: 600; }
    .tabs button:hover:not(.on) { background: rgba(255, 255, 255, .24); }
    :host { display: block; min-height: 100vh; min-width: var(--page-min-width); background: var(--page-pbp); }
    main { display: grid; grid-template-columns: minmax(40rem, 62rem) 18.5rem; gap: 2rem; padding: 1.4rem 1.6rem 2rem; align-items: start; }
    .plays { display: grid; gap: .8rem; }
    .frame { border: 6px solid var(--spf-frame); border-radius: var(--radius-panel); padding: .8rem 1.1rem; color: white; }
    h2 { margin: 0 0 .6rem; font-weight: 400; font-size: 1.2rem; }
    ol { list-style: none; margin: 0; padding: 0; display: grid; gap: .7rem; }
    ol > li { display: grid; grid-template-columns: 3.4rem 1fr; gap: .6rem; }
    summary { list-style: none; display: flex; justify-content: space-between; align-items: flex-start; gap: .6rem; cursor: pointer; }
    summary::-webkit-details-marker { display: none; }
    summary:focus-visible { outline: 2px solid #ffd27a; outline-offset: 2px; border-radius: 3px; }
    .head { display: grid; }
    .chevron { flex: none; width: 1.1rem; height: 1.1rem; margin-top: .15rem; fill: none; stroke: currentColor; stroke-width: 2; opacity: .75; transition: transform .15s; }
    details[open] > summary .chevron { transform: rotate(90deg); }
    summary:hover .chevron { opacity: 1; }
    .time { font-variant-numeric: tabular-nums; color: var(--spf-line); padding-top: .05rem; }
    ul { margin: .15rem 0 0; padding-left: 1.1rem; font-size: .88rem; opacity: .9; display: grid; gap: .1rem; }
    .empty { color: white; margin: 0; }
    .result { display: block; color: #ffe08a; font-size: .92rem; }
    .details { display: block; color: #d9cfee; font-size: .82rem; margin-top: .1rem; }
    aside { position: sticky; top: 1rem; }
  `,
})
export class PlayByPlayPage {
  private readonly game = inject(GameStore);

  private readonly view = inject(PlayByPlayView);

  /** By drive (the first time) or by quarter; remembered after that. */
  protected readonly mode = signal<'drive' | 'quarter'>(PlayByPlayPage.savedMode());

  protected show(mode: 'drive' | 'quarter') {
    this.mode.set(mode);
    try {
      localStorage.setItem('spf.pbp.mode', mode);
    } catch {
      // Storage switched off: the choice just isn't remembered.
    }
  }

  private static savedMode(): 'drive' | 'quarter' {
    try {
      return localStorage.getItem('spf.pbp.mode') === 'quarter' ? 'quarter' : 'drive';
    } catch {
      return 'drive';
    }
  }

  /** The coach's own choice if he made one; otherwise only the latest play is open. */
  protected isOpen(key: string, index: number): boolean {
    return this.view.choices().get(key) ?? index === this.latest();
  }

  protected remember(key: string, index: number, open: boolean) {
    if (open === this.isOpen(key, index)) return; // Angular setting [open] also fires (toggle); only real clicks count
    this.view.set(key, open);
  }

  /** The newest entry with card flips: the one shown open. */
  protected readonly latest = computed(() => {
    const log = this.game.state()?.log ?? [];
    for (let i = log.length - 1; i >= 0; i--) if (log[i].steps.length) return i;
    return -1;
  });

  protected readonly quarters = computed(() => {
    const groups = new Map<number, { index: number; key: string; entry: LogEntry; summary: string; details: string }[]>();
    (this.game.state()?.log ?? []).forEach((entry, index) => {
      // The result line, or for coin toss and kickoffs (which have none) their last step.
      const summary = entry.result ?? entry.steps.at(-1) ?? '';
      const details = entry.steps.filter(st => /^(Tackle|Pressure|Sack): |^Timeout, |takes a timeout/.test(st)).map(st => st.replace(/[.]$/, '')).join(' · ');
      // A key that also tells games apart, so a new game doesn't inherit the last one's open plays.
      const key = `${this.game.state()?.homeTeamId}|${this.game.state()?.awayTeamId}|${index}|${entry.quarter}|${entry.clock}|${entry.title}`;
      groups.set(entry.quarter, [...(groups.get(entry.quarter) ?? []), { index, key, entry, summary, details }]);
    });
    const state = this.game.state();
    const scoreText = (sc: { home: number; away: number } | undefined) =>
      sc ? `${this.game.label('away')} ${sc.away}, ${this.game.label('home')} ${sc.home}` : '';
    return [...groups.entries()].map(([quarter, entries]) => ({
      quarter,
      name: QUARTER_NAMES[quarter] ?? 'Overtime',
      entries,
      // Plays from scrimmage, as the Stats tab counts them (kickoffs, extra points and notes aren't plays).
      plays: (state?.events ?? []).filter(e => e.type === 'SNAP' && e.quarter === quarter).length,
      // The score when the quarter ended; the live score for the quarter being played.
      score: scoreText(state?.quarterScores?.[quarter - 1] ?? (quarter === state?.quarter ? state.score : undefined)),
    }));
  });

  private quarterKey(q: number) {
    const s = this.game.state();
    return `quarter|${s?.homeTeamId}|${s?.awayTeamId}|${q}`;
  }

  /** The coach's own choice if he made one; otherwise only the quarter being played is open. */
  protected quarterOpen(q: number): boolean {
    return this.view.choices().get(this.quarterKey(q)) ?? q === Math.max(...this.quarters().map(x => x.quarter));
  }

  protected rememberQuarter(q: number, open: boolean) {
    if (open === this.quarterOpen(q)) return;
    this.view.set(this.quarterKey(q), open);
  }

  protected clock(seconds: number) {
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }
}
