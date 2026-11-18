import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { DxButtonModule, DxTabPanelModule, DxListModule } from 'devextreme-angular';
import { FormationNameOffense, OffenseBoardState } from '../../models/offense-formation.model';
import { TeamDataService } from '../../services/team-data.service';
import {QbCardComponent} from '../../components/cards/offense/qb-card.component';
import { QB, SkillPlayer, PlayerCard } from '../../models/cards/player.model';
import { SkillPlayerCardComponent } from "../../components/cards/offense/skillPlayer-card.component";
// import { Injectable, inject, signal } from '@angular/core';
// import { DEFAULT_OFFENSE_STATE } from '../../models/offense-formation.model';

@Component({
  selector: 'app-offense-selection',
  standalone: true,
  imports: [CommonModule, DxButtonModule, DxTabPanelModule, DxListModule, QbCardComponent, SkillPlayerCardComponent],
  templateUrl: './offense-selection.component.html',
  styleUrl: './offense-selection.component.scss'
})
export class OffenseSelectionComponent implements OnInit {
  private teamService = inject(TeamDataService);

  viewTitle = 'Offense Selection';
  selectedPlayer: any = null;

  constructor(private router: Router) { }

  // This is your Type Guard
  isQB(player: PlayerCard | null): player is QB {
    return player?.position === 'QB';
  }

  isSkillPlayer(player: PlayerCard | null): player is SkillPlayer {
    const skillPositions = ['RB', 'WR', 'TE'];
    return skillPositions.includes(player?.position || '');
  }

  // Create the initial clone of the ucRun3rb"te formation to stop glitching
  //  offenseState = signal<OffenseBoardState>(DEFAULT_OFFENSE_STATE);
  offenseState = signal<OffenseBoardState>({
    HasSEL: false,
    HasTEL: true,  // Default Run Formation
    HasFLL: false,
    HasSER: false,
    HasTER: true,
    HasFLR: false,
    HasRB1: true,
    HasRB2: true,
    HasRB3: true
  });

  ngOnInit() {
    // TRIGGER THE DEFAULT: 
    // This ensures image 2 shows a valid 11-man formation on load
    this.changeSelectedFormation(FormationNameOffense.ucRun3rb2te);

    this.teamService.loadTeam('patriots', '1984');
  }

  getOffenseOnly() {
    return this.teamService.currentRoster().filter(p =>
      ['QB', 'RB', 'WR', 'TE', 'OL'].includes(p.position)
    );
  }

  // Helper for the HTML
  getPlayerName(slotId: string): string {
    const player = this.teamService.getPlayerById(slotId);
    return player ? `${player.name} ${player.surname}` : slotId;
  }

  // Data source for your Tab/List selection
  formationOptions = Object.values(FormationNameOffense);

  coachTabs = [
    { id: 'formation', text: 'Formation', isDirty: false },
    { id: 'play', text: 'Select Play', isDirty: true }
  ];

  // Replicating your C# switch logic
  changeSelectedFormation(formation: FormationNameOffense) {
    let newState: OffenseBoardState = {
      HasSEL: false, HasTEL: false, HasFLL: false,
      HasSER: false, HasTER: false, HasFLR: false,
      HasRB1: true, HasRB2: false, HasRB3: false
    };

    switch (formation) {
      case FormationNameOffense.ucRun3rb2te:
        newState = { ...newState, HasRB2: true, HasRB3: true, HasTEL: true, HasTER: true };
        break;
      case FormationNameOffense.ucRun3rbTeLeft:
        newState = { ...newState, HasRB2: true, HasRB3: true, HasSER: true, HasTEL: true };
        break;
      case FormationNameOffense.ucRun3rbTeRight:
        newState = { ...newState, HasRB2: true, HasRB3: true, HasSEL: true, HasTER: true };
        break;
      case FormationNameOffense.ucPass4Wr:
        newState = { ...newState, HasSEL: true, HasSER: true, HasFLL: true, HasFLR: true };
        break;
      case FormationNameOffense.ucPass3WrTeLeft:
        newState = { ...newState, HasTEL: true, HasSER: true, HasFLR: true, HasFLL: true };
        break;
      case FormationNameOffense.ucPass3WrTeRight:
        newState = { ...newState, HasTER: true, HasSEL: true, HasFLL: true, HasFLR: true };
        break;
      case FormationNameOffense.ucPass2Wr2Te:
        newState = { ...newState, HasTER: true, HasTEL: true, HasFLL: true, HasFLR: true };
        break;
      case FormationNameOffense.uc2Rb2WrTeLeft:
        newState = { ...newState, HasRB2: true, HasTEL: true, HasSER: true, HasFLL: true };
        break;
      case FormationNameOffense.uc2Rb2WrTeRight:
        newState = { ...newState, HasRB2: true, HasTER: true, HasSEL: true, HasFLR: true };
        break;
      case FormationNameOffense.uc2Rb2TeFlLeft:
        newState = { ...newState, HasRB2: true, HasTEL: true, HasTER: true, HasFLL: true };
        break;
      case FormationNameOffense.uc2Rb2TeFlRight:
        newState = { ...newState, HasRB2: true, HasTEL: true, HasTER: true, HasFLR: true };
        break;
    }

    this.offenseState.set(newState);
  }

  // // FIXED: Restored the click handler for the Stat Card
  // onPlayerClick(role: string) {
  //   this.selectedPlayer = {
  //     name: role === 'QB' ? 'Tony Eason' : 'Patriots Player',
  //     role: role,
  //     team: '1984 New England Patriots'
  //   };
  // }

  onPlayerClick(slotId: string) {
    const player = this.teamService.getPlayerById(slotId);
    if (player) {
      this.selectedPlayer = player;
    }
  }

  onReplacePlayer() {
    console.log(`Placeholder: Replace logic for ${this.selectedPlayer.role}`);
    // We can implement the "Swap Players" logic here later
  }

  goHome() { this.router.navigate(['/']) };
}