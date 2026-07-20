/** Mulberry32 seeded PRNG */
export class SeededRng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  d20(): number {
    return 1 + Math.floor(this.next() * 20);
  }

  rollDice(count: number, sides: number): number {
    return this.rollDiceDetail(count, sides).total;
  }

  /** Individual die faces + sum (before flat bonuses). */
  rollDiceDetail(count: number, sides: number): { rolls: number[]; total: number } {
    const rolls: number[] = [];
    for (let i = 0; i < count; i++) {
      rolls.push(1 + Math.floor(this.next() * sides));
    }
    return { rolls, total: rolls.reduce((a, b) => a + b, 0) };
  }
}
