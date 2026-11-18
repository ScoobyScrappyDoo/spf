import { SETTINGS } from '../settings';
import { computed, effect, inject, Injectable, signal } from '@angular/core';
import {
  callToss, chooseAfterToss, choosePenalty, Coin, createGame, DefenseSetup, Fac, GameContext, GameState, kickoff, Lineup, OffenseCall, otherSide,
  activeInjuries, Coaches, Drafts, expectOnside, mayAct, Temperament, PROTOCOL, Seat, coachTurn, bigPlayBlocked, bigPlaysLeft, delayOfGameBlocked, delayRunoff, applyEntry, CoachMemory, JournalEntry, newCoachMemory, withEntry, declareFieldGoal, declarePunt, fieldGoalPlay, inFinalMinutes, Injury, PuntCall, puntPlay, setDefenseReady, Side, snapPlay, Team, teamLabel, TossChoice,
} from '../engine';
import { TeamService } from '../services/team.service';

const STORAGE_KEY = 'spf.game.v1';
const ONLINE_KEY = 'spf.online.v1';

/** This tab's seat in a game on the game server. */
export interface OnlineSeat {
  gameId: string;
  key: string;
  seat: Seat;
  name: string;
}

/**
 * The game in progress. Every move goes through one of the engine's pure functions, which return a new GameState.
 * The state is saved in the browser after each move, so a page refresh carries on where you were.
 */
@Injectable({ providedIn: 'root' })
export class GameStore {
  private readonly data = inject(TeamService);

  private readonly _state = signal<GameState | null>(null);
  private readonly _teams = signal<Record<Side, Team> | null>(null);
  private readonly _cards = signal<Fac[] | null>(null);
  private readonly _error = signal<string | null>(null);

  readonly state = this._state.asReadonly();
  readonly teams = this._teams.asReadonly();
  readonly error = this._error.asReadonly();

  /** Resolves once a saved game (if any) has been loaded back. Route guards wait for this. */
  readonly restored: Promise<void>;

  /** Offense, defense and the other screens open once the opening kickoff is over. */
  readonly unlocked = computed(() => this._state()?.openingKickoffDone ?? false);
  readonly offenseSide = computed(() => this._state()?.possession ?? null);
  readonly defenseSide = computed(() => {
    const s = this.offenseSide();
    return s ? otherSide(s) : null;
  });
  /** The defense has pressed "All set!" for the coming play. */
  readonly defenseReady = computed(() => this._state()?.defenseReady ?? false);
  readonly latest = computed(() => this._state()?.log.at(-1) ?? null);
  /** Players who are hurt right now, both teams. */
  readonly injuries = computed(() => {
    const s = this._state();
    return s ? activeInjuries(s) : [];
  });
  injuryOf(side: Side | null, playerId: string | undefined): Injury | undefined {
    return side && playerId ? this.injuries().find(i => i.side === side && i.playerId === playerId) : undefined;
  }
  injuredIds(side: Side | null): Set<string> {
    return new Set(this.injuries().filter(i => i.side === side).map(i => i.playerId));
  }

  /** The last 2 minutes of the 1st half or the last 5 of the 2nd: the two-minute offense is allowed (rule 9.4.1). */
  readonly finalMinutes = computed(() => {
    const s = this._state();
    return !!s && inFinalMinutes(s);
  });

  readonly cards = computed(() => this._cards());
  readonly ctx = computed<GameContext | null>(() => {
    const cards = this._cards();
    const teams = this._teams();
    return cards && teams ? { cards, teams } : null;
  });

  // ---------- Online play: this tab holds a seat in a game on the game server (server/main.ts) ----------
  readonly online = signal<OnlineSeat | null>(null);
  /** A note for the Play online box, e.g. that the online game you were in was ended. */
  readonly onlineNotice = signal<string | null>(null);
  /** Online: who sits in which seat (the coaches' names), as the server last said. */
  readonly onlineSeats = signal<Partial<Record<Seat, string>>>({});
  /** Online, for the master only: the coaches' calls as they take shape (the server sends them to nobody else). */
  readonly drafts = signal<Drafts>({});
  private lastDraft: Partial<Record<keyof Drafts, string>> = {};
  private events?: EventSource;
  /** The seat this tab plays: a coach online, or the master (both teams) in a local game. */
  readonly seat = computed<Seat>(() => {
    const online = this.online();
    if (online) return online.seat;
    const ai = this.aiSide();
    return ai ? otherSide(ai) : 'master'; // solitaire: you play the other side
  });

