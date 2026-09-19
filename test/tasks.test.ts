import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runTasks } from "../src/ui/tasks.js";
import { setGlobalFlags } from "../src/lib/logger.js";

const OLD_ENV = { ...process.env };

beforeEach(() => {
  setGlobalFlags({ json: true }); // silent renderer: pure logic
  delete process.env.CI;
});

afterEach(() => {
  process.env = { ...OLD_ENV };
  setGlobalFlags({});
});

describe("tasks", () => {
  it("runs tasks in order and returns ctx", async () => {
    const order: string[] = [];
    const ctx = await runTasks([
      { title: "one", run: async (c) => { order.push("one"); c.a = 1; } },
      { title: "two", run: async (c) => { order.push("two"); c.b = (c.a as number) + 1; } },
    ]);
    expect(order).toEqual(["one", "two"]);
    expect(ctx).toMatchObject({ a: 1, b: 2 });
  });

  it("propagates task failure", async () => {
    await expect(
      runTasks([
        { title: "ok", run: async () => {} },
        { title: "boom", run: async () => { throw new Error("kaput"); } },
      ]),
    ).rejects.toThrow("kaput");
  });

  it("supports skip and dynamic titles", async () => {
    const ctx = await runTasks([
      { title: "skipped", skip: () => true, run: async (c) => { c.skippedRan = true; } },
      {
        title: "dynamic",
        run: async (c, task) => {
          task.title = "dynamic — done";
          task.output = "detail line";
          c.dynamicRan = true;
        },
      },
    ]);
    expect(ctx.skippedRan).toBeUndefined(); // skipped task never ran
    expect(ctx.dynamicRan).toBe(true);
  });
});
