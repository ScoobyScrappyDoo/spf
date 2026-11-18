import { describe, expect, it } from 'vitest';
import { passerRating } from './index';

describe('passer rating', () => {
  it("Tony Eason's 7 of 9, 65 yards, 1 TD, 2 interceptions", () => {
    expect(passerRating({ comp: 7, att: 9, yards: 65, td: 1, interceptions: 2 }).toFixed(2)).toBe('94.21');
  });

  it('a perfect game is 158.33, no attempts is 0', () => {
    expect(passerRating({ comp: 20, att: 20, yards: 400, td: 5, interceptions: 0 }).toFixed(2)).toBe('158.33');
    expect(passerRating({ comp: 0, att: 0, yards: 0, td: 0, interceptions: 0 })).toBe(0);
  });
});