  /**
   * Solitaire: the side the computer coach plays in a local game ("AI" for one side only), or null. Kept with the game
   * (who played each side), so a saved game or a replay knows it too.
   */
  readonly aiSide = computed<Side | null>(() => {
    const c = this._state()?.coaches;
    if (this.online() || !c) return null;
    if (c.home === 'AI' && c.away !== 'AI') return 'home';
    if (c.away === 'AI' && c.home !== 'AI') return 'away';
    return null;
  });

  /** The two sides show each other how they line up: online, and in solitaire (the computer sees your formation). */
  readonly sharesLook = computed(() => !!this.online() || !!this.aiSide());

  /** A decision of the computer coach in solitaire (SolitaireService), journaled like any other. */
  perform(e: JournalEntry): boolean {
    return this.act(e);
  }

  /** Takes a seat in a game on the server and follows it live. */
  async joinOnline(gameId: string, seat: Seat, name: string): Promise<void> {
    const res = await fetch(`/api/games/${gameId}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seat, name }) });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? 'The game server refused');
    this.onlineNotice.set(null);
    this.connect({ gameId, key: body.key, seat, name });
  }

  /** Back to the local game in this browser. */
  async leaveOnline(): Promise<void> {
    this.events?.close();
    this.events = undefined;
    this.online.set(null);
    this.onlineSeats.set({});
    this.drafts.set({});
    this.lastDraft = {};
    try { sessionStorage.removeItem(ONLINE_KEY); } catch { /* fine */ }
    this._state.set(null);
    this._error.set(null);
    await this.restore();
  }

  private connect(seat: OnlineSeat) {
    this.events?.close();
    this.online.set(seat);
    try { sessionStorage.setItem(ONLINE_KEY, JSON.stringify(seat)); } catch { /* fine */ }
    const events = new EventSource(`/api/games/${seat.gameId}/events?key=${seat.key}`);
    this.events = events;
    events.onmessage = async ev => {
      const msg = JSON.parse(ev.data) as { state: GameState; protocol?: number; ended?: boolean; by?: string; game?: { seats?: Partial<Record<Seat, string>> }; drafts?: Drafts };
      if (msg.ended) {
        // The game was ended on the server (an admin, or a coach): back to this browser's own game.
        events.close();
        await this.leaveOnline();
        this.onlineNotice.set(`The online game ${seat.gameId} was ended${msg.by ? ` by ${msg.by}` : ''}.`);
        return;
      }
      await this.teamsFor(msg.state);
      this.onlineSeats.set(msg.game?.seats ?? {});
      this.drafts.set(msg.drafts ?? {});
      this._error.set(msg.protocol === PROTOCOL ? null : 'The game server is older than the app: stop it (Ctrl+C in its terminal) and start it again with npm run server.');
      this._state.set(msg.state);
    };
    events.onerror = () => this._error.set('Lost the game server for a moment: reconnecting…');
  }

  /** The teams and cards for a game from the server, loaded once. */
  private async teamsFor(state: GameState) {
    const t = this._teams();
    if (t && t.home.id === state.homeTeamId && t.away.id === state.awayTeamId && this._cards()) return;
    const [home, away, cards] = await Promise.all([this.data.loadTeam(state.homeTeamId), this.data.loadTeam(state.awayTeamId), this.data.loadDeck()]);
    this._teams.set({ home, away });
    this._cards.set(cards);
  }

  private async sendOnline(e: JournalEntry) {
    const o = this.online()!;
    this._error.set(null);
    try {
      const res = await fetch(`/api/games/${o.gameId}/act`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: o.key, entry: e }) });
      if (res.status === 401) this._error.set('Your sign-in has ended: reload the page and sign in again.');
      else if (!res.ok) this._error.set((await res.json()).error ?? 'The game server refused');
    } catch {
      this._error.set("Can't reach the game server: is it running?");
    }
  }

  /** May this tab's seat make this kind of decision now (the toss, the kickoff, a penalty choice, ...)? */
  mayDecide(t: JournalEntry['t']): boolean {
    const s = this._state();
    return !!s && !mayAct(s, this.seat(), { t } as JournalEntry);
  }

  /**
   * May this tab's seat use the Offense or Defense page now? A coach only gets his own side's page; the master gets a
   * side's page unless a coach is playing that side online, then it watches that coach's line-up live, like the other
   * coach does.
   */
  myPage(page: 'offense' | 'defense'): boolean {
    const has = this._state()?.possession;
    if (!has) return true;
    return this.coaches(page === 'offense' ? has : otherSide(has));
  }

  /**
   * Does this tab line up that side? Its own coach does; the master does in a local game, and online only while that
   * side's seat is free (someone testing alone). The master never overrides a coach's line-up.
   */
  coaches(side: Side): boolean {
    const seat = this.seat();
    if (seat === side) return true;
    return seat === 'master' && (!this.online() || !this.onlineSeats()[side]);
  }

  constructor() {
    this.restored = this.restore();
    // Another tab of the same browser changed the game (say the defense pressed "All set!"): follow it at once, the way
    // the server will keep two coaches' browsers in step when the game is online.
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', e => {
        if (e.key === STORAGE_KEY && !this.online()) void this.follow(e.newValue);
      });
    }
    effect(() => {
      const state = this._state();
      if (this.online()) return; // an online game lives on the server: the local game in storage stays as it is
      try {
        if (state) localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        else localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Storage can be full or switched off; the game still works, it just won't survive a refresh.
      }
    });
  }

  label(side: Side): string {
    const ctx = this.ctx();
    return ctx ? teamLabel(ctx, side) : side;
  }

  async newGame(homeTeamId: string, awayTeamId: string, coaches?: Coaches, temperament: Temperament = 'normal'): Promise<void> {
    this._error.set(null);
    try {
      const [home, away, cards] = await Promise.all([this.data.loadTeam(homeTeamId), this.data.loadTeam(awayTeamId), this.data.loadDeck()]);
      this._teams.set({ home, away });
      this._cards.set(cards);
      this._state.set(createGame({ homeTeamId, awayTeamId, seed: Math.floor(Math.random() * 2 ** 31), rules: { ...SETTINGS.houseRules, coachTemperament: temperament }, ...(coaches ? { coaches } : {}) }, cards));
    } catch (e) {
      this._error.set(`Couldn't start the game: ${(e as Error).message}`);
    }
  }

