import { Component, computed, effect, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DefenseBoard, DefenderClick } from '../../components/defense-board/defense-board';
import { DefensePanel } from '../../components/defense-panel/defense-panel';
import { PlayerCardView } from '../../components/player-card/player-card';
import {
  DEFENSE_CALL_LABELS, DefenseFormationId, DefenseLineup, clockText, dbOutOfPosition, fieldGoalDistance, getDefenseFormation, injuryText, otherSide, ReceiverPosition, situationText,
} from '../../engine';
import { Crutches } from '../../components/crutches/crutches';
import { Tooltip } from '../../shared/tooltip';
import { LastPlay } from '../../components/last-play/last-play';
import { PlayCards } from '../../components/play-cards/play-cards';
import { PageHeader } from '../../shell/page-header';
import { DefenseCallStore } from '../../state/defense-call.store';
import { GameStore } from '../../state/game.store';

@Component({
  selector: 'spf-defense-page',
  imports: [Tooltip, PageHeader, DefenseBoard, DefensePanel, PlayerCardView, RouterLink, LastPlay, PlayCards, Crutches],
  template: `
    <spf-page-header title="Defense selection" />
    @if (!game.myPage('defense')) {
      <!-- The other coach's view from across the line: the defense's formation and players as it sets up, not its call. -->
      <main class="across">
        <div class="side">
          <div class="frame banner">{{ defenseSide() ? game.label(defenseSide()!) : '' }} on defense :: {{ game.seat() === 'master' ? 'live, as its coach sets up' : 'what you see across the line' }}{{ game.defenseReady() ? ' (all set)' : '' }}</div>
          @if (shownDefense(); as d) {
            <div class="frame"><spf-defense-board [formation]="d.formation" [lineup]="d.lineup" [players]="defensePlayers()" [inspected]="acrossRef()" (defenderClick)="acrossRef.set($event)" /></div>
          } @else {
            <div class="frame"><p>The defense is still setting up.</p></div>
          }
          @if (masterCall(); as lines) {
            <!-- Only the master gets this: the defense coach's call (the offense coach never does). -->
            <div class="frame master-call">
              <h3>The defense's call <small>{{ game.defenseReady() ? 'all set' : 'still deciding' }} · only you see this</small></h3>
              @if (lines.length) {
                <dl>@for (l of lines; track l.k) { <dt>{{ l.k }}</dt><dd>{{ l.v }}</dd> }</dl>
              } @else { <p>No call picked yet.</p> }
            </div>
          } @else {
            <p class="note">The defense's call, blitzers, coverage and big play stay with the defense until the snap.</p>
          }
        </div>
        <!-- The same size as every card: an invisible quarterback card sets the height (the biggest card). -->
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
          <div class="frame banner">{{ game.label(store.side()!) }} on defense :: {{ situation() }} :: {{ clock() }}</div>
          <div class="frame">
            <spf-defense-board
              [formation]="store.formation()"
              [lineup]="store.lineup()"
              [players]="store.playersById()"
              [inspected]="store.inspectedRef()"
              [injured]="game.injuredIds(store.side())"
              (defenderClick)="onDefenderClick($event)"
            />
          </div>
          <div class="frame"><spf-defense-panel /></div>
        </div>

        <aside>
          <div class="card-stack">
            @if (sizer(); as qb) {
              <spf-player-card class="sizer" [player]="qb" [teamName]="team.year + ' ' + team.name" aria-hidden="true" />
            }
            @if (store.inspected(); as player) {
              <spf-player-card [player]="player" [teamName]="team.year + ' ' + team.name" [injury]="game.injuryOf(store.side(), player.id)" [outOfPosition]="outOfPositionText()" />
            } @else {
              <p class="empty">Click a player on the board to see his card.</p>
            }
          </div>
          @if (store.inspected()) {
            <button type="button" class="replace" (click)="replacing = !replacing" [attr.aria-expanded]="replacing" [disabled]="store.locked() || store.noHuddle()">
              {{ replacing ? 'Keep this player' : 'Replace' }}
            </button>
            @if (replacing && !store.locked()) {
              <ul class="bench">
                @for (p of store.replacements(); track p.id) {
                  <li><button type="button" (click)="replace(p.id)">{{ p.firstName }} {{ p.lastName }} <span>{{ p.position }}{{ p.position === 'DB' && p.role ? ' · ' + p.role : '' }}</span></button></li>
                } @empty {
                  <li class="none">No one on the bench can play box {{ store.inspectedRef()?.box }}.</li>
                }
              </ul>
            }
          }
        </aside>
          <div class="frame wide ready" [class.is-ready]="game.defenseReady()">
          @if (game.puntCall(); as p) {
            <div class="kick-row">
              <p><strong>{{ game.label(game.offenseSide()!) }} will punt</strong>{{ p.coffinCorner ? ', a coffin corner with ' + p.coffinCorner + ' yards off' : '' }}.</p>
              <!-- Both choices on one line; what they do is in their tooltips, so the page still fits the screen. -->
              <div class="kick-options">
                <label class="rush" spfTip="Rule 8.5.7: a better chance to block it, but a return of 3 yards at most, and roughing the kicker is possible">
                  <input type="checkbox" [checked]="store.allOutRush()" [disabled]="store.locked() || store.expectFake()"
                    (change)="store.allOutRush.set($any($event.target).checked)" /> All-out punt rush</label>
                <label class="rush" spfTip="Rule O6: +2 on a fake's RN, but a real punt can't be blocked">
                  <input type="checkbox" [checked]="store.expectFake()" [disabled]="store.locked()"
                    (change)="store.expectFake.set($any($event.target).checked)" /> Expect a fake</label>
              </div>
            </div>
          }
          @if (game.fieldGoalCall() && game.state()?.ballOn != null) {
            <div class="kick-row">
              <p><strong>{{ game.label(game.offenseSide()!) }} line up for a {{ fgDistance(game.state()!.ballOn!) }}-yard field goal.</strong></p>
              <div class="kick-options">
                <label class="rush" spfTip="Rule O6: +2 on a fake's RN, but a real kick can't be blocked">
                  <input type="checkbox" [checked]="store.expectFake()" [disabled]="store.locked()"
                    (change)="store.expectFake.set($any($event.target).checked)" /> Expect a fake</label>
              </div>
            </div>
          }
            <div class="row">
            @if (game.defenseReady()) {
              <button type="button" class="undo" (click)="game.setDefenseReady(false)">Not yet</button>
              <p>All set. The {{ game.label(game.offenseSide()!) }} offense can run the play. <a routerLink="/offense">Go to the offense</a></p>
            } @else {
              @if (game.state()?.offenseChanged && !game.defenseReady()) {
                <p class="lock" role="note">The offense changed its formation: you can change yours, then press "All set!" again.</p>
              }
              @if (game.noHuddleLock()) {
                <p class="lock" role="note">No-huddle: the clock is running, so you can't change players or formation unless the offense does (rule 8.7). You can still change your call.</p>
              }
              @if (game.delayAsked()) {
                <div class="delay-ask" role="alert">
                  <p>{{ game.label(game.offenseSide()!) }} ask for a delay of game: 5 yards back{{ game.delaySeconds() ? ', and ' + game.delaySeconds() + ' more seconds off the clock' : '' }}.</p>
                  <button type="button" class="go" (click)="game.answerDelayOfGame(true)" [disabled]="game.simulating()">Accept</button>
                  <button type="button" class="go" (click)="game.answerDelayOfGame(false)" [disabled]="game.simulating()">Decline</button>
                </div>
              }
              <button type="button" class="go" (click)="allSet()" [disabled]="game.simulating() || game.state()?.phase !== 'PLAY' || store.injuredOnField().length">All set!</button>
              @if (!game.puntCall() && !game.fieldGoalCall()) {
                <label class="timeout" [spfTip]="game.bigPlayBlocked(game.defenseSide()) ?? 'Rule 8.4: a card on the Big Play Table before the play; one per possession'">
                  <input type="checkbox" [checked]="bigPlayNext()" [disabled]="!!game.bigPlayBlocked(game.defenseSide()) || game.simulating()"
                    (change)="bigPlayNext.set($any($event.target).checked)" /> Big play ({{ game.bigPlaysLeft(game.defenseSide()) }} left)
                </label>
              }
              <label class="timeout" [spfTip]="game.timeoutsLeft(game.defenseSide()) ? 'Stops the clock after this play' : 'No timeouts left in this half'">
                <input type="checkbox" [checked]="timeoutNext()" [disabled]="!game.timeoutsLeft(game.defenseSide()) || game.simulating()"
                  (change)="timeoutNext.set($any($event.target).checked)" /> Timeout after this play ({{ game.timeoutsLeft(game.defenseSide()) }} left)
              </label>
              <p>{{ game.simulating() ? 'The computer is coaching this game: watch, or take over on the Game tab.' : 'The ' + game.label(game.offenseSide()!) + " can't run their play until you're ready." }}</p>
            }
            </div>
            @for (h of store.injuredOnField(); track h.box + h.index) {
              <p class="hurt"><spf-crutches [size]="18" /> Replace {{ h.injury.name }} (box {{ h.box }}): injured for {{ injuryText(h.injury.length) }}.</p>
            }
            @if (store.suggestion(); as sug) {
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
    :host { display: block; min-height: 100vh; min-width: var(--page-min-width); background: var(--page-defense); }
    /* Three columns, sized for 1920 x 1080: the board and the coach's choices, the player card, the last play. */
    main { display: grid; grid-template-columns: 40rem 18.5rem minmax(20rem, 1fr); gap: .7rem 1.6rem; padding: 1.4rem 1.6rem .4rem; align-items: start; }
    .plays { min-width: 0; }
    .left { display: grid; gap: .55rem; }
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
    .banner { color: white; text-align: center; font-size: .9rem; padding: .45rem; }
    .ready { display: grid; gap: .3rem; color: white; }
    .ready .row { display: flex; flex-wrap: wrap; align-items: center; gap: .4rem 1rem; }
    .ready .row > p { flex-basis: 100%; margin: 0; }
    .hurt { display: flex; align-items: center; gap: .4rem; margin: 0; font-size: .9rem; color: #fff1c9; }
    .suggest {
      justify-self: start; font: inherit; font-size: .9rem; padding: .4rem .9rem; border-radius: 5px; cursor: pointer;
      border: 0; background: var(--spf-action); color: var(--spf-action-ink); font-weight: 600;
    }
    .suggest:hover { filter: brightness(1.05); }
    .ready.is-ready { border-color: var(--spf-line); }
    .ready p { margin: 0; font-size: .9rem; }
    .ready a { color: white; }
    .go, .undo { font: inherit; border-radius: 5px; cursor: pointer; white-space: nowrap; }
    .go { font-weight: 700; padding: .6rem 1.6rem; border: 0; background: var(--spf-line); color: #14361a; }
    .undo { padding: .55rem 1.2rem; border: 1.5px solid rgba(255, 255, 255, .85); background: transparent; color: white; }
    .go:hover { filter: brightness(1.05); }
    .go:disabled { opacity: .5; cursor: not-allowed; }
    .kick-options { display: flex; flex-wrap: wrap; gap: .3rem 1.4rem; }
    /* The kick choices sit in the wide All set! row: room to spare there, and next to the button that confirms them. */
    .kick-row { display: flex; flex-wrap: wrap; align-items: center; gap: .2rem 1.4rem; padding-bottom: .1rem; border-bottom: 1px solid rgba(255, 255, 255, .2); }
    .kick-row p { margin: 0; }
    .kick-row label { font-size: .9rem; font-weight: 400; }
    .lock { margin: 0; flex-basis: 100%; padding: .35rem .6rem; border-radius: 5px; background: rgba(0, 0, 0, .25); font-size: .9rem; }
    .delay-ask { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; padding: .5rem .7rem; border-radius: 6px; background: rgba(0, 0, 0, .25); }
    .delay-ask p { margin: 0; flex-basis: 100%; }
    .timeout { display: flex; align-items: center; gap: .35rem; white-space: nowrap; font-size: .9rem; }
    .timeout input { width: 1.05rem; height: 1.05rem; accent-color: var(--spf-line); }
    .last { margin-top: 1rem; }
    .punt { color: white; display: grid; gap: .35rem; border-color: var(--spf-line); }
    .punt p { margin: 0; }
    .punt .note { font-size: .82rem; opacity: .8; }
    .rush { display: flex; align-items: center; gap: .4rem; font-weight: 600; }
    .rush input { width: 1.05rem; height: 1.05rem; accent-color: var(--spf-line); }
    .banner a { color: white; }
    .card-stack { display: grid; }
    .card-stack > * { grid-area: 1 / 1; }
    .sizer { visibility: hidden; }
    .empty { margin: 0; display: grid; place-items: center; padding: 2rem; text-align: center; background: var(--spf-paper); border-radius: var(--radius-panel); color: var(--spf-ink-soft); }
    .replace { width: 100%; margin-top: .9rem; border: 0; border-radius: 5px; padding: .4rem; background: var(--spf-action); color: var(--spf-action-ink); font: inherit; font-weight: 600; cursor: pointer; }
    .replace:hover:not(:disabled) { filter: brightness(1.06); }
    .replace:disabled { opacity: .55; cursor: not-allowed; }
    .bench { list-style: none; margin: .4rem 0 0; padding: 0; display: grid; gap: 2px; }
    .bench button { width: 100%; text-align: left; border: 0; padding: .4rem .6rem; background: white; cursor: pointer; display: flex; justify-content: space-between; }
    .bench button:hover { background: #fff3e6; }
    .bench span { color: var(--spf-ink-soft); font-size: .85rem; }
    .none, .hint { color: white; margin: 0; }
  `,
})
export class DefensePage {
  constructor() {
    // Online, the offense sees the defense line up as it happens: every change of formation or players is shown at once.
    effect(() => {
      const formation = this.store.formation(), lineup = this.store.lineup();
      if (this.game.online() && this.game.myPage('defense') && !this.game.defenseReady()) this.game.showDefense(formation.id, lineup);
    });
    // Online, the defense coach's whole call goes to the master as it takes shape (GameStore checks the seat; the
    // offense coach never gets it). After "All set!" the master reads the setup from the game itself.
    effect(() => {
      this.game.state();
      if (!this.game.defenseReady()) this.game.shareDraft('defense', this.fullSetup());
    });
  }

