# LastState CLI

> **v1.2.0.** Scaffold + build + flash + test + mock + ingest + analyze + symbolicate + stack (`up/down/ps/logs/status/sim/deploy/doctor`) + brand logo in every banner.
> `test` is honest: anything it cannot verify prints `-`, never a false pass. Real validation via `protocol/test-vectors/` and `latch/hil/`.

## Installation

Requires Node 18+:

```bash
npm install -g laststate-cli
laststate --help
laststate doctor
```

Global flags on **every** command:

```text
--json --yes --verbose --quiet --no-color --no-banner --profile <name>
```

`--json` disables colors/banners/spinners and emits machine-readable JSON. `CI=true` also disables the banner.

## Brand / logo

No animation, no images: every banner shows the **ASCII logo** (truecolor Braille generated from the real pixels of `cli/assets/brand.png` — swoosh, slashes and wordmark). Brand-tone spinners and `◆` as the success mark:

```bash
laststate brand         # ASCII logo
laststate brand --json  # brand metadata for scripts
```

To regenerate the PNG from the vector: `assets/brand-source.html` + headless Edge screenshot at 2176×266.

## Quickstart (4 min)

```bash
laststate init --project-name Demo --target cortex-m --yes
cd Demo
laststate build --preset host-debug   # cmake presets + ctest
laststate mock --port 8080 &          # mock Trace/Relay
laststate test --verbose              # probes + LEP vectors
laststate ingest crash.lep --to relay --url http://localhost:8384
laststate analyze crash.lep
```

Firmware (`main.c` generated):

```c
#include <latch/latch.h>

void app_init(void) {
    static ls_config_t cfg = {
        .device_id = "demo-001",
        .firmware_version = "v1.0.0",
        .build_id = "dev-build",
    };
    ls_init(&cfg);
    /* ls_transport_register(uart_transport); -- before ls_boot() */
    ls_boot();
    ls_breadcrumb("app:init");
}
```

## Commands

### Project / firmware

| Command | What it does |
|---|---|
| `laststate init [--project-name --target esp32\|cortex-m\|riscv\|riscv64\|zephyr\|arduino\|host --lep 1\|2 --storage --relay-url --trace-url --no-git --yes]` | Wizard (clack) + scaffold `laststate.yaml`, `main.c` (correct `ls_config_t` API), `CMakeLists.patch.txt`, `partition.csv` for ESP32, best-effort `git init` |
| `laststate build [--preset --clean --jobs]` | `cmake --preset + --build + ctest` as a live checklist, preset suggested from `target` |
| `laststate flash [--port --baud --no-monitor]` | `idf.py flash` (esp32) / `west flash` (zephyr) / `openocd` (cortex-m), confirms port |
| `laststate test [--verbose --filter --vectors-path]` | `✓/✗/-`: yaml schema, latch includes, `transport_register`+`ls_boot` grep, `protocol/test-vectors` (valid must pass, invalid must reject), spool/HIL as `-` |
| `laststate ingest|send [file\|dir] [--to relay\|trace --url --token]` | `POST octet-stream` with rate/ETA bar, `201/200+X-Event-ID` (relay) / `202` (trace), dev-token warning |
| `laststate analyze <file\|dir> [--output-format json\|text]` | 24B header, `header_crc`+`payload_crc` (CRC32), TLVs `1..22/0x20/0x30/0x8000`, deframing `raw|latch-stream|cobs|len-prefix`, accepts `.hex` |
| `laststate symbolicate upload-artifact <elf> / resolve <addr...> --elf <elf>` | `POST /v1/artifacts` or local `llvm-symbolizer/addr2line` (checks `build_id`) |

### Mock / stack / deploy

| Command | What it does |
|---|---|
| `laststate mock [--port --host --require-auth --token --no-cors]` | Mirrors the real thing: `POST /v1/ingest→201/200`, `POST /v1/events→202`, `POST /v1/events:batch`, `GET /v1/{ingest,relay}/capabilities`, `/health/live\|ready`, `/metrics`, optional Bearer |
| `laststate up [--appliance --build --no-sim --services a,b --wait-timeout --open]` | `docker compose up -d` as a live checklist, Trace+Relay health-wait, URL table |
| `laststate down [--appliance --volumes]` / `ps` / `logs [svc] [--follow --tail]` / `status [--url]` | Manages and audits the stack |
| `laststate sim run [--scenario demo\|steady\|crash-storm\|outage\|recovery\|boot-loop --rate --devices --duration]` / `sim stop` | Brings up the `simulator` service with `SIM_*` |
| `laststate deploy --env local\|production\|appliance\|k8s` | `generate-secrets --only-missing` + `preflight` gate (prod) + `compose up --build`; k8s prints a hint |
| `laststate config list\|get\|set\|paths\|generate-secrets\|preflight` | Real YAML + masked `.env` + global `conf`; never logs a literal secret |
| `laststate doctor [--fix]` | Tools (git/docker/cmake/node), `laststate.yaml`, `.env`, `relay-config.yaml` (`env:` refs, no literals), preflight, live endpoints |
| `laststate update` | Checks `npm view laststate-cli version` |
| `laststate brand` | ASCII logo (braille dots) / `--json` metadata |

### Config

```bash
laststate config list
laststate config get trace_url
laststate config set trace_url http://localhost:8080
laststate config generate-secrets --only-missing
laststate config preflight --deploy-env production
laststate config paths
```

Precedence: `--flag > env (TRACE_URL, LASTSTATE_*_TOKEN) > laststate.yaml > global conf > default`.

## Examples

```bash
# interactive init per target
laststate init --target esp32

# vectors only + json for CI
laststate test --json --verbose

# whole directory analyze in json
laststate analyze ./captures --output-format json

# batch ingest to prod trace
laststate ingest ./captures --to trace --url https://trace.example.com --token $LASTSTATE_COMPANY_TOKEN

# appliance stack without sim
laststate up --appliance --build
laststate ps && laststate status
laststate logs relay --tail 50
laststate down

# prod deploy (fails on REPLACE_ME/weak)
laststate deploy --env production
```

## Experience (animations)

- **Live checklist** in `init`, `build`, `up`, `deploy`: each step goes `○ → ◜ → ✓/✗` with duration; failures print the error and abort as before.
- **Spinners with duration**: every `withSpinner` ends in `◆ <step> · 3.1s`; `up` shows URL + elapsed seconds during the health-check.
- **Bars with rate and ETA**: `ingest` shows `files/s`, KB sent and ETA; same base in `build`.
- **Wizard with `@clack/prompts`**: `init` (name + target), `flash` (port + confirmation), `sim` (scenario), `deploy` (env), `ingest` (file) — arrows, defaults and clean `Ctrl+C` ("Cancelled.", exit 1).
- **Closing line**: `◆ <command> … · done in Xs` at the end of `init`, `build`, `up`, `deploy`.
- General rule: everything turns off with `--json` / `--quiet` / `--no-banner` / `CI=true` / no TTY (checklist becomes static lines, bars become noops).

## Tests

```bash
npm test        # vitest: lep, env-manager, validate, wiring, tasks, ui (40 tests)
npm run build   # tsc → dist/
```

## Documentation

Full docs: https://docs.laststate.io — quickstarts in `docs/quickstarts/`, HIL in `latch/hil/`, vectors in `protocol/test-vectors/`.
