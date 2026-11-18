import { Component } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { DxButtonModule, DxDataGridModule } from 'devextreme-angular';
// import config from 'devextreme/core/config';

interface Tile {
  text: string;
  color: string;
  size: 'small' | 'large' | 'tall'; // To match your Image 6 layout
  icon?: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, DxButtonModule, DxDataGridModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  // 1. Properties needed by your HTML template
  title = 'Statis Pro Football';

  // Defining the dashboard tiles based on your image
  dashboardTiles: Tile[] = [
    { text: 'Offense', color: '#4A76B2', size: 'small' },
    { text: 'Defense', color: '#32A3A3', size: 'small' },
    { text: 'Game', color: '#9E9E9E', size: 'large' },
    { text: 'Stats', color: '#B388FF', size: 'large' },
    { text: 'Play by play', color: '#D260E1', size: 'large' },
    { text: 'Data', color: '#F28B82', size: 'large' }
  ];

  quickStats = [
    { player: 'P. Mahomes', pos: 'QB', status: 'Active' },
    { player: 'T. Kelce', pos: 'TE', status: 'Active' },
    { player: 'I. Pacheco', pos: 'RB', status: 'Questionable' }
  ];

  constructor(public router: Router) { }

  // 3. Functions needed by your HTML clicks
  onStartGame() {
    alert("Kicking off the season!");
  }

  onJoinGame() {
    alert("Searching for local lobby...");
  }

  helloWorld() {
    alert("DevExpress is alive and licensed!");
  }

  //   onTileClick(tile: Tile) {
  //   console.log(`Navigating to: ${tile.text}`);
  //   // This is where your Router.navigate will eventually go!
  // }

  onTileClick(tile: any) {
    if (tile.text === 'Offense') {
      this.router.navigate(['/offense']); // This changes the URL to /offense
    }
  }
}