  /** For the other coach: the defense's side, its formation and players once it's set. */
  protected readonly defenseSide = computed(() => { const has = this.game.state()?.possession; return has ? otherSide(has) : null; });
  protected readonly shownDefense = computed(() => {
    // As set (All set!), or as it sets up: the offense sees the defense move as it happens.
    const s = this.game.state();
    const d = this.game.defenseReady() && s?.defenseSetup ? s.defenseSetup : s?.defenseLook;
    return d ? { formation: getDefenseFormation(d.formationId as DefenseFormationId), lineup: d.lineup as DefenseLineup } : null;
  });
  /** The defender clicked on the other team's board, for his card. */
  protected readonly acrossRef = signal<DefenderClick | null>(null);
  protected readonly acrossPlayer = computed(() => {
    const ref = this.acrossRef(), d = this.shownDefense();
    const id = ref && d ? d.lineup[ref.box]?.[ref.index] : undefined;
    return id ? this.defensePlayers().get(id) ?? null : null;
  });
  protected readonly acrossSizer = computed(() => [...this.defensePlayers().values()].find(p => p.position === 'QB'));
  protected readonly acrossTeamName = computed(() => {
    const side = this.defenseSide(), t = side ? this.game.teams()?.[side] : undefined;
    return t ? `${t.year} ${t.name}` : '';
  });