  // Every decision goes through the journal (journal.ts): it's what a saved game holds and what a replay plays back.
  callToss(call: Coin) {
    this.act({ t: 'toss', call });
  }

  chooseAfterToss(choice: TossChoice) {
    this.act({ t: 'choice', choice });
  }

  kickoff(onside = false, options: { squib?: boolean; onsideDefense?: boolean } = {}) {
    // Solitaire: the computer, receiving, decides for itself whether to line up for an onside kick.
    const s = this._state(), ai = this.aiSide();
    if (s && ai && s.kickoff && s.kickoff.kicking !== ai) options = { ...options, onsideDefense: expectOnside(s) };
    this.act({ t: 'kickoff', onside, ...(options.squib ? { squib: true } : {}), ...(options.onsideDefense ? { onsideDefense: true } : {}) });
  }

  choosePenalty(accept: boolean) {
    this.act({ t: 'penalty', accept });
  }

  setDefenseReady(ready: boolean, setup?: DefenseSetup) {
    this.act({ t: 'ready', ready, setup });
  }

  /** The punt the offense has announced for the coming play, if any (rule 8.5). */
  readonly puntCall = computed(() => this._state()?.puntCall ?? null);

  declarePunt(call: PuntCall | null) {
    this.act({ t: 'punt-call', call });
  }

  punt() {
    this.act({ t: 'punt' });
  }

  /** The offense has lined up for a field goal (rule 8.6.1). */
  readonly fieldGoalCall = computed(() => this._state()?.fieldGoalCall ?? false);

  declareFieldGoal(on: boolean, fake = false) {
    this.act({ t: 'fg-call', on, ...(fake ? { fake: true } : {}) });
  }

  /** A fake punt or field goal (optional rule O6), set or cleared on the kick already declared. */
  setFakeKick(on: boolean) {
    const s = this._state();
    if (s?.puntCall) this.declarePunt({ ...s.puntCall, fake: on });
    else if (s?.fieldGoalCall) this.declareFieldGoal(true, on);
  }
  readonly fakeKick = computed(() => !!this._state()?.fakeKick);

  kickFieldGoal() {
    this.act({ t: 'fg' });
  }

  snap(call: OffenseCall, lineup: Lineup, twoMinute = false, timeout = false) {
    // Online and in solitaire, the defense sees exactly what lines up: the formation and players go first, then the snap.
    if (this.sharesLook()) this.showOffense(call.formationId, lineup);
    this.act({ t: 'snap', call, lineup, twoMinute, timeout });
  }

