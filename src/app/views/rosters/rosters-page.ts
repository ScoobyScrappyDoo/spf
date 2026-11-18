import { Component, computed, effect, inject, signal } from '@angular/core';
import { PlayerCardView } from '../../components/player-card/player-card';
import { PlayerCard, Team } from '../../engine';
import { TeamService } from '../../services/team.service';
import { PageHeader } from '../../shell/page-header';
import { GameStore } from '../../state/game.store';

type Group = { title: string; kind: 'qb' | 'skill' | 'line' | 'dl' | 'lb' | 'db' | 'k' | 'p'; players: PlayerCard[] };

const GROUPS: { title: string; kind: Group['kind']; positions: string[] }[] = [
  { title: 'Quarterbacks', kind: 'qb', positions: ['QB'] },
  { title: 'Running backs', kind: 'skill', positions: ['RB'] },
  { title: 'Wide receivers', kind: 'skill', positions: ['WR'] },
  { title: 'Tight ends', kind: 'skill', positions: ['TE'] },
  { title: 'Offensive line', kind: 'line', positions: ['OT', 'OG', 'C'] },
  { title: 'Defensive line', kind: 'dl', positions: ['DE', 'DT'] },
  { title: 'Linebackers', kind: 'lb', positions: ['LB'] },
  { title: 'Defensive backs', kind: 'db', positions: ['DB'] },
  { title: 'Kickers', kind: 'k', positions: ['K'] },
  { title: 'Punters', kind: 'p', positions: ['P'] },
];
const POSITION_NAME: Record<string, string> = { OT: 'Tackle', OG: 'Guard', C: 'Center', DE: 'End', DT: 'Tackle', LB: 'Linebacker' };

/** Plus 4, Minus 3, 0: as the cards print it. */
const printed = (v: number) => (v > 0 ? `Plus ${v}` : v < 0 ? `Minus ${-v}` : '0');
const range = (r: { from: number; to: number } | null | undefined) => (!r ? '–' : r.from === r.to ? `${r.from}` : `${r.from}-${r.to}`);

/**
 * Every team's cards, grouped by position: for any season and team, or the two teams of the game being played.
 * Linemen, linebackers and backs show their values in the row; click any row for the player's card.
 */
