import { describe, expect, it } from "vitest";
import { startCategory } from "../src/index.js";

describe("start categories", () => {
  it("bands are correct at the spec boundaries", () => {
    expect(startCategory(0.1, false)).toBe("perfect");
    expect(startCategory(0.2, false)).toBe("good");
    expect(startCategory(0.4, false)).toBe("slow");
    expect(startCategory(0.7, false)).toBe("verySlow");
  });

  it("jumpStart takes precedence", () => {
    expect(startCategory(0.1, true)).toBe("jumpStart");
    expect(startCategory(0.0, true)).toBe("jumpStart");
  });

  it("exact band edges: [0,0.15)=perfect, [0.15,0.35)=good, [0.35,0.60)=slow, [0.60,∞)=verySlow", () => {
    expect(startCategory(0.0, false)).toBe("perfect");
    expect(startCategory(0.149, false)).toBe("perfect");
    expect(startCategory(0.15, false)).toBe("good");
    expect(startCategory(0.349, false)).toBe("good");
    expect(startCategory(0.35, false)).toBe("slow");
    expect(startCategory(0.599, false)).toBe("slow");
    expect(startCategory(0.6, false)).toBe("verySlow");
    expect(startCategory(2.0, false)).toBe("verySlow");
  });
});
