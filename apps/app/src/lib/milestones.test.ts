import { describe, expect, test } from "bun:test";
import { milestoneStates, pendingMilestone } from "./milestones.ts";

describe("milestones", () => {
  test("states by arc day", () => {
    expect(milestoneStates({ day: 30, status: "active" }).map((s) => s.reached)).toEqual([true, true, false, false, false]);
    expect(milestoneStates({ day: 0, status: "upcoming" }).some((s) => s.reached)).toBe(false);
  });

  test("nothing before day 7", () => {
    expect(pendingMilestone({ day: 6, status: "active" }, [])).toBeNull();
  });

  test("first time on day 7", () => {
    expect(pendingMilestone({ day: 7, status: "active" }, [])).toEqual({ day: 7, alsoMark: [7] });
    expect(pendingMilestone({ day: 8, status: "active" }, [7])).toBeNull();
  });

  test("late opener gets only the highest one", () => {
    expect(pendingMilestone({ day: 52, status: "active" }, [7])).toEqual({ day: 50, alsoMark: [30, 50] });
  });

  test("finished arc celebrates 92", () => {
    expect(pendingMilestone({ day: 92, status: "finished" }, [7, 30, 50, 75])).toEqual({ day: 92, alsoMark: [92] });
  });
});
