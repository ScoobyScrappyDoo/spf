import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CoachPanel } from '../../components/coach-panel/coach-panel';
import { OffenseBoard } from '../../components/offense-board/offense-board';
import { PlayerCardView } from '../../components/player-card/player-card';
import {
  canResolve, clockText, FormationId, getFormation, injuryText, isRunPlay, Lineup, OffenseSlot, outOfPosition, PLAY_LABELS, situationText, SLOT_LABELS, STRATEGY_LABELS,
} from '../../engine';
import { Crutches } from '../../components/crutches/crutches';
import { Tooltip } from '../../shared/tooltip';
import { Hourglass } from '../../components/hourglass/hourglass';
import { LastPlay } from '../../components/last-play/last-play';
import { PlayCards } from '../../components/play-cards/play-cards';
import { GameStore } from '../../state/game.store';
import { PageHeader } from '../../shell/page-header';
import { OffenseCallStore } from '../../state/offense-call.store';

@Component({
  selector: 'spf-offense-page',
  imports: [Tooltip, PageHeader, OffenseBoard, PlayerCardView, CoachPanel, RouterLink, LastPlay, PlayCards, Crutches, Hourglass],
  template: `
    <spf-page-header title="Offense selection" />
    @if (!game.myPage('offense')) {
      <!-- The other coach's view from across the line: the formation and players, not the play. Click a player for his card. -->
      <main class="across">
        <div class="side">
          <div class="frame banner">{{ offenseSide() ? game.label(offenseSide()!) : '' }} on offense :: {{ game.seat() === 'master' ? 'live, as its coach lines up' : 'what you see across the line' }}</div>
          @if (look(); as l) {
            <div class="frame"><spf-offense-board [formation]="l.formation" [lineup]="l.lineup" [players]="lookPlayers()" [inspected]="acrossSlot()" [target]="game.drafts().offense?.call?.slot ?? null" (slotClick)="acrossSlot.set($event)" /></div>
          } @else {
            <div class="frame"><p>The offense is still in the huddle.</p></div>
          }
          @if (masterCall(); as lines) {
            <!-- Only the master gets this: the offense coach's call as it takes shape (the defense coach never does). -->
            <div class="frame master-call">
              <h3>The offense's call <small>only you see this</small></h3>
              @if (lines.length) {
                <dl>@for (l of lines; track l.k) { <dt>{{ l.k }}</dt><dd>{{ l.v }}</dd> }</dl>
              } @else { <p>No play picked yet.</p> }
            </div>
          } @else {
            <p class="note">The play, the ball carrier and the strategy stay with the offense until the snap.</p>
          }
        </div>
        <!-- The same size as your own cards: an invisible quarterback card sets the height (the biggest card). -->
        <aside class="across-card card-stack">
          @if (acrossSizer(); as qb) { <spf-player-card class="sizer" [player]="qb" [teamName]="acrossTeamName()" aria-hidden="true" /> }
          @if (acrossPlayer(); as p) { <spf-player-card [player]="p" [teamName]="acrossTeamName()" /> }
          @else { <p class="hint">Click a player for his card.</p> }
        </aside>
      </main>
    } @else {
    <main>
      @if (store.team(); as team) {
        <div class="left">
          <div class="frame banner">{{ game.label(store.side()!) }} :: {{ situation() }} :: {{ clock() }}</div>
          <div class="frame">
            <spf-offense-board
              [formation]="store.formation()"
              [lineup]="store.lineup()"
              [players]="store.playersById()"
              [target]="store.call().slot"
              [inspected]="store.inspectedSlot()"
              [injured]="game.injuredIds(store.side())"
              [resting]="store.restReason()"
              (slotClick)="onSlotClick($event)"
            />
          </div>
          <div class="frame"><spf-coach-panel /></div>
        </div>

        <aside>
          <!--
            Every card gets the same space: an invisible QB card (the tallest kind) sits in the same grid cell
            as the visible card, so the stack is always QB height and the Replace button never jumps.
          -->
          <div class="card-stack">
            @if (sizer(); as qb) {
              <spf-player-card class="sizer" [player]="qb" [teamName]="team.year + ' ' + team.name" aria-hidden="true" />
            }
            @if (store.inspected(); as player) {
              <spf-player-card [player]="player" [teamName]="team.year + ' ' + team.name" [injury]="game.injuryOf(store.side(), player.id)"
                [outOfPosition]="outOfPositionText()" />
            } @else {
              <p class="empty">Click a player on the board to see his card.</p>
            }
          </div>
          @if (store.inspected()) {
            <button type="button" class="replace" (click)="replacing = !replacing" [attr.aria-expanded]="replacing">
              {{ replacing ? 'Keep this player' : 'Replace' }}
            </button>
            @if (replacing) {
              <ul class="bench">
                @for (p of store.replacements(); track p.id) {
                  <li><button type="button" (click)="replace(p.id)" [disabled]="!!store.benchReason(p)" [spfTip]="store.benchReason(p) ?? ''">{{ p.firstName }} {{ p.lastName }} <span>{{ p.position }}{{ p.position === 'QB' ? ' ' + $any(p).endurance : '' }}</span></button></li>
                } @empty {
                  <li class="none">No one on the bench can play {{ store.inspectedSlot() }}.</li>
                }
              </ul>
            }
          }
        </aside>
          <div class="frame wide snap" [class.ready]="game.defenseReady() && !store.injuredOnField().length">
            <div class="row">
            @if (game.puntCall()) {
              <button type="button" class="run" [disabled]="game.simulating() || game.delayAsked() || !game.defenseReady() || game.state()?.phase !== 'PLAY'" (click)="game.punt()">Punt</button>
            } @else if (game.fieldGoalCall()) {
              <button type="button" class="run" [disabled]="game.simulating() || !game.defenseReady() || game.state()?.phase !== 'PLAY'" (click)="game.kickFieldGoal()">Kick</button>
            } @else {
              <button type="button" class="run" [disabled]="game.simulating() || game.delayAsked() || !game.defenseReady() || !runnable() || store.injuredOnField().length || !!store.qbProblem() || game.state()?.phase !== 'PLAY'" (click)="run()">Run play</button>
            }
            @if (game.puntCall() || game.fieldGoalCall()) {
              <label class="two-minute" spfTip="Rule O6: a pass or run off the kick formation, one card on the Fake Kick Table; the defense doesn't see it">
                <input type="checkbox" [checked]="game.fakeKick()" [disabled]="game.simulating()" (change)="game.setFakeKick($any($event.target).checked)" /> Fake it
              </label>
            }
            @if (game.puntCall()) {
              <button type="button" class="delay" (click)="game.askDelayOfGame()" [disabled]="!!game.delayBlocked() || game.simulating()"
                [spfTip]="game.delayBlocked() ?? 'Rule 8.5.3: 5 yards back and the clock runs; the receiving team accepts or declines'">Ask for a delay of game</button>
            }
            @if (!game.puntCall() && !game.fieldGoalCall()) {
              <label class="two-minute" [spfTip]="game.timeoutsLeft(store.side()) ? 'Stops the clock after this play: it takes 10 seconds (5 in the two-minute offense)' : 'No timeouts left in this half'">
                <input type="checkbox" [checked]="timeoutNext()" [disabled]="!game.timeoutsLeft(store.side()) || game.simulating()"
                  (change)="timeoutNext.set($any($event.target).checked)" /> Timeout after this play ({{ game.timeoutsLeft(store.side()) }} left)
              </label>
            }
            @if ((game.finalMinutes() || game.noHuddleAllowed()) && !game.puntCall() && !game.fieldGoalCall()) {
              <label class="two-minute" [spfTip]="game.finalMinutes() ? 'Rule 9.4.1: the faster timing in the final minutes' : 'House rule: the faster timing at any time; with the clock running, the defense cannot substitute unless you do (rule 8.7)'">
                <input type="checkbox" [checked]="twoMinute()" (change)="twoMinute.set($any($event.target).checked)" /> {{ game.finalMinutes() ? 'Two-minute offense' : 'No-huddle' }}
              </label>
            }
            <p>
              @if (game.simulating()) {
                The computer is coaching this game: watch, or take over on the Game tab.
              } @else if (game.delayAsked()) {
                Waiting for {{ game.label(game.defenseSide()!) }} to answer the delay of game.
              } @else if (game.state()?.phase === 'PENALTY_CHOICE') {
                Decide on the penalty first.
              } @else if (game.fieldGoalCall() && !game.defenseReady()) {
                You're lining up for a field goal. Waiting for the {{ game.label(game.defenseSide()!) }} defense to press "All set!".
                <a routerLink="/defense">Go to the defense</a>
              } @else if (game.fieldGoalCall()) {
                The defense is set. Kick when you're ready.
              } @else if (game.puntCall() && !game.defenseReady()) {
                You've announced a punt. Waiting for the {{ game.label(game.defenseSide()!) }} defense to press "All set!".
                <a routerLink="/defense">Go to the defense</a>
              } @else if (game.puntCall()) {
                The defense is set. Punt when you're ready.
              } @else if (!runnable()) {
                Passing plays come next. Pick a running play to try one now.
              } @else if (game.defenseReady()) {
                The {{ game.label(game.defenseSide()!) }} defense is all set.
              } @else {
                Waiting for the {{ game.label(game.defenseSide()!) }} defense to press "All set!".
                <a routerLink="/defense">Go to the defense</a>
              }
            </p>
            </div>
            @if (!game.puntCall() && !game.fieldGoalCall() && store.notice(); as note) {
              <p class="moved"><spf-hourglass [size]="18" /> {{ note }}</p>
            }
            @if (game.error(); as e) { <p class="hurt" role="alert">{{ e }}</p> }
            @if (store.qbProblem(); as q) {
              <p class="hurt">{{ q.reason }}.
                @if (q.instead) { <button type="button" class="suggest" (click)="store.replace('QB', q.instead.id)">Bring in {{ q.instead.firstName }} {{ q.instead.lastName }}</button> }
              </p>
            }
            @for (h of game.puntCall() || game.fieldGoalCall() ? [] : store.injuredOnField(); track h.slot) {
              <p class="hurt"><spf-crutches [size]="18" /> Replace {{ h.injury.name }} ({{ h.slot }}): injured for {{ injuryText(h.injury.length) }}.</p>
            }
            @if (!game.puntCall() && !game.fieldGoalCall() && store.suggestion(); as sug) {
              <button type="button" class="suggest" (click)="store.acceptSuggestion()">
                Suggested replacement: put in {{ sug.player.firstName }} {{ sug.player.lastName }} ({{ sug.player.position }})
              </button>
            }
          </div>
        <!-- The last play and its cards; the cards sit at the bottom, level with the box under the board. -->
        <div class="plays fit">
          <spf-last-play class="fit" [cardLinks]="true" />
          <spf-play-cards [sizer]="sizer()" [teamName]="team.year + ' ' + team.name" />
        </div>
      } @else if (game.state(); as s) {
        <div class="left">
          <div class="frame banner">{{ s.phase === 'GAME_OVER' ? 'The game is over.' : 'Nobody has the ball right now: kickoff next.' }} <a routerLink="/game">Game tab</a></div>
        </div>
        <aside><spf-last-play [cardLinks]="true" /></aside>
        <div class="plays"><spf-play-cards /></div>
      } @else {
        <p class="hint">Loading the game…</p>
      }
    </main>
      }
  `,
  styles: `
    /* The board, and the card at the width of every player card in the game (18.5rem, as on your own pages). */
    main.across { grid-template-columns: 40rem 18.5rem; }
    .across .side { display: grid; gap: .7rem; }
    .across .note, .across .hint { margin: 0; color: white; opacity: .85; }
    .master-call { color: white; }
    .master-call h3 { margin: 0 0 .4rem; font-size: 1rem; font-weight: 600; }
    .master-call small { font-weight: 400; opacity: .7; margin-left: .4rem; }
    .master-call dl { display: grid; grid-template-columns: max-content 1fr; gap: .25rem .9rem; margin: 0; }
    .master-call dt { opacity: .75; }
    .master-call dd, .master-call p { margin: 0; }
    :host { display: block; min-height: 100vh; background: var(--spf-field); }
    :host { min-width: var(--page-min-width); }
    /* Three columns, sized for 1920 x 1080: the board and the coach's choices, the player card, the last play. */
    main { display: grid; grid-template-columns: 40rem 18.5rem minmax(20rem, 1fr); gap: .7rem 1.6rem; padding: 1.4rem 1.6rem; align-items: start; }
    .plays { min-width: 0; }
    .left { display: grid; gap: .7rem; }
    /* A boot shape: board and coach panel on the left, the card beside them, the wide box underneath both. */
    main > .left { grid-column: 1; grid-row: 1; }
    main > aside { grid-column: 2; grid-row: 1; }
    main > .plays { grid-column: 3; grid-row: 1 / span 2; align-self: stretch; display: flex; flex-direction: column; gap: .7rem; }
    /* The cards at the foot of the column: their bottom edge on the same line as the wide box's. */
    .plays spf-play-cards { margin-top: auto; }
    /*
     * Next to the board, the column takes exactly the height of the two rows and never stretches them (contain: size),
     * so the cards' bottom is always level with the wide box's, whatever it shows. The last play gets the space above
     * the cards and scrolls inside if it needs more.
     */
    .plays.fit { contain: size; min-height: 0; }
    .plays.fit spf-last-play { flex: 0 1 auto; }
    main > .wide { grid-column: 1 / span 2; grid-row: 2; }
    .frame { border: 6px solid var(--spf-frame); border-radius: var(--radius-panel); padding: .5rem .6rem; }
    .last { margin-top: 1rem; }
    .banner a { color: white; }
    .snap { display: grid; gap: .5rem; color: white; }
    .snap .row { display: flex; align-items: center; gap: 1rem; }
    .moved { display: flex; align-items: center; gap: .4rem; margin: 0; font-size: .9rem; color: #e7f5c8; }
    .hurt { display: flex; align-items: center; gap: .4rem; margin: 0; font-size: .9rem; color: #ffd9c2; }
    .suggest {
      justify-self: start; font: inherit; font-size: .9rem; padding: .4rem .9rem; border-radius: 5px; cursor: pointer;
      border: 0; background: var(--spf-action); color: var(--spf-action-ink); font-weight: 600;
    }
    .suggest:hover { filter: brightness(1.05); }
    .snap.ready { border-color: var(--spf-line); }
    .snap p { margin: 0; font-size: .9rem; }
    .delay { font: inherit; font-size: .85rem; padding: .3rem .6rem; border-radius: 4px; border: 1px solid rgba(255, 255, 255, .6); background: transparent; color: white; cursor: pointer; }
    .delay:disabled { opacity: .45; cursor: not-allowed; }
    .two-minute { display: flex; align-items: center; gap: .35rem; white-space: nowrap; font-size: .9rem; }
    .two-minute input { width: 1.05rem; height: 1.05rem; accent-color: var(--spf-line); }
    .snap a { color: white; }
    .run {
      font: inherit; font-weight: 700; padding: .6rem 1.6rem; border: 0; border-radius: 5px; cursor: pointer;
      background: var(--spf-line); color: #14361a; white-space: nowrap;
    }
    .run:disabled { background: rgba(255,255,255,.25); color: rgba(255,255,255,.6); cursor: not-allowed; }
    .run:not(:disabled):hover { filter: brightness(1.05); }
    .banner { color: white; text-align: center; font-size: .9rem; padding: .45rem; }
    .card-stack { display: grid; }
    .card-stack > * { grid-area: 1 / 1; }
    .sizer { visibility: hidden; }
    .empty {
      margin: 0; display: grid; place-items: center; padding: 2rem; text-align: center;
      background: var(--spf-paper); border-radius: var(--radius-panel); color: var(--spf-ink-soft);
    }
    .replace { width: 100%; margin-top: .9rem; border: 0; border-radius: 5px; padding: .4rem; background: var(--spf-action); color: var(--spf-action-ink); font: inherit; font-weight: 600; cursor: pointer; }
    .replace:hover:not(:disabled) { filter: brightness(1.06); }
    .bench { list-style: none; margin: .4rem 0 0; padding: 0; display: grid; gap: 2px; }
    .bench button { width: 100%; text-align: left; border: 0; padding: .4rem .6rem; background: white; cursor: pointer; display: flex; justify-content: space-between; }
    .bench button:hover { background: #fff3e6; }
    .bench span { color: var(--spf-ink-soft); font-size: .85rem; }
    .none, .hint, .error { color: white; margin: 0; }
    .hint { opacity: .8; }
    .error { padding: 2rem; }
  `,
})
export class OffensePage {
  protected readonly game = inject(GameStore);
  protected readonly store = inject(OffenseCallStore);

