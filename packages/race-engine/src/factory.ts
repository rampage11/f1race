import { CONFIG, SKILL_KEYS, STARTING_SKILL_POINTS } from "./config.js";
import { emptySkills, validateStartingAllocation } from "./skills.js";
import { mulberry32, type Rng } from "./rng.js";
import type {
  Driver,
  DriverKind,
  PitPlan,
  RaceConfig,
  Skills,
  Track,
  TyreCompound,
} from "./types.js";

let idCounter = 0;
export function nextDriverId(prefix = "d"): string {
  idCounter += 1;
  return `${prefix}_${idCounter.toString(36)}`;
}

export interface MakeDriverArgs {
  name: string;
  country: string;
  kind?: DriverKind;
  team?: string;
  skills: Skills;
  startingTyre: TyreCompound;
  pitPlan?: PitPlan;
  reactionTimeSec?: number;
  paceFactor?: number;
  launchFactor?: number;
  id?: string;
}

const clampPaceFactor = (v: number) => Math.max(0.975, Math.min(1.025, v));
const clampLaunchFactor = (v: number) => Math.max(0.93, Math.min(1.07, v));

export function makeDriver(args: MakeDriverArgs, rng?: Rng): Driver {
  const kind: DriverKind = args.kind ?? "human";
  const reactionTimeSec =
    args.reactionTimeSec ??
    (kind === "bot" ? (rng ?? randomRng()).gauss(0.28, 0.1) : 0.25);
  const paceFactor = args.paceFactor ?? (kind === "bot" ? clampPaceFactor((rng ?? randomRng()).gauss(1.0, 0.015)) : 1.0);
  const launchFactor = args.launchFactor ?? (kind === "bot" ? clampLaunchFactor((rng ?? randomRng()).gauss(1.0, 0.03)) : 1.0);
  return {
    id: args.id ?? nextDriverId(),
    name: args.name,
    country: args.country,
    kind,
    team: args.team ?? "Academy",
    skills: args.skills,
    startingTyre: args.startingTyre,
    pitPlan:
      args.pitPlan ?? {
        targetStops: 1,
        strategy: "flexible",
        compound: args.startingTyre === "soft" ? "medium" : args.startingTyre === "medium" ? "soft" : "medium",
      },
    reactionTimeSec: Math.max(0.01, reactionTimeSec),
    paceFactor,
    launchFactor,
  };
}

const FIRST_NAMES = [
  "Max", "Lewis", "Charles", "Lando", "Carlos", "George", "Fernando", "Pierre",
  "Esteban", "Yuki", "Valtteri", "Sergio", "Oscar", "Alex", "Lance", "Nico",
  "Kevin", "Zhou", "Logan", "Daniel",
];
const LAST_NAMES = [
  "Verstappen", "Hamilton", "Leclerc", "Norris", "Sainz", "Russell", "Alonso",
  "Gasly", "Ocon", "Tsunoda", "Bottas", "Perez", "Piastri", "Albon", "Stroll",
  "Hulkenberg", "Magnussen", "Guanyu", "Sargeant", "Ricciardo",
];
const COUNTRIES = ["NL", "GB", "MC", "ES", "FR", "JP", "FI", "MX", "AU", "TH", "CA", "DE", "DK", "CN", "US"];
const TEAMS = ["Red Bull", "Ferrari", "Mercedes", "McLaren", "Aston Martin", "Alpine", "Williams", "AlphaTauri", "Sauber", "Haas"];
const COMPOUNDS: TyreCompound[] = ["soft", "medium", "hard"];

export function randomRng(): Rng {
  return mulberry32(Date.now() >>> 0);
}

export function makeBot(args: Partial<MakeDriverArgs>, rng: Rng): Driver {
  const extraPoints = Math.round(rng.range(0, 5));
  const skills: Skills = { ...emptySkills() };
  let remaining = STARTING_SKILL_POINTS + extraPoints;
  while (remaining > 0) {
    const k = rng.pick(SKILL_KEYS);
    if (skills[k] < CONFIG.skills.absoluteMax) {
      skills[k] += 1;
      remaining--;
    }
  }
  const first = args.name?.split(" ")[0] ?? rng.pick(FIRST_NAMES);
  const last = args.name?.split(" ")[1] ?? rng.pick(LAST_NAMES);
  const startingTyre = args.startingTyre ?? rng.pick(COMPOUNDS);
  const pitOptions = COMPOUNDS.filter((c) => c !== startingTyre);
  const pitCompound = rng.pick(pitOptions);
  return makeDriver(
    {
      name: `${first} ${last}`,
      country: args.country ?? rng.pick(COUNTRIES),
      kind: "bot",
      team: args.team ?? rng.pick(TEAMS),
      skills,
      startingTyre,
      pitPlan: { targetStops: 1, strategy: "flexible", compound: pitCompound },
    },
    rng,
  );
}

export function makeRandomBot(rng: Rng): Driver {
  return makeBot({}, rng);
}

export function buildRaceConfig(args: {
  track: Track;
  drivers: Driver[];
  totalLaps: number;
  seed?: number;
  dt?: number;
  heroId?: string;
}): RaceConfig {
  const cfg: RaceConfig = {
    track: args.track,
    drivers: args.drivers,
    totalLaps: args.totalLaps,
    seed: args.seed ?? (Date.now() >>> 0),
    dt: args.dt ?? CONFIG.physics.dtDefault,
  };
  if (args.heroId) cfg.heroId = args.heroId;
  return cfg;
}

export { validateStartingAllocation };