  /** Online: the defense sets up for the offense to see (formation and players, not the call), when it changes. */
  showDefense(formationId: string, lineup: Record<string, string[] | undefined>) {
    const s = this._state();
    if (!this.online() || !s || s.phase !== 'PLAY' || !s.possession || !this.coaches(otherSide(s.possession))) return;
    const clean = Object.fromEntries(Object.entries(lineup).filter(([, ids]) => ids?.length)) as Record<string, string[]>;
    const shown = s.defenseLook;
    if (shown && shown.formationId === formationId && JSON.stringify(shown.lineup) === JSON.stringify(clean)) return;
    this.act({ t: 'defense-look', formationId, lineup: clean });
  }

  /** Online: the offense lines up for the defense to see (formation and players, not the call), when it changes. */
  showOffense(formationId: string, lineup: Lineup) {
    const s = this._state();
    if (!this.sharesLook() || !s || s.phase !== 'PLAY' || !s.possession || !this.coaches(s.possession)) return;
    const clean = Object.fromEntries(Object.entries(lineup).filter(([, id]) => id)) as Record<string, string>;
    const shown = s.offenseLook;
    if (shown && shown.formationId === formationId && JSON.stringify(shown.lineup) === JSON.stringify(clean)) return;
    this.act({ t: 'look', formationId, lineup: clean });
  }

