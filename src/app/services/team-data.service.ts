import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { PlayerCard } from '../models/cards/player.model';

@Injectable({
    providedIn: 'root'
})
export class TeamDataService {
    private http = inject(HttpClient);

    // This signal holds the current active team roster (could be Offense + Defense)
    private currentRosterSignal = signal<PlayerCard[]>([]);
    public currentRoster = this.currentRosterSignal.asReadonly();

    /**
     * Fetches a specific team's JSON from the assets folder.
     * Example: loadTeam('patriots', '1984')
     */
    loadTeam(teamName: string, year: string): void {
        const path = `assets/data/teams/${year}/${teamName}.json`;

        this.http.get<PlayerCard[]>(path).subscribe({
            next: (data) => {
                this.currentRosterSignal.set(data);
                console.log(`${year} ${teamName} loaded.`, data);
            },
            error: (err) => console.error(`Could not find team at ${path}`, err)
        });
    }

    /**
     * Returns a player by ID from the currently loaded roster.
     */
    getPlayerFromRoster(playerId: string): PlayerCard | undefined {
        return this.currentRoster().find(p => p.id === playerId);
    }

    getPlayerById(playerId: string): PlayerCard | undefined {
        // 1. Get the current value of the signal: currentRoster()
        // 2. Use the JS .find() method (exactly like C# LINQ .find)
        return this.currentRoster().find(player => player.id === playerId);
    }
}