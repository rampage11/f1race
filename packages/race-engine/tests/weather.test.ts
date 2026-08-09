import { describe, expect, it } from "vitest";
import { gripFor, freshTyre, wearDeltaForLap, paceSpeedMultiplier } from "../src/index.js";

describe("weather — grip & wear", () => {
  it("gripFor penalises dry compounds progressively in rain", () => {
    const dry = gripFor(freshTyre("soft"), "dry");
    const light = gripFor(freshTyre("soft"), "lightRain");
    const heavy = gripFor(freshTyre("soft"), "heavyRain");
    expect(light).toBeLessThan(dry);
    expect(heavy).toBeLessThan(light);
  });

  it("wearDeltaForLap wears dry compounds faster in rain", () => {
    const dry = wearDeltaForLap(freshTyre("medium"), 5, 0, "dry");
    const light = wearDeltaForLap(freshTyre("medium"), 5, 0, "lightRain");
    const heavy = wearDeltaForLap(freshTyre("medium"), 5, 0, "heavyRain");
    expect(light).toBeGreaterThan(dry);
    expect(heavy).toBeGreaterThan(light);
  });

  it("default weather (omitted) equals dry", () => {
    expect(gripFor(freshTyre("soft"))).toBeCloseTo(gripFor(freshTyre("soft"), "dry"), 7);
    expect(wearDeltaForLap(freshTyre("hard"), 5, 2)).toBeCloseTo(
      wearDeltaForLap(freshTyre("hard"), 5, 2, "dry"),
      7,
    );
  });

  it("intermediate/wet wear LESS in rain (and more in dry)", () => {
    const wetDry = wearDeltaForLap(freshTyre("wet"), 5, 0, "dry");
    const wetHeavy = wearDeltaForLap(freshTyre("wet"), 5, 0, "heavyRain");
    expect(wetHeavy).toBeLessThan(wetDry);
    const intLight = wearDeltaForLap(freshTyre("intermediate"), 5, 0, "lightRain");
    const intDry = wearDeltaForLap(freshTyre("intermediate"), 5, 0, "dry");
    expect(intLight).toBeLessThan(intDry);
  });
});

describe("weather — compound advantage", () => {
  const base = {
    paceSkill: 0,
    fitnessSkill: 10,
    fatigue01: 0,
    pushLevel: 1,
    t0: 63,
    noise: 0,
  };

  it("a wet race on dry tyres has lower grip than in the dry", () => {
    expect(gripFor(freshTyre("soft"), "heavyRain")).toBeLessThan(gripFor(freshTyre("soft"), "dry"));
  });

  it("wet tyres in heavy rain have higher grip AND higher pace than soft", () => {
    expect(gripFor(freshTyre("wet"), "heavyRain")).toBeGreaterThan(
      gripFor(freshTyre("soft"), "heavyRain"),
    );
    const wetPace = paceSpeedMultiplier({ ...base, tyre: freshTyre("wet"), weather: "heavyRain" });
    const softPace = paceSpeedMultiplier({ ...base, tyre: freshTyre("soft"), weather: "heavyRain" });
    expect(wetPace).toBeGreaterThan(softPace);
  });

  it("in the dry, softs are still faster than wets", () => {
    const softPace = paceSpeedMultiplier({ ...base, tyre: freshTyre("soft"), weather: "dry" });
    const wetPace = paceSpeedMultiplier({ ...base, tyre: freshTyre("wet"), weather: "dry" });
    expect(softPace).toBeGreaterThan(wetPace);
  });
});