  /**
   * Online, a coach's call as it takes shape (the offense's play, the defense's call, blitzers, coverage, ...), sent
   * whenever it changes so the master can follow along. The server passes it to the master only. Not a decision: it
   * isn't journaled and changes nothing in the game.
   */
  shareDraft<K extends keyof Drafts>(kind: K, draft: NonNullable<Drafts[K]>) {
    const o = this.online(), s = this._state();
    if (!o || o.seat === 'master' || !s || s.phase !== 'PLAY' || !s.possession) return;
    if (o.seat !== (kind === 'offense' ? s.possession : otherSide(s.possession))) return;
    // Once per play and change: the play's number is in the key, so a new play sends its call afresh.
    const key = `${s.log.length}|${s.possession}|${JSON.stringify(draft)}`;
    if (this.lastDraft[kind] === key) return;
    this.lastDraft[kind] = key;
    fetch(`/api/games/${o.gameId}/draft`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: o.key, kind, draft }) })
      .catch(() => { this.lastDraft[kind] = undefined; }); // only for the master's eyes: no error to show the coach
  }

  /** Applies a decision and writes it into the journal. A refused decision changes nothing and isn't journaled. */
  private act(e: JournalEntry, memory: CoachMemory = newCoachMemory()): boolean {
    if (this.online()) {
      void this.sendOnline(e); // the server decides, and its live stream brings the result
      return true;
    }
    const ctx = this.ctx();
    const state = this._state();
    if (!ctx || !state) return false;
    try {
      this._error.set(null);
      this._state.set(withEntry(state, applyEntry(state, e, ctx, memory), e));
      return true;
    } catch (err) {
      this._error.set((err as Error).message);
      return false;
    }
  }

  /** The computer's step in a simulated game, journaled so a replay makes it again. */
  simStep(memory: CoachMemory, _fresh: boolean): boolean {
    if (this.online()) {
      this._error.set('The computer coach plays local games only, for now');
      return false;
    }
    // The computer's decisions go into the journal as they are (the call, the lineup, the defense's setup), so a saved
    // game replays the same way even after the computer coach learns new tricks.
    const ctx = this.ctx();
    const state = this._state();
    if (!ctx || !state) return false;
    try {
      this._error.set(null);
      const turn = coachTurn(state, ctx, memory);
      this._state.set({ ...turn.state, journal: [...(state.journal ?? []), ...turn.entries] });
      return true;
    } catch (err) {
      this._error.set(`Simulation stopped: ${(err as Error).message}`);
      return false;
    }
  }

  /** Whether this game can be saved and replayed: games from before the journal existed can't. */
  readonly journaled = computed(() => {
    const s = this._state();
    return !!s && s.seed !== undefined && Array.isArray(s.journal);
  });

  /** The computer coach takes over a game people were playing ("Let the computer finish"), for the Game Book. */
  markAiFinished() {
    const s = this._state();
    const c = s?.coaches;
    if (s && !(c?.home === 'AI' && c?.away === 'AI')) this._state.set({ ...s, aiFinished: true });
  }

  /** Puts a saved game in place with the cards it was played with (a version 2 .spf file). */
  async loadWithTeams(state: GameState, teams: { home: Team; away: Team }): Promise<void> {
    const cards = await this.data.loadDeck();
    this._teams.set(teams);
    this._cards.set(cards);
    this._error.set(null);
    this._state.set(state);
  }

  /** Puts a game in place (a loaded file, or a replay frame), with its teams. */
  async load(state: GameState): Promise<void> {
    const [home, away, cards] = await Promise.all([this.data.loadTeam(state.homeTeamId), this.data.loadTeam(state.awayTeamId), this.data.loadDeck()]);
    this._teams.set({ home, away });
    this._cards.set(cards);
    this._error.set(null);
    this._state.set(state);
  }

  /** Shows a replay frame (the teams are already loaded). */
  showFrame(state: GameState) {
    this._state.set(state);
  }

  /** Delay of game before a punt (rule 8.5.3): the kicking team asks, the receiving team answers. */
  askDelayOfGame() {
    this.act({ t: 'delay-ask' });
  }

  answerDelayOfGame(accept: boolean) {
    this.act({ t: 'delay-answer', accept });
  }

  readonly delayAsked = computed(() => this._state()?.delayOfGame === 'ASKED');
  readonly delayBlocked = computed(() => { const s = this._state(); return s ? delayOfGameBlocked(s) : 'No game'; });
  readonly delaySeconds = computed(() => { const s = this._state(); return s ? delayRunoff(s) : 0; });

  /** Big plays (rule 8.4): how many a side has left, and why it can't use one now. */
  bigPlaysLeft(side: Side | null): number {
    const s = this._state(); const t = this._teams();
    return side && s && t ? bigPlaysLeft(s, side, t[side]) : 0;
  }
  bigPlayBlocked(side: Side | null): string | null {
    const s = this._state(); const t = this._teams();
    return side && s && t ? bigPlayBlocked(s, side, t[side]) : 'No game';
  }

  /** The fast timing is allowed now: the final minutes, or any time with the no-huddle house rule. */
  readonly noHuddleAllowed = computed(() => !!this._state()?.rules?.noHuddleAnyTime);
  /** Rule 8.7: the defense can't substitute on this play (the offense ran a no-huddle play and the clock is running). */
  readonly noHuddleLock = computed(() => {
    const s = this._state();
    const l = s?.noHuddleLock;
    return !!l?.offenseIds && l.side === s?.possession && l.play === (s?.playIndex ?? 0);
  });

  /** Timeouts a side has left in this half (rule 9.2). */
  timeoutsLeft(side: Side | null): number {
    return side ? this._state()?.timeouts?.[side] ?? 0 : 0;
  }

  endGame() {
    this._state.set(null);
  }

  /** True while the computer coaches both sides (the simulator sets it): the coaches' buttons wait. */
  readonly simulating = signal(false);

  private move(fn: (ctx: GameContext) => GameState) {
    const ctx = this.ctx();
    if (!ctx || !this._state()) return;
    try {
      this._state.set(fn(ctx));
    } catch (e) {
      this._error.set((e as Error).message);
    }
  }

  /** Takes over the game another tab saved; loads the teams too if it's a different game. */
  private async follow(raw: string | null): Promise<void> {
    if (!raw) {
      this._state.set(null);
      return;
    }
    let saved: GameState;
    try {
      saved = JSON.parse(raw) as GameState;
    } catch {
      return;
    }
    if (saved.version !== 1) return;
    const current = this._state();
    if (!current || current.homeTeamId !== saved.homeTeamId || current.awayTeamId !== saved.awayTeamId || !this._cards()) {
      try {
        const [home, away, cards] = await Promise.all([this.data.loadTeam(saved.homeTeamId), this.data.loadTeam(saved.awayTeamId), this.data.loadDeck()]);
        this._teams.set({ home, away });
        this._cards.set(cards);
      } catch {
        return;
      }
    }
    this._state.set(saved);
  }

  private async restore(): Promise<void> {
    // A tab that held a seat online takes it up again after a reload.
    try {
      const raw = sessionStorage.getItem(ONLINE_KEY);
      if (raw) { this.connect(JSON.parse(raw) as OnlineSeat); return; }
    } catch { /* fine */ }
    let saved: GameState | null = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      saved = raw ? (JSON.parse(raw) as GameState) : null;
    } catch {
      saved = null;
    }
    if (!saved || saved.version !== 1) return;
    try {
      const [home, away, cards] = await Promise.all([this.data.loadTeam(saved.homeTeamId), this.data.loadTeam(saved.awayTeamId), this.data.loadDeck()]);
      this._teams.set({ home, away });
      this._cards.set(cards);
      this._state.set(saved);
    } catch {
      // The saved game refers to data that no longer loads; start fresh rather than break.
      this._state.set(null);
    }
  }
}
