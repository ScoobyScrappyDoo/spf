import { DefenseCallStore } from './state/defense-call.store';
import { OffenseCallStore } from './state/offense-call.store';
import { SolitaireService } from './state/solitaire.service';
import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class App {
  // The coaches' stores live from the start (not from their page's first visit): online, they show the other coach
  // the formation as it changes, whichever page is open.
  private readonly offenseCall = inject(OffenseCallStore);
  private readonly defenseCall = inject(DefenseCallStore);
  // Solitaire: the computer coach, ready to play one side whenever a game says so.
  private readonly solitaire = inject(SolitaireService);
}
