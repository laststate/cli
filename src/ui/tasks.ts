import { Listr } from "listr2";
import { getFlags, isJson } from "../lib/logger.js";

export interface TaskHandle {
  title: string;
  output: string;
}

export interface TaskDef {
  title: string;
  run: (ctx: Record<string, unknown>, task: TaskHandle) => Promise<void>;
  skip?: () => boolean | string;
  enabled?: () => boolean;
}

function visual(): boolean {
  return !isJson() && !process.env.CI && !getFlags().quiet;
}

/**
 * Live multi-step checklist (listr2). Sequential by default; dynamic
 * titles/output via the task handle. Falls back to static lines without
 * a TTY and to silence under --json/--quiet/CI.
 */
export async function runTasks(
  tasks: TaskDef[],
  opts: { concurrent?: boolean } = {},
): Promise<Record<string, unknown>> {
  // listr2 types `renderer` as a narrow generic; all three values are valid at runtime.
  const renderer = (!visual() ? "silent" : process.stdout.isTTY ? "default" : "simple") as "default";
  const listr = new Listr<Record<string, unknown>>(
    tasks.map((t) => ({
      title: t.title,
      skip: t.skip,
      enabled: t.enabled,
      task: async (ctx, task) => {
        await t.run(ctx, task as unknown as TaskHandle);
      },
    })),
    {
      concurrent: opts.concurrent ?? false,
      exitOnError: true,
      renderer,
      rendererOptions: { collapseErrors: false },
    },
  );
  return listr.run();
}
