import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { QB } from '../../../models/cards/player.model';
import { DxLinearGaugeModule } from 'devextreme-angular';

@Component({
  selector: 'app-qb-card',
  standalone: true,
  imports: [CommonModule, DxLinearGaugeModule],
  templateUrl: './qb-card.component.html',
  styleUrl: './qb-card.component.scss'
})
export class QbCardComponent {
  // This is your Dependency Property equivalent
  @Input({ required: true }) player!: QB;
}