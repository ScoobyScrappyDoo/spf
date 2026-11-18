import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SkillPlayer } from '../../../models/cards/player.model';

@Component({
  selector: 'app-skillplayer-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './skillPlayer-card.component.html',
  styleUrl: './skillPlayer-card.component.scss'
})
export class SkillPlayerCardComponent {
  // This is your Dependency Property equivalent
  @Input({ required: true }) player!: SkillPlayer;
}