@Component({
  selector: 'spf-rosters-page',
  imports: [PageHeader, PlayerCardView],
  template: `
    <spf-page-header title="Rosters" />
    <main>
      <section class="list">
        <div class="pick">
          @if (gameTeams(); as g) {
            <div class="quick" role="group" aria-label="This game's teams">
              <span class="label">This game</span>
              @for (t of g; track t.id) {
                <button type="button" [class.on]="t.id === teamId()" (click)="choose(t.year, t.id)">{{ t.label }}</button>
              }
            </div>
          }
          <label>Season
            <select (change)="year.set(+$any($event.target).value)" aria-label="Season">
              @for (y of years(); track y) { <option [value]="y" [selected]="y === year()">{{ y }}</option> }
            </select>
          </label>
          <label>Team
            <select (change)="teamId.set($any($event.target).value)" aria-label="Team">
              @for (t of teamsOfYear(); track t.id) { <option [value]="t.id" [selected]="t.id === teamId()">{{ t.name }}</option> }
            </select>
          </label>
        </div>

        @if (team(); as t) {
          <div class="team-card">
            <h2>{{ t.year }} {{ t.name }}</h2>
            <p>{{ t.division }}{{ t.coach ? ' · Coach ' + t.coach : '' }}{{ t.record ? ' · ' + t.record : '' }}</p>
            <p>Big plays: {{ t.bigPlays?.home ?? 0 }} at home, {{ t.bigPlays?.road ?? 0 }} on the road · Fumbles lost: {{ fumbles(t) }}</p>
            <p class="legend"><span class="starter">Starters</span>, from the team's lineup card, are in light blue.</p>
          </div>
          @for (g of groups(); track g.title) {
            <h3>{{ g.title }} <small>{{ g.players.length }}</small></h3>
            <table [class]="g.kind">
              <colgroup>@for (w of widths[g.kind]; track $index) { <col [style.width]="w" /> }</colgroup>
              <thead>
                <tr>
                  @switch (g.kind) {
                    @case ('qb') { <th>Player</th><th>Endurance</th> }
                    @case ('skill') { <th>Player</th><th>Rating</th> }
                    @case ('line') { <th>Position</th><th>Player</th><th>Blocks</th><th>Pass block</th> }
                    @case ('dl') { <th>Position</th><th>Player</th><th>Tackles</th><th>Pass rush</th> }
                    @case ('lb') { <th>Player</th><th>Tackles</th><th>Pass rush</th><th>Pass defense</th><th>Intercepts</th> }
                    @case ('db') { <th>Player</th><th>Listed</th><th>Pass rush</th><th>Pass defense</th><th>Intercepts</th> }
                    @case ('k') { <th>Player</th><th>18-25</th><th>26-35</th><th>36-45</th><th>46-50</th><th>51-60</th><th>Extra pt</th> }
                    @case ('p') { <th>Player</th><th>Average</th><th>Longest</th> }
                  }
                </tr>
              </thead>
              <tbody>
                @for (p of g.players; track p.id) {
                  <tr [class.selected]="p.id === selectedId()" [class.clickable]="hasCard(p)" [attr.tabindex]="hasCard(p) ? 0 : null"
                    (click)="select(p)" (keydown.enter)="select(p)" (keydown.space)="select(p); $event.preventDefault()"
                    (keydown.arrowdown)="move($event, 1)" (keydown.arrowup)="move($event, -1)">
                    @switch (g.kind) {
                      @case ('qb') { <td class="name" [class.starter]="starters().has(p.id)">{{ name(p) }}</td><td>{{ $any(p).endurance }}</td> }
                      @case ('skill') { <td class="name" [class.starter]="starters().has(p.id)">{{ name(p) }}</td><td>{{ $any(p).playDirection }}</td> }
                      @case ('line') { <td>{{ positionName(p) }}</td><td class="name" [class.starter]="starters().has(p.id)">{{ name(p) }}</td><td>{{ printed($any(p).runBlock) }}</td><td>{{ $any(p).passBlock }}</td> }
                      @case ('dl') { <td>{{ positionName(p) }}</td><td class="name" [class.starter]="starters().has(p.id)">{{ name(p) }}</td><td>{{ printed($any(p).tackle) }}</td><td>{{ $any(p).passRush }}</td> }
                      @case ('lb') { <td class="name" [class.starter]="starters().has(p.id)">{{ name(p) }}</td><td>{{ printed($any(p).tackle) }}</td><td>{{ $any(p).passRush }}</td><td>{{ printed($any(p).passDefense) }}</td><td>{{ range($any(p).intercept) }}{{ $any(p).interceptMaybe ? '?' : '' }}</td> }
                      @case ('db') { <td class="name" [class.starter]="starters().has(p.id)">{{ name(p) }}</td><td class="listed">{{ positionName(p) }}</td><td>{{ $any(p).passRush }}</td><td>{{ printed($any(p).passDefense) }}</td><td>{{ range($any(p).intercept) }}{{ $any(p).interceptMaybe ? '?' : '' }}</td> }
                      @case ('k') {
                        <td class="name" [class.starter]="starters().has(p.id)">{{ name(p) }}</td>
                        @for (b of $any(p).fieldGoals; track $index) { <td>{{ range(b.good) }}</td> }
                        <td>{{ range($any(p).extraPoint) }}</td>
                      }
                      @case ('p') { <td class="name" [class.starter]="starters().has(p.id)">{{ name(p) }}</td><td>{{ puntAverage(p) }} yards</td><td>{{ puntLongest(p) }} yards</td> }
                    }
                  </tr>
                }
              </tbody>
            </table>
          }
          @if (returners(t); as r) {
            <h3>Returners</h3>
            <table class="returners">
              <thead><tr><th></th><th>1</th><th>2</th><th>3</th><th>4</th></tr></thead>
              <tbody>
                <tr><td>Kickoffs</td>@for (n of r.kick; track $index) { <td>{{ n }}</td> }</tr>
                <tr><td>Punts</td>@for (n of r.punt; track $index) { <td>{{ n }}</td> }</tr>
              </tbody>
            </table>
          }
        } @else {
          <p class="empty">Loading the cards…</p>
        }
      </section>

      <aside>
        @if (selected(); as p) {
          <!-- Every card gets the same space: an invisible QB card (the tallest kind) sits in the same grid cell. -->
          <div class="card-stack">
            @if (sizer(); as qb) { <spf-player-card class="sizer" [player]="qb" [teamName]="team()!.year + ' ' + team()!.name" aria-hidden="true" /> }
            <spf-player-card [player]="p" [teamName]="team()!.year + ' ' + team()!.name" />
          </div>
        } @else {
          <p class="empty">Click a player for his card.</p>
        }
      </aside>
    </main>
  `,
  styles: `
    :host { display: block; min-height: 100vh; min-width: var(--page-min-width); background: var(--page-rosters); color: white; }
    main { display: grid; grid-template-columns: minmax(40rem, 58rem) 18.5rem; gap: 1.6rem; padding: 1.4rem 1.6rem 2rem; align-items: start; }
    .pick { display: flex; flex-wrap: wrap; align-items: center; gap: .6rem 1.2rem; margin-bottom: 1rem; }
    .pick label { display: flex; align-items: center; gap: .4rem; }
    .pick label { gap: .5rem; }
    .pick select { font: inherit; padding: .25rem .4rem; border-radius: 4px; border: 0; }
    .pick select[aria-label='Team'] { width: 17rem; } /* wide enough for the longest name, so nothing shifts */
    /* The game's two teams get a row of their own: room for any name, and nothing after them to push along. */
    .quick { display: flex; gap: 2px; align-items: center; flex-basis: 100%; }
    .quick .label { margin-right: .6rem; font-size: .8rem; text-transform: uppercase; letter-spacing: .06em; opacity: .75; }
    /* A fixed width for both, so the bold of the chosen one can't push anything along. */
    .quick button {
      font: inherit; padding: .35rem .9rem; border: 0; cursor: pointer; background: rgba(255, 255, 255, .15); color: white;
      width: 16rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .quick .label + button { border-radius: 5px 0 0 5px; }
    .quick button:last-child { border-radius: 0 5px 5px 0; }
    .quick button.on { background: white; color: var(--page-rosters); font-weight: 600; }
    .team-card { padding: .6rem .9rem; border-radius: 6px; background: rgba(0, 0, 0, .18); margin-bottom: .6rem; }
    .team-card h2 { margin: 0 0 .2rem; font-size: 1.25rem; }
    .team-card p { margin: .1rem 0; font-size: .9rem; opacity: .9; }
    h3 { margin: 1rem 0 .3rem; font-size: 1rem; color: #ffd27a; }
    h3 small { font-weight: 400; color: rgba(255, 255, 255, .6); margin-left: .3rem; }
    table { width: 100%; border-collapse: collapse; font-size: .9rem; font-variant-numeric: tabular-nums; table-layout: fixed; }
    td.listed { font-size: .82rem; opacity: .85; }
    .card-stack { display: grid; }
    .card-stack > * { grid-area: 1 / 1; }
    .sizer { visibility: hidden; }
    th { text-align: left; font-weight: 600; opacity: .75; padding: .2rem .5rem; border-bottom: 1px solid rgba(255, 255, 255, .4); }
    td { padding: .25rem .5rem; border-bottom: 1px solid rgba(255, 255, 255, .12); }
    td.name { font-weight: 600; }
    /* The starters, from the team's lineup card: light blue, apart from the cream names and the gold headings. */
    td.name.starter { color: #9fdcff; }
    .legend .starter { color: #9fdcff; font-weight: 600; }
    tr.clickable { cursor: pointer; }
    tr.clickable:hover { background: rgba(255, 255, 255, .1); }
    tr.clickable:focus-visible { outline: 2px solid #ffd27a; outline-offset: -2px; }
    tr.selected { background: rgba(255, 210, 122, .25); }
    aside { position: sticky; top: 1rem; }
    .empty { opacity: .8; }
  `,
})
export class RostersPage {
  private readonly data = inject(TeamService);
  private readonly game = inject(GameStore);
  protected readonly printed = printed;
  /**
   * Column widths, the same for tables that belong together so their columns line up: offensive and defensive line
   * (Blocks over Tackles, Pass block over Pass rush), linebackers and defensive backs (Tackles over Listed).
   */
  protected readonly widths: Record<Group['kind'], string[]> = {
    qb: ['34%', '66%'], skill: ['34%', '66%'],
    line: ['16%', '34%', '25%', '25%'], dl: ['16%', '34%', '25%', '25%'],
    lb: ['34%', '16.5%', '16.5%', '16.5%', '16.5%'], db: ['34%', '16.5%', '16.5%', '16.5%', '16.5%'],
    k: ['34%', '11%', '11%', '11%', '11%', '11%', '11%'], p: ['34%', '16.5%', '49.5%'],
  };
  /** The card every card is sized to: the team's first quarterback (the tallest kind). */
  protected readonly sizer = computed(() => this.team()?.players.find(p => p.position === 'QB'));
  protected readonly range = range;

  protected readonly year = signal(0);
  /** The game (if any) is back from storage: only then is "no game" certain. */
  private readonly gameRestored = signal(false);
  protected readonly teamId = signal('');
  protected readonly team = signal<Team | null>(null);
  protected readonly selectedId = signal<string | null>(null);

  protected readonly years = computed(() => [...new Set(this.data.catalog().map(t => t.year))].sort((a, b) => a - b));
  protected readonly teamsOfYear = computed(() => this.data.catalog().filter(t => t.year === this.year()).sort((a, b) => a.name.localeCompare(b.name)));

  /** The teams of the game being played, for one-click switching. */
  protected readonly gameTeams = computed(() => {
    const teams = this.game.teams();
    return teams ? (['away', 'home'] as const).map(side => ({ id: teams[side].id, year: teams[side].year, label: this.game.label(side) })) : null;
  });

  constructor() {
    void this.data.loadCatalog(); // fetched once, whichever page asks first
    void this.game.restored.then(() => this.gameRestored.set(true));
    // Start on the game's away team when a game is on, otherwise the first team of the fullest season. After a reload
    // the game comes back from storage a moment after the team list, so wait for it before deciding there's no game.
    effect(() => {
      if (this.year() || !this.data.catalog().length) return;
      const g = this.gameTeams();
      if (g) return this.choose(g[0].year, g[0].id);
      if (!this.gameRestored()) return;
      const count = (y: number) => this.data.catalog().filter(t => t.year === y).length;
      const y = [...this.years()].sort((a, b) => count(b) - count(a))[0];
      this.year.set(y);
    });
    // A season without the chosen team: pick its first team.
    effect(() => {
      const list = this.teamsOfYear();
      if (list.length && !list.some(t => t.id === this.teamId())) this.teamId.set(list[0].id);
    });
    // Load the team's cards.
    effect(() => {
      const id = this.teamId();
      if (!id) return;
      // The current team stays on screen until the new one is in: no empty moment for the page to collapse into.
      this.data.loadTeam(id).then(t => {
        if (this.teamId() !== id) return;
        this.selectedId.set(null);
        this.team.set(t);
      });
    });
  }

  choose(year: number, id: string) {
    this.year.set(year);
    this.teamId.set(id);
  }

  protected readonly groups = computed<Group[]>(() => {
    const t = this.team();
    if (!t) return [];
    return GROUPS.map(g => ({ title: g.title, kind: g.kind, players: t.players.filter(p => g.positions.includes(p.position)) })).filter(g => g.players.length);
  });

  /** Who starts: the players on the team's lineup card, offense and defense. */
  protected readonly starters = computed(() => {
    const t = this.team();
    return new Set([...(t?.startingLineup?.offense ?? []), ...(t?.startingLineup?.defense ?? [])].map(e => e.playerId));
  });

  protected readonly selected = computed(() => this.team()?.players.find(p => p.id === this.selectedId()) ?? null);

  /** Every player has a card. */
  protected hasCard(_p: PlayerCard) {
    return true;
  }

  protected select(p: PlayerCard) {
    if (this.hasCard(p)) this.selectedId.set(p.id);
  }

  /** Arrow keys walk the rows. */
  protected move(e: Event, step: number) {
    const rows = [...document.querySelectorAll<HTMLElement>('tr.clickable')];
    const i = rows.indexOf(e.currentTarget as HTMLElement);
    const next = rows[i + step];
    if (next) {
      e.preventDefault();
      next.focus();
      next.click();
    }
  }

  protected name(p: PlayerCard) {
    return `${p.firstName} ${p.lastName}`;
  }

  protected positionName(p: PlayerCard) {
    if (p.position === 'DB') return p.role === 'CB' ? 'Cornerback' : p.role === 'S' ? 'Safety' : 'Defensive Back';
    return POSITION_NAME[p.position] ?? p.position;
  }

  protected fumbles(t: Team) {
    return t.fumblesLost ? range(t.fumblesLost) : '–';
  }

  /** The average of RN 1-11, as a coach would quote it. */
  protected puntAverage(p: PlayerCard) {
    if (p.position !== 'P') return '';
    const yards = p.punts.slice(0, 11).map(x => x.yards);
    return Math.round(yards.reduce((a, y) => a + y, 0) / yards.length);
  }

  /** The longest punt on the card: RN 1, or an RN 12 special that goes further. */
  protected puntLongest(p: PlayerCard) {
    if (p.position !== 'P') return '';
    const specials = p.special.flatMap(s => (s.result.type === 'NO_RETURN' ? [s.result.yards] : []));
    return Math.max(...p.punts.map(x => x.yards), ...specials);
  }

  protected returners(t: Team) {
    const names = (unit: Team['kickReturn'], prefix: string) => {
      if (!unit) return ['–', '–', '–', '–'];
      return [1, 2, 3, 4].map(i => {
        let r = unit.returners[`${prefix}${i}` as keyof typeof unit.returners] as { name?: string; sameAs?: string } | undefined;
        for (let hop = 0; r?.sameAs && hop < 4; hop++) r = unit.returners[r.sameAs as keyof typeof unit.returners] as typeof r;
        return r?.name ?? '–';
      });
    };
    return t.kickReturn || t.puntReturn ? { kick: names(t.kickReturn, 'KR'), punt: names(t.puntReturn, 'PR') } : null;
  }
}