  /** For the other coach: the offense's side, its formation and players as shown. */
  protected readonly offenseSide = computed(() => this.game.state()?.possession ?? null);
  protected readonly look = computed(() => {
    const l = this.game.state()?.offenseLook;
    return l ? { formation: getFormation(l.formationId as FormationId), lineup: l.lineup as Lineup } : null;
  });
  /** The player clicked on the other team's board, for his card. */
  protected readonly acrossSlot = signal<OffenseSlot | null>(null);
  protected readonly acrossPlayer = computed(() => {
    const slot = this.acrossSlot(), l = this.look();
    const id = slot && l ? l.lineup[slot] : undefined;
    return id ? this.lookPlayers().get(id) ?? null : null;
  });
  protected readonly acrossSizer = computed(() => [...this.lookPlayers().values()].find(p => p.position === 'QB'));
  protected readonly acrossTeamName = computed(() => {
    const side = this.offenseSide(), t = side ? this.game.teams()?.[side] : undefined;
    return t ? `${t.year} ${t.name}` : '';
  });
  protected readonly lookPlayers = computed(() => {
    const side = this.offenseSide(), teams = this.game.teams();
    return new Map((side && teams ? teams[side].players : []).map(p => [p.id, p]));
  });
  protected replacing = false;
  /** Ticked by the coach in the final minutes of a half (rule 9.4.1). */
  protected readonly twoMinute = signal(false);
  /** A timeout called with the coming play (rule 9.2). */
  protected readonly timeoutNext = signal(false);