  protected readonly defensePlayers = computed(() => {
    const side = this.defenseSide(), teams = this.game.teams();
    return new Map((side && teams ? teams[side].players : []).map(p => [p.id, p]));
  });
  /** Optional rule O1 for the back on show: "Safety playing cornerback", or null. */
  protected readonly outOfPositionText = computed(() => {
    const ref = this.store.inspectedRef();
    const id = ref ? this.store.lineup()[ref.box]?.[ref.index ?? 0] : undefined;
    const player = id ? this.store.playersById().get(id) : undefined;
    return ref ? dbOutOfPosition(player, ref.box)?.text ?? null : null;
  });
  protected readonly game = inject(GameStore);
  protected readonly store = inject(DefenseCallStore);
  protected replacing = false;
  protected readonly injuryText = injuryText;
  protected readonly fgDistance = fieldGoalDistance;

  /** An invisible QB card keeps the card area the same size as on the offense screen. */
  /** Every card the same size as on the Offense page: a quarterback's (the biggest card); a defender's spreads to fill it. */
  protected readonly sizer = computed(() => this.store.team()?.players.find(p => p.position === 'QB'));
  protected readonly situation = computed(() => (this.game.state() ? situationText(this.game.state()!) : ''));
  protected readonly clock = computed(() => (this.game.state() ? clockText(this.game.state()!) : ''));

