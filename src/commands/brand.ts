import { logoStatic, brandAssetPath, BRAND_STOPS } from "../ui/brand.js";
import { emitJson, isJson, log } from "../lib/logger.js";
import { header } from "../ui/banner.js";

/** `laststate brand` — shows the ASCII logo. */
export async function brand() {
  if (isJson()) {
    emitJson({
      ok: true,
      wordmark: "LastState",
      tagline: "Latch → LEP → Relay → Trace",
      gradient: [...BRAND_STOPS],
      assets: {
        svg: brandAssetPath("brand.svg"),
        png: brandAssetPath("brand.png"),
        gif: brandAssetPath("brand.gif"),
      },
    });
    return;
  }
  header("Brand");
  console.log(logoStatic());
  log.dim(`Gradient: ${BRAND_STOPS.join(" → ")}`);
  console.log("");
}

/** Back-compat: some scripts may call the old sync splash. */
export function brandStatic(): string {
  return logoStatic();
}
