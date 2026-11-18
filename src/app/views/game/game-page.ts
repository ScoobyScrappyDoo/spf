import { Component, HostListener, computed, effect, inject, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { LedScoreboard } from '../../components/led-scoreboard/led-scoreboard';
import { FieldView } from '../../components/field/field';
import { LastPlay } from '../../components/last-play/last-play';
import { createGame, minutesText, otherSide, PROTOCOL, quarterLabel, rebuildGame, situationText } from '../../engine';
import { TeamService } from '../../services/team.service';
import { PageHeader } from '../../shell/page-header';
import { SimSpeed, SimulationService } from '../../state/simulation.service';
import { ReplayService } from '../../state/replay.service';
import { decodeGame, encodeGame, gameFileName, toSavedGame } from '../../services/game-file';
import { GameStore } from '../../state/game.store';
import { WeatherService } from '../../state/weather.service';
import { AuthService, signedIn } from '../../services/auth.service';

import { Tooltip } from '../../shared/tooltip';
interface OnlineGame {
  id: string;
  home: string;
  away: string;
  score: { home: number; away: number };
  seats: Partial<Record<'home' | 'away' | 'master', string>>;
  /** May the signed-in person end this game (an admin, or a coach in it)? */
  mayEnd?: boolean;
}

@Component({
  selector: 'spf-game-page',
  imports: [Tooltip, PageHeader, LedScoreboard, FieldView, LastPlay, RouterLink],
  templateUrl: './game-page.html',
  styleUrl: './game-page.scss',
})
export class GamePage implements OnInit {
  protected readonly game = inject(GameStore);
  protected readonly data = inject(TeamService);

  protected readonly homeId = signal('');
  protected readonly awayId = signal('');
  protected readonly homeYear = signal(0);
  protected readonly awayYear = signal(0);
  /** Seasons in the catalog, newest first. */
  protected readonly years = computed(() => [...new Set(this.data.catalog().map(t => t.year))].sort((a, b) => b - a));
  protected readonly starting = signal(false);

  protected readonly s = this.game.state;
  protected readonly latest = computed(() => this.s()?.log.at(-1) ?? null);
  protected readonly receiving = computed(() => {
    const k = this.s()?.kickoff?.kicking;
    return k ? otherSide(k) : null;
  });
  protected readonly situation = computed(() => (this.s() ? situationText(this.s()!) : ''));

  /**
   * Each side picks a season, then a team from it, grouped by division.
   * A team picked on one side is taken out of the other side's list (the 1984 and 1987 Dolphins are different teams).
   */
  protected readonly awayGroups = computed(() => this.groups(this.awayYear(), this.homeId()));
  protected readonly homeGroups = computed(() => this.groups(this.homeYear(), this.awayId()));

  async ngOnInit() {
    void this.checkSignIn();
    await this.data.loadCatalog();
    this.resetSetup();
  }

  resetSetup() {
    // Start on the season with the most teams (the newest of those): a full league to pick from, not a lone made team.
    const count = (y: number) => this.data.catalog().filter(t => t.year === y).length;
    const start = [...this.years()].sort((a, b) => count(b) - count(a) || b - a)[0] ?? 0;
    this.awayYear.set(start);
    this.homeYear.set(start);
    this.homeId.set('');
    this.awayId.set('');
  }

  chooseYear(side: 'home' | 'away', year: string) {
    (side === 'home' ? this.homeYear : this.awayYear).set(Number(year));
    (side === 'home' ? this.homeId : this.awayId).set('');
  }

  private groups(year: number, exclude: string) {
    const teams = this.data.catalog().filter(t => t.year === year && t.id !== exclude);
    const divisions = [...new Set(teams.map(t => t.division))];
    return divisions.map(division => ({ division, teams: teams.filter(t => t.division === division) }));
  }

  /** Who plays each side of a local game, for the Game Book (optional, 30 characters at most). */
  protected readonly homeCoach = signal('');
  protected readonly awayCoach = signal('');
  /** Weather conditions for the game (the layout for now; the effects come later). */
  /** The weather (a service, so the field can draw it): only the look for now, the engine doesn't use it yet. */
  protected readonly wx = inject(WeatherService);
  protected readonly weather = this.wx.conditions;
  protected readonly intensity = this.wx.intensity;
  protected readonly intensities = ['Light', 'Medium', 'Heavy'];

  /** Solitaire: which side you play; the computer coach plays the other. */
  protected readonly youPlay = signal<'both' | 'home' | 'away'>('both');
  /** How far the computer coach lets the field tilt its choices (solitaire and simulations). */
  protected readonly temperament = signal<'cautious' | 'normal' | 'bold'>('normal');

  async start() {
    this.wx.newGame();
    this.starting.set(true);
    const name = (v: string) => v.trim().slice(0, 30) || undefined;
    const you = this.youPlay();
    const coaches = {
      home: you === 'away' ? 'AI' : name(this.homeCoach()),
      away: you === 'home' ? 'AI' : name(this.awayCoach()),
    };
    // The computer coach's temperament only matters against the computer (its dropdown is enabled only then).
    await this.game.newGame(this.homeId(), this.awayId(), coaches.home || coaches.away ? coaches : undefined, you === 'both' ? 'normal' : this.temperament());
    this.starting.set(false);
  }

  protected readonly sim = inject(SimulationService);
  protected readonly speed = signal<SimSpeed>('normal');
  protected readonly speeds: { value: SimSpeed; label: string }[] = [
    { value: 'instant', label: 'Instant' }, { value: 'fast', label: 'Fast' }, { value: 'normal', label: 'Normal' }, { value: 'slow', label: 'Slow' },
  ];

  protected readonly replay = inject(ReplayService);
  protected readonly busy = computed(() => this.sim.running() || this.replay.running());
  protected readonly fileMessage = signal<string | null>(null);
  /** A replay is for watching: instant would just jump to the end, so it starts at normal speed unless chosen otherwise. */
  protected readonly replaySpeed = computed<SimSpeed>(() => (this.speed() === 'instant' ? 'normal' : this.speed()));

  /** Downloads the game as a .spf file. */
  async save() {
    const state = this.game.state();
    const teams = this.game.teams();
    if (!state || !teams) return;
    try {
      const bytes = await encodeGame(toSavedGame(state, teams));
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = gameFileName(state, side => this.game.label(side), String(teams.home.year));
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      this.fileMessage.set(`Saved as "${a.download}" in your downloads.`);
    } catch (e) {
      this.fileMessage.set((e as Error).message);
    }
  }

  /** Opens a .spf file: the game is rebuilt from its seed and decisions, and must end as it was saved. */
  async open(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = '';
    if (file) await this.openFile(file);
  }

  // ---- Drag and drop: a .spf file dropped anywhere on the page opens like "Open game…" ----
  protected readonly dragging = signal(false);
  private dragDepth = 0;

  @HostListener('dragenter', ['$event'])
  protected dragEnter(e: DragEvent) {
    if (!this.hasFiles(e) || this.busy()) return;
    e.preventDefault();
    this.dragDepth++;
    this.dragging.set(true);
  }

  @HostListener('dragover', ['$event'])
  protected dragOver(e: DragEvent) {
    if (!this.hasFiles(e) || this.busy()) return;
    e.preventDefault(); // allows the drop
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }

  @HostListener('dragleave', ['$event'])
  protected dragLeave(e: DragEvent) {
    if (!this.hasFiles(e)) return;
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (!this.dragDepth) this.dragging.set(false);
  }

  @HostListener('drop', ['$event'])
  protected async drop(e: DragEvent) {
    if (!this.hasFiles(e)) return;
    e.preventDefault();
    this.dragDepth = 0;
    this.dragging.set(false);
    if (this.busy()) return;
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.spf')) {
      this.fileMessage.set(`"${file.name}" isn't a game file: drop a .spf file saved with "Save game".`);
      return;
    }
    await this.openFile(file);
  }

  private hasFiles(e: DragEvent) {
    return !!e.dataTransfer && Array.from(e.dataTransfer.types ?? []).includes('Files');
  }

  /** Opens a .spf file: the game is rebuilt from its seed and decisions, and must end as it was saved. */
  async openFile(file: File) {
    if (this.game.state() && this.game.state()!.phase !== 'GAME_OVER' && !confirm('Open a saved game? The game in progress will be replaced.')) return;
    this.starting.set(true);
    try {
      const saved = await decodeGame(new Uint8Array(await file.arrayBuffer()));
      if (saved.version === 2 && saved.teams && saved.state) {
        // Exactly as saved, with the cards it was played with.
        await this.game.loadWithTeams(saved.state, saved.teams);
        this.fileMessage.set(`Opened "${file.name}".`);
        return;
      }
      await this.game.load(createGame(saved.start, await this.data.loadDeck()));
      const ctx = this.game.ctx()!;
      const rebuilt = rebuildGame(saved.start, saved.journal, ctx, this.game.cards()!);
      this.game.showFrame(rebuilt);
      const same = rebuilt.score.home === saved.result.score.home && rebuilt.score.away === saved.result.score.away && rebuilt.phase === saved.result.phase;
      const where = rebuilt.phase === 'GAME_OVER' ? 'It ends differently' : `It stops at ${quarterLabel(rebuilt.quarter)} ${minutesText(rebuilt.clock)}, where the saved steps run out; "Let the computer finish" plays the rest`;
      this.fileMessage.set(same ? `Opened "${file.name}".`
        : `"${file.name}" was saved by an older version of the game, and with today's cards and computer coach it plays out differently. ${where}.`);
    } catch (e) {
      this.fileMessage.set(`Couldn't open "${file.name}": ${(e as Error).message}`);
    } finally {
      this.starting.set(false);
    }
  }

  // ---------- Online play ----------
  protected readonly auth = inject(AuthService);
  /** The signed-in person (server/auth.ts), or null. */
  protected readonly me = computed(() => signedIn(this.auth.status()));
  /** The seats shown in the list of online games: the master seat (sees both teams) only for an admin. */
  /** The game you were in was ended: show the list as it is now, without the ended game. */
  private readonly refreshWhenEnded = effect(() => {
    if (this.game.onlineNotice()) void this.refreshOnline();
  });
  protected readonly seats = computed(() => (this.me()?.admin ? (['home', 'away', 'master'] as const) : (['home', 'away'] as const)));
  protected readonly coachName = signal('Coach');

  /** Who is signed in to the game server; their first name becomes the coach's name, if it's still "Coach". */
  private async checkSignIn() {
    if (!this.auth.status()) await this.auth.refresh();
    const me = this.me();
    if (me && this.coachName() === 'Coach') this.coachName.set(me.name.split(' ')[0].slice(0, 30));
  }

  /** The server says "sign in first": show the sign-in link instead of an error. */
  private signedOut(res: Response): boolean {
    if (res.status !== 401) return false;
    this.auth.status.set('signed-out');
    this.onlineMessage.set('Online play is invite only: sign in first.');
    return true;
  }
  protected readonly onlineGames = signal<OnlineGame[]>([]);
  protected readonly onlineMessage = signal<string | null>(null);
  /**
   * The online banner takes the colour of what your team is doing: the offense's blue with the ball, the defense's
   * teal without it (the same colours as the Offense and Defense buttons). Neutral (the stylesheet's grey) for the
   * master, and while nobody has the ball (coin toss, kickoff).
   */
  protected readonly seatColor = computed(() => {
    const seat = this.game.online()?.seat, has = this.s()?.possession;
    if (!seat || seat === 'master' || !has) return null;
    return has === seat ? 'var(--tile-offense)' : 'var(--tile-defense)';
  });

  /** " (New England)" for a coach's seat, nothing for the master. */
  protected seatTeam(seat: string) {
    const t = this.game.teams();
    return seat === 'home' || seat === 'away' ? ` (${t?.[seat].name ?? ''})` : '';
  }
  protected seatName(seat: string) {
    return seat === 'master' ? 'the master (both teams)' : `the ${seat} coach`;
  }

  /** The games on the game server, and who has which seat. */
  async refreshOnline() {
    try {
      const res = await fetch('/api/games');
      if (this.signedOut(res)) return;
      if (!res.ok) throw new Error();
      const games = (await res.json()) as (OnlineGame & { protocol?: number })[];
      this.onlineGames.set(games);
      this.onlineMessage.set(games.some(g => g.protocol !== PROTOCOL) ? 'The game server is older than the app: stop it (Ctrl+C in its terminal) and start it again with npm run server.'
        : games.length ? null : 'No games on the server yet: start one with the teams chosen above.');
    } catch {
      this.onlineMessage.set("Can't reach the game server. Start it in a second terminal with: npm run server");
    }
  }

  async createOnline() {
    try {
      const res = await fetch('/api/games', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ homeTeamId: this.homeId(), awayTeamId: this.awayId() }) });
      if (this.signedOut(res)) return;
      if (!res.ok) throw new Error((await res.json()).error);
      if ((await res.json()).protocol !== PROTOCOL) throw new Error('The game server is older than the app: stop it (Ctrl+C in its terminal) and start it again with npm run server.');
      await this.refreshOnline();
    } catch (e) {
      this.onlineMessage.set((e as Error).message || "Can't reach the game server. Start it with: npm run server");
    }
  }

  /** Ends a game on the server for everyone in it, after asking. */
  async endOnline(g: OnlineGame) {
    if (!confirm(`End ${g.away} at ${g.home} (${g.id}) for everyone in it?`)) return;
    try {
      const res = await fetch(`/api/games/${g.id}`, { method: 'DELETE' });
      if (this.signedOut(res)) return;
      if (!res.ok) throw new Error((await res.json()).error);
      this.onlineMessage.set(`Ended ${g.away} at ${g.home}.`);
      const games = this.onlineGames().filter(x => x.id !== g.id);
      this.onlineGames.set(games);
    } catch (e) {
      this.onlineMessage.set((e as Error).message || "Can't reach the game server.");
    }
  }

  async joinOnline(gameId: string, seat: 'home' | 'away' | 'master') {
    try {
      await this.game.joinOnline(gameId, seat, this.coachName().trim() || 'Coach');
      this.onlineMessage.set(null);
    } catch (e) {
      this.onlineMessage.set((e as Error).message);
      await this.refreshOnline();
    }
  }

  /** The receiving team's onside-kick defense for the coming kickoff (rule O2). */
  protected readonly onsideDefense = signal(false);

  protected kick(onside: boolean, squib: boolean) {
    this.game.kickoff(onside, { squib, onsideDefense: this.onsideDefense() });
    this.onsideDefense.set(false);
  }

  private readonly router = inject(Router);

  /** The Official Game Book, ready for "Save as PDF". */
  protected report() {
    void this.router.navigateByUrl('/report');
  }

  /** A simulated game between the chosen teams. */
  async simulate() {
    this.wx.newGame();
    this.starting.set(true);
    try {
      await this.sim.simulateNew(this.homeId(), this.awayId(), this.speed()); // a normal computer coach on both sides
    } finally {
      this.starting.set(false);
    }
  }

  endGame() {
    if (confirm('End this game? The score and play-by-play will be lost.')) {
      this.sim.stop();
      this.replay.cancel();
      this.game.endGame();
    }
  }

  protected clockOf(seconds: number) {
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }
}
