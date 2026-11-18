export interface Player {
  id: string; // Add ID to the base
  name: string;
  surname: string;
  position: string;
  isStarter: boolean;
  // Optional fields (using ?) so JSON doesn't complain if they are missing
  playsForTeam?: string;
  year?: string;
  jersey?: string;
}

export interface SkillPlayer extends Player {
  blockRun: number; // Use this for Irving Fryar's -3
  rushingGains?: { [roll: number]: string }; 
  passingGains?: { [roll: number]: string };
}

export interface QB extends Player {
  endurance: string;
  passQuick: { com: string; inc: string; int: string };
  passShort: { com: string; inc: string; int: string };
  passLong: { com: string; inc: string; int: string };
  rushingGains?: { [roll: number]: string }; 
  passRush: {
    sack: { min: number; max: number };
    runs: { min: number; max: number };
    com:  { min: number; max: number };
    inc:  { min: number; max: number };
  };
}

export type PlayerCard = QB | SkillPlayer;