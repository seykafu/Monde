// Monde's clock: the calendar (GDD §3.2), the day (§5.2) and time (§5.3).
//
// Pure: no Phaser, no DOM, so it runs under vitest in Node. Scenes own a
// Clock, feed it real milliseconds with advance(), and pause it for dialogue,
// menus, puzzles, riddles and Scuffles (§5.3: walking never stops time).
//
// Minutes are counted from midnight of the current game day and run past 24:00:
// the day is 06:00 → 26:00 (360 → 1560), and 26:00 is 02:00 the next morning,
// when the player passes out (§5.2).

export type Weekday = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export const WEEKDAYS: readonly Weekday[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const SEASONS: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'];
export const SEASON_NAMES: Readonly<Record<Season, string>> = {
  spring: 'Spring', summer: 'Summer', autumn: 'Autumn', winter: 'Winter'
};

/** §3.2: four seasons of 25 days, 100 days in all. */
export const DAYS_PER_SEASON = 25;
export const DAYS_PER_YEAR = DAYS_PER_SEASON * SEASONS.length;
/** §3.2: Day 1 is a Tuesday (index into WEEKDAYS). */
const DAY_ONE_WEEKDAY = 1;

/** §5.2/§5.3: the day starts at 06:00 with the Dawn Report. */
export const DAY_START = 6 * 60;
export const MIDNIGHT = 24 * 60;
/** §5.2: at 26:00 (02:00) the player passes out. */
export const PASS_OUT = 26 * 60;
/** §5.3: 1,200 in-game minutes. */
export const DAY_SPAN = PASS_OUT - DAY_START;
/** §5.3: 0.75 s of real time per in-game minute (≈ 15 real minutes per day). */
export const MS_PER_GAME_MINUTE = 750;

export interface GameTime {
  /** 1-based game day; Day 100 is the election (§3.2). */
  day: number;
  /** Whole minutes since midnight of `day`, 360..1560. */
  minute: number;
  weekday: Weekday;
  season: Season;
  /** 1..25 */
  dayOfSeason: number;
}

const mod = (n: number, m: number): number => ((n % m) + m) % m;

export const weekdayOf = (day: number): Weekday => WEEKDAYS[mod(day - 1 + DAY_ONE_WEEKDAY, 7)]!;
/** Days past 100 wrap into a new year, so the calendar never runs off its end. */
export const seasonOf = (day: number): Season =>
  SEASONS[Math.floor(mod(day - 1, DAYS_PER_YEAR) / DAYS_PER_SEASON)]!;
export const dayOfSeason = (day: number): number => mod(day - 1, DAYS_PER_SEASON) + 1;

export const gameTime = (day: number, minute: number): GameTime => ({
  day, minute, weekday: weekdayOf(day), season: seasonOf(day), dayOfSeason: dayOfSeason(day)
});

/** "9:40"; minutes past midnight read as the small hours ("0:15", "1:59"). */
export const formatClock = (minute: number): string => {
  const m = Math.floor(minute);
  return `${Math.floor(m / 60) % 24}:${String(mod(m, 60)).padStart(2, '0')}`;
};

/** "Tue · Spring 3" */
export const formatDate = (t: Pick<GameTime, 'weekday' | 'season' | 'dayOfSeason'>): string =>
  `${t.weekday} · ${SEASON_NAMES[t.season]} ${t.dayOfSeason}`;

/** "Tue · Spring 3 · 9:40" */
export const formatGameTime = (t: GameTime): string => `${formatDate(t)} · ${formatClock(t.minute)}`;

/**
 * "9:40" → 580. Hours before 06:00 belong to the end of the game day ("1:30" → 1530),
 * and "25:30" is accepted as written. Null when unparseable.
 */
export const parseClock = (text: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 26 || min > 59) return null;
  const total = h * 60 + min;
  return total < DAY_START ? total + MIDNIGHT : Math.min(total, PASS_OUT);
};

// ── Sunrise and sunset ──────────────────────────────────────────────────────
// GDD-GAP: §6.6 prints sunrise and sunset on the Dawn Report but gives no table.
// Daylight follows one smooth wave over the 100-day year, treating Day 1 (the
// first day of spring) as the equinox: 13h20 of daylight (06:20–19:40) on Days 1
// and 51, longest on Day 26 (midsummer, 05:30–20:30), shortest on Day 76
// (midwinter, 07:10–18:50). Solar noon is fixed at 13:00.
export const SOLAR_NOON = 13 * 60;
export const EQUINOX_DAYLIGHT = 800;
export const DAYLIGHT_SWING = 100;

/** Minutes of daylight on `day`. */
export const daylightMinutes = (day: number): number =>
  EQUINOX_DAYLIGHT + DAYLIGHT_SWING * Math.sin((2 * Math.PI * (day - 1)) / DAYS_PER_YEAR);

/** Sunrise, in minutes since midnight. */
export const sunrise = (day: number): number => Math.round(SOLAR_NOON - daylightMinutes(day) / 2);
/** Sunset, in minutes since midnight. The clock's dusk event fires on this minute. */
export const sunset = (day: number): number => Math.round(SOLAR_NOON + daylightMinutes(day) / 2);

// ── The clock ───────────────────────────────────────────────────────────────

export type ClockEvent = 'minute' | 'hour' | 'dawn' | 'dusk' | 'midnight' | 'passOut';
export type ClockListener = (t: GameTime) => void;

export interface ClockOptions {
  day?: number;
  minute?: number;
  msPerMinute?: number;
  /**
   * At 26:00, roll straight into the next day at 06:00 (default). Off, the
   * clock holds at 26:00 until startNextDay() — for the night pass (M-07).
   */
  autoRollover?: boolean;
}

/** Bring (day, minute) into the day span; out-of-span minutes spill into neighbouring days. */
const normalize = (day: number, minute: number): { day: number; minute: number } => {
  let d = Math.max(1, Math.floor(day)), m = Math.floor(minute);
  while (m >= PASS_OUT) { d++; m -= DAY_SPAN; }
  while (m < DAY_START) {
    if (d <= 1) { m = DAY_START; break; }
    d--; m += DAY_SPAN;
  }
  return { day: d, minute: m };
};

export class Clock {
  readonly msPerMinute: number;
  autoRollover: boolean;
  private _day: number;
  private _minute: number;
  private carryMs = 0;
  private readonly holds = new Set<string>();
  private readonly listeners: Record<ClockEvent, Set<ClockListener>> = {
    minute: new Set(), hour: new Set(), dawn: new Set(), dusk: new Set(), midnight: new Set(), passOut: new Set()
  };

  constructor(options: ClockOptions = {}) {
    this.msPerMinute = options.msPerMinute ?? MS_PER_GAME_MINUTE;
    this.autoRollover = options.autoRollover ?? true;
    const start = normalize(options.day ?? 1, options.minute ?? DAY_START);
    this._day = start.day;
    this._minute = start.minute;
  }

  get day(): number { return this._day; }
  get minute(): number { return this._minute; }
  get time(): GameTime { return gameTime(this._day, this._minute); }
  /** The minute plus the fraction already elapsed toward the next one, for smooth animation. */
  get exactMinute(): number { return this._minute + this.carryMs / this.msPerMinute; }
  get paused(): boolean { return this.holds.size > 0; }
  /** Why the clock is held (e.g. "dialogue", "menu", "puzzle"). */
  get pauseReasons(): readonly string[] { return [...this.holds]; }

  /** Stop time for `reason`. Holds stack: time runs again once every reason has resumed. */
  pause(reason = 'manual'): void { this.holds.add(reason); }
  resume(reason = 'manual'): void { this.holds.delete(reason); }

  /** Feed real elapsed time. Returns the whole in-game minutes that passed. */
  advance(dtMs: number): number {
    if (this.paused || !(dtMs > 0)) return 0;
    this.carryMs += dtMs;
    // A hair of tolerance: 60 fps frames of 16.666… ms must add up to whole minutes.
    const minutes = Math.floor((this.carryMs + 1e-6) / this.msPerMinute);
    this.carryMs = Math.max(0, this.carryMs - minutes * this.msPerMinute);
    return this.step(minutes);
  }

  /** Run `minutes` forward (firing every event on the way), paused or not. */
  advanceMinutes(minutes: number): number {
    return this.step(Math.max(0, Math.floor(minutes)));
  }

  /** Jump without firing events (loading a save, dev keys). Out-of-span minutes spill across days. */
  setTime(day: number, minute: number): void {
    const t = normalize(day, minute);
    this._day = t.day;
    this._minute = t.minute;
    this.carryMs = 0;
  }

  /** Sleep, or the morning after passing out: the next day at 06:00. Fires minute, hour and dawn. */
  startNextDay(): void {
    this._day++;
    this._minute = DAY_START;
    this.carryMs = 0;
    this.emitFor(this._minute);
  }

  on(event: ClockEvent, listener: ClockListener): () => void {
    this.listeners[event].add(listener);
    return () => { this.listeners[event].delete(listener); };
  }
  onMinute(listener: ClockListener): () => void { return this.on('minute', listener); }
  onHour(listener: ClockListener): () => void { return this.on('hour', listener); }
  /** 06:00, the start of every day (the Dawn Report, §5.2). */
  onDawn(listener: ClockListener): () => void { return this.on('dawn', listener); }
  /** Sunset (see sunset()). */
  onDusk(listener: ClockListener): () => void { return this.on('dusk', listener); }
  onMidnight(listener: ClockListener): () => void { return this.on('midnight', listener); }
  /** 26:00 (02:00): the player passes out (§5.2). */
  on26(listener: ClockListener): () => void { return this.on('passOut', listener); }

  private step(minutes: number): number {
    let done = 0;
    for (; done < minutes; done++) {
      if (this._minute >= PASS_OUT) {
        if (!this.autoRollover) { this.carryMs = 0; break; }
        this.startNextDay();
        continue;
      }
      this._minute++;
      this.emitFor(this._minute);
    }
    return done;
  }

  private emitFor(minute: number): void {
    const fire = (event: ClockEvent) => {
      const set = this.listeners[event];
      if (set.size === 0) return;
      const t = this.time;
      for (const listener of set) listener(t);
    };
    fire('minute');
    if (minute % 60 === 0) fire('hour');
    if (minute === DAY_START) fire('dawn');
    if (minute === sunset(this._day)) fire('dusk');
    if (minute === MIDNIGHT) fire('midnight');
    if (minute === PASS_OUT) fire('passOut');
  }
}
