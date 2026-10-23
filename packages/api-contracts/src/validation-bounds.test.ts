import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { rewardRunPrepareRequestSchema } from "./reward-runs.js";

describe("collection validation bounds", () => {
  it("rejects oversized requests with a bounded error instead of walking every invalid entry", () => {
    const result = rewardRunPrepareRequestSchema.safeParse({
      cycle: 142,
      distribution: 1,
      operations: Array(1_000).fill("not-an-operation"),
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Expected rejection");
    expect(result.error.issues).toEqual([
      expect.objectContaining({ code: "too_big", path: ["operations"], maximum: 5 }),
    ]);
    expect(
      rewardRunPrepareRequestSchema.safeParse({
        cycle: 142,
        distribution: 1,
        operations: ["calculate-rewards"],
      }).success,
    ).toBe(true);
    expect(
      rewardRunPrepareRequestSchema.safeParse({
        cycle: 142,
        distribution: 1,
        operations: ["not-an-operation"],
      }).success,
    ).toBe(false);
  });

  it("checks array, set and map sizes before element refinements", () => {
    const refine = vi.fn(() => false);
    const item = z.number().refine(refine);
    const values = Array.from({ length: 1_000 }, (_, index) => index);
    const cases = [
      z.array(item).max(5).safeParse(values),
      z.set(item).max(5).safeParse(new Set(values)),
      z
        .map(z.number(), item)
        .max(5)
        .safeParse(new Map(values.map((value) => [value, value]))),
    ];
    for (const result of cases) {
      expect(result.success).toBe(false);
      if (result.success) throw new Error("Expected rejection");
      expect(result.error.issues).toHaveLength(1);
      expect(result.error.issues[0]?.code).toBe("too_big");
    }
    expect(refine).not.toHaveBeenCalled();
  });
});
