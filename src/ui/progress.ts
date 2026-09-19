import chalk from "chalk";
import CliProgress from "cli-progress";
import { getFlags } from "../lib/logger.js";

export interface Bar {
  tick: (n?: number, detail?: string) => void;
  update: (n: number, detail?: string) => void;
  stop: () => void;
}

const noop: Bar = {
  tick: (_n?: number, _d?: string) => {},
  stop: () => {},
  update: (_n: number, _d?: string) => {},
};

function fmtEta(ms: number): string {
  if (!isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return "<1s";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Brand-styled progress bar with rate, ETA and an optional detail token. */
export function progressBar(total: number, label: string, unit = ""): Bar {
  if (getFlags().json || getFlags().quiet || process.env.CI) return noop;
  const head = chalk.hex("#7757F7")(label);
  const bar = new CliProgress.SingleBar(
    {
      format: `  ${head} |${chalk.hex("#D07BFA")("{bar}")}| {percentage}% | {value}/{total}${unit ? ` ${unit}` : ""} · {rate} · ETA {eta} {detail}`,
      hideCursor: true,
      barCompleteChar: "█",
      barIncompleteChar: "░",
    },
    CliProgress.Presets.shades_grey,
  );
  const t0 = Date.now();
  const payload = (done: number, detail?: string) => {
    const elapsed = Math.max(Date.now() - t0, 1);
    const rate = (done / (elapsed / 1000));
    const remaining = total - done;
    const eta = rate > 0 ? (remaining / rate) * 1000 : Infinity;
    return {
      rate: `${rate < 10 ? rate.toFixed(1) : Math.round(rate)}${unit ? ` ${unit}` : ""}/s`,
      eta: done >= total ? "0s" : fmtEta(eta),
      detail: detail ?? "",
    };
  };
  bar.start(total, 0, payload(0));
  let done = 0;
  return {
    tick: (n = 1, detail?: string) => {
      done = Math.min(total, done + n);
      bar.increment(n, payload(done, detail));
    },
    update: (n: number, detail?: string) => {
      done = Math.min(total, n);
      bar.update(n, payload(done, detail));
    },
    stop: () => bar.stop(),
  };
}

export async function simulateProgress(label: string, ms = 1200, stepsCount = 20) {
  const bar = progressBar(stepsCount, label);
  for (let i = 0; i < stepsCount; i++) {
    await new Promise((r) => setTimeout(r, ms / stepsCount));
    bar.tick();
  }
  bar.stop();
}