  onDefenderClick(ref: DefenderClick) {
    this.replacing = false;
    this.store.inspect(ref);
  }

  replace(playerId: string) {
    this.store.replace(playerId);
    this.replacing = false;
  }

  /** Hands the formation, lineup and call to the game. They stay secret until the snap. */
  allSet() {
    this.replacing = false;
    this.game.setDefenseReady(true, this.fullSetup());
    this.timeoutNext.set(false); // a timeout (or a big play) is for one play only
    this.bigPlayNext.set(false);
  }

  /** A timeout called with "All set!" (rule 9.2). */
  protected readonly timeoutNext = signal(false);
  /** A big play defense called with "All set!" (rule 8.4). */
  protected readonly bigPlayNext = signal(false);

  /** Everything "All set!" hands over: the store's setup, the timeout and the big play. */
  private fullSetup() {
    return { ...this.store.setup(), timeout: this.timeoutNext(), bigPlay: this.bigPlayNext() && !this.game.puntCall() && !this.game.fieldGoalCall() };
  }

  /** For the master watching a coach online: the defense's whole call, line by line (as set, or as it takes shape). */
  protected readonly masterCall = computed<{ k: string; v: string }[] | null>(() => {
    const s = this.game.state();
    if (this.game.seat() !== 'master' || !s) return null;
    const d = this.game.defenseReady() && s.defenseSetup ? s.defenseSetup : this.game.drafts().defense;
    if (!d) return [];
    const name = (id: string) => { const p = this.defensePlayers().get(id); return p ? `${p.firstName} ${p.lastName}` : id; };
    return [
      { k: 'Call', v: DEFENSE_CALL_LABELS[d.call] },
      ...(d.call === 'BLITZ' && d.blitzers?.length ? [{ k: 'Blitzing', v: d.blitzers.map(name).join(', ') }] : []),
      ...(d.coverage?.length ? [{ k: 'Coverage', v: d.coverage.map(c => `${c.level === 'TRIPLE' ? 'Triple' : 'Double'} on ${RECEIVER_LABELS[c.receiver]}`).join(', ') }] : []),
      ...(d.bigPlay ? [{ k: 'Big play', v: 'Yes' }] : []),
      ...(d.allOutRush ? [{ k: 'Punt', v: 'All-out rush' }] : []),
      ...(d.expectFake ? [{ k: 'Kick', v: 'Expects a fake' }] : []),
      ...(d.timeout ? [{ k: 'Timeout', v: 'After this play' }] : []),
    ];
  });
}

const RECEIVER_LABELS: Record<ReceiverPosition, string> = {
  LE: 'the left end', RE: 'the right end', FL1: 'flanker 1', FL2: 'flanker 2', BK1: 'back 1', BK2: 'back 2', BK3: 'back 3',
};