  constructor() {
    // Online, the offense coach's call goes to the master as it takes shape (GameStore checks the seat; the defense
    // coach never gets it). Re-sent for each new play.
    effect(() => {
      this.game.state();
      this.game.shareDraft('offense', { call: this.store.call(), twoMinute: this.twoMinute(), timeout: this.timeoutNext() });
    });
  }

  /** For the master watching a coach online: the offense's whole call so far, line by line. */
  protected readonly masterCall = computed<{ k: string; v: string }[] | null>(() => {
    const s = this.game.state();
    if (this.game.seat() !== 'master' || !s) return null;
    if (s.puntCall) return [{ k: 'Kick', v: `Punt announced${s.puntCall.fake ? ': a FAKE' : ''}` }];
    if (s.fieldGoalCall) return [{ k: 'Kick', v: `Field goal${s.fakeKick ? ': a FAKE' : ''}` }];
    const d = this.game.drafts().offense;
    if (!d) return [];
    const c = d.call, lineup = this.look()?.lineup;
    const who = (slot: OffenseSlot) => {
      const p = this.lookPlayers().get(lineup?.[slot] ?? '');
      return `${p ? `${p.firstName} ${p.lastName}` : '?'} (${SLOT_LABELS[slot]})`;
    };
    return [
      { k: 'Formation', v: getFormation(c.formationId).name },
      { k: 'Play', v: PLAY_LABELS[c.play] },
      { k: isRunPlay(c.play) ? 'Ball carrier' : 'Target', v: who(c.slot) },
      ...(c.strategy !== 'NONE' ? [{ k: 'Strategy', v: STRATEGY_LABELS[c.strategy] }] : []),
      ...(c.extraBlockers.length ? [{ k: 'Extra blockers', v: c.extraBlockers.map(who).join(', ') }] : []),
      ...(d.twoMinute ? [{ k: 'Tempo', v: this.game.finalMinutes() ? 'Two-minute offense' : 'No-huddle' }] : []),
      ...(d.timeout ? [{ k: 'Timeout', v: 'After this play' }] : []),
    ];
  });

  /** The team's first QB card, used only to size the card area. */
  protected readonly sizer = computed(() => this.store.team()?.players.find(p => p.position === 'QB'));
  protected readonly situation = computed(() => (this.game.state() ? situationText(this.game.state()!) : ''));
  protected readonly clock = computed(() => (this.game.state() ? clockText(this.game.state()!) : ''));
  protected readonly injuryText = injuryText;
  /** Optional rule O1 for the card on show: "Guard playing tackle", or null. */
  protected readonly outOfPositionText = computed(() => {
    const slot = this.store.inspectedSlot();
    return slot ? outOfPosition(this.store.playerIn(slot), slot)?.text ?? null : null;
  });
  /** Running plays can be resolved now; passes come next. */
  protected readonly runnable = computed(() => canResolve(this.store.call()));

  /**
   * A click on the board selects that player: a QB, back, end or flanker becomes the target of the play
   * (and the play/strategy options follow him). Linemen can't carry the ball, so for them we only show the card.
   */
  onSlotClick(slot: OffenseSlot) {
    this.replacing = false;
    if (this.store.selectableSlots().includes(slot) && !this.store.restReason().has(slot)) {
      this.store.chooseTarget(slot);
    } else {
      this.store.inspect(slot);
      // A resting player opens his card but can't be called (rule 4.6): say so, rather than seem to have taken the click.
      if (this.store.restReason().has(slot)) this.store.explainRest(slot);
    }
  }

  /** Runs the call. The defense's "All set!" is reset by the engine, so the next play needs a new one. */
  run() {
    // The two-minute offense only counts in the final minutes; the engine checks that too.
    this.game.snap(this.store.call(), this.store.lineup(), this.twoMinute() && (this.game.finalMinutes() || this.game.noHuddleAllowed()), this.timeoutNext());
    this.timeoutNext.set(false); // a timeout is for one play only
    // The ball carrier may now need a rest (rule 4.6): move the call on to someone who can go.
    this.store.refresh();
  }

  replace(playerId: string) {
    const slot = this.store.inspectedSlot();
    if (slot) this.store.replace(slot, playerId);
    this.replacing = false;
  }
}
