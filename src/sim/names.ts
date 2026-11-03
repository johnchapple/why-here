// Procedural place names in an Anglo-ish atlas style. Suffixes are chosen
// from the site, so a town at a ford tends to be called "...ford".
import { Rng } from './rng';

const ROOTS = [
  'Ash', 'Brack', 'Elm', 'Wen', 'Thorn', 'Har', 'Kel', 'Mar', 'Ald', 'Bel', 'Cor', 'Dun', 'Fal',
  'Gor', 'Hol', 'Lin', 'Mel', 'Nor', 'Os', 'Pen', 'Ral', 'Sel', 'Tal', 'Ul', 'Ven', 'Wyn', 'Yar',
  'Bram', 'Cal', 'Dor', 'Eld', 'Fen', 'Gil', 'Hal', 'Ive', 'Lan', 'Mor', 'Ned', 'Ort', 'Pell',
  'Quen', 'Rook', 'Sax', 'Tor', 'Wil', 'Aber', 'Bur', 'Cran', 'Dray', 'Ever', 'Frost', 'Glen',
  'Hart', 'Ivy', 'Kings', 'Lyn', 'Marl', 'Oak', 'Pres', 'Red', 'Stan', 'Tew', 'Wex', 'Ather',
  'Bark', 'Chel', 'Dal', 'Esk', 'Gar', 'Hum', 'Ket', 'Lud', 'Mal', 'Nant', 'Ox', 'Pol', 'Rye',
  'Sut', 'Tam', 'Upp', 'Wal', 'Whit', 'Black', 'Stoke', 'Wick', 'Brad', 'Cars', 'Durn', 'Easter',
];
const MIDS = ['', '', '', 'er', 'in', 'an', 'el', 'en', 'ing', 's', 'ley'];
const PLAIN = ['ton', 'ham', 'by', 'ley', 'worth', 'wick', 'stead', 'field', 'thorpe', 'bury', 'well', 'combe', 'hurst', 'ington', 'dale'];

export type NameHint = 'ford' | 'bridge' | 'confluence' | 'port' | 'fall' | 'mine' | 'fort' | 'pass' | 'lake' | 'plain' | 'market' | 'junction';

const HINT_SUFFIX: Record<NameHint, string[]> = {
  ford: ['ford', 'ford', 'ford'],
  bridge: ['bridge', 'bridge', 'brigg'],
  confluence: ['mouth', 'meet', 'water', 'wath'],
  port: ['haven', 'port', 'mouth', 'quay'],
  fall: [' Falls', 'fall', 'weir', ' Rapids'],
  mine: [' Mines', 'pit', 'ore', 'delve'],
  fort: ['burgh', 'castle', 'don', 'chester', 'caster'],
  pass: [' Gap', 'gate', ' Pass', 'yat'],
  lake: ['mere', 'lake', 'pool', 'water'],
  plain: PLAIN,
  market: ['market', 'chepstow', 'cheap', 'ton', 'ham', 'bury'],
  junction: [' Junction', 'cross', 'ton'],
};

export class NameGen {
  private used = new Set<string>();
  constructor(private rng: Rng) {}

  private root(): string {
    const r = this.rng;
    const a = ROOTS[Math.floor(r() * ROOTS.length)];
    const m = MIDS[Math.floor(r() * MIDS.length)];
    return a + m;
  }

  place(hint: NameHint = 'plain'): string {
    for (let tries = 0; tries < 40; tries++) {
      const sfx = HINT_SUFFIX[hint];
      const s = sfx[Math.floor(this.rng() * sfx.length)];
      let name: string;
      if (hint === 'port' && this.rng() < 0.25) name = 'Port ' + this.root();
      else {
        let root = this.root();
        if (!s.startsWith(' ') && /[aeiouy]$/i.test(root) && /^[aeiouy]/i.test(s)) root = root.slice(0, -1);
        name = root + s;
      }
      name = name.charAt(0).toUpperCase() + name.slice(1);
      if (!this.used.has(name)) { this.used.add(name); return name; }
    }
    const n = this.root() + 'ton ' + (this.used.size + 1);
    this.used.add(n);
    return n;
  }

  river(): string {
    const RIV = ['Wend', 'Avon', 'Tarn', 'Isel', 'Mere', 'Dour', 'Lune', 'Esk', 'Teme', 'Ouse', 'Wyre', 'Calder',
      'Nene', 'Fowey', 'Brent', 'Colne', 'Swale', 'Aire', 'Ribble', 'Kennet', 'Orrin', 'Sorra', 'Velde', 'Amber'];
    for (let tries = 0; tries < 50; tries++) {
      const n = RIV[Math.floor(this.rng() * RIV.length)];
      if (!this.used.has('R:' + n)) { this.used.add('R:' + n); return n; }
    }
    return this.root();
  }
}
