/**
 * Settings for the whole game, in one place. Later an admin page can change these; for now, edit this file.
 */
export type TeamNameMode = 'city' | 'full';

export const SETTINGS = {
  /** Shown in the browser tab and on the dashboard. */
  gameName: 'Statistical Football',

  /** House rules, fixed for each game when it starts (a saved game keeps the ones it was played with). */
  houseRules: {
    /**
     * The no-huddle offense at any time, Brady style: the fast timing of the two-minute offense, and the defense can't
     * substitute while the offense keeps its players and the clock runs (rule 8.7). Without it, only in the final minutes.
     */
    noHuddleAnyTime: true,
  },

  /**
   * How teams are named. 'city': "New England", "Miami" (no club nicknames; safe for anything shared).
   * 'full': "New England Patriots", as on the cards (for private games at home).
   */
  teamNames: 'city' as TeamNameMode,

  /** Two teams from the same city in one season are told apart like this: "New York (A)", "New York (N)". */
  conferenceTags: { AFC: 'A', NFC: 'N' } as Record<string, string>,

  /** Conference names in the team pickers, in city mode: "Conference A – East". */
  conferenceNames: { AFC: 'Conference A', NFC: 'Conference N' } as Record<string, string>,

  /** Your own name for a particular team, by its id, e.g. { '1984-giants': 'New York Blue' }. Wins over the rules above. */
  teamOverrides: {} as Record<string, string>,
};
