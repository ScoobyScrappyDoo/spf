export enum FormationNameOffense {
  ucRun3rb2te = 'Run: 3 RB, 2 TE',
  ucRun3rbTeLeft = 'Run: 3 RB, TE Left',
  ucRun3rbTeRight = 'Run: 3 RB, TE Right',
  ucPass3WrTeLeft = 'Pass: 3 WR, TE Left',
  ucPass3WrTeRight = 'Pass: 3 WR, TE Right',
  ucPass2Wr2Te = 'Pass: 2 WR, 2 TE',
  uc2Rb2WrTeLeft = '2 RB, 2 WR, TE Left',
  uc2Rb2WrTeRight = '2 RB, 2 WR, TE Right',
  uc2Rb2TeFlLeft = '2 RB, 2 TE, FL Left',
  uc2Rb2TeFlRight = '2 RB, 2 TE, FL Right',
  ucPass4Wr = 'Pass: 4 WR'
}

export interface OffenseBoardState {
  HasSEL: boolean; HasTEL: boolean; HasFLL: boolean;
  HasSER: boolean; HasTER: boolean; HasFLR: boolean;
  HasRB1: boolean; HasRB2: boolean; HasRB3: boolean;
}

export const DEFAULT_OFFENSE_STATE: OffenseBoardState = {
  HasSEL: false, 
  HasTEL: true,  // Defaulting to a standard 2TE look
  HasFLL: false,
  HasSER: false, 
  HasTER: true, 
  HasFLR: false,
  HasRB1: true,  
  HasRB2: true,  // Defaulting to 2RB
  HasRB3: true
};