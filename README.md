# LastState CLI

> **Status: developer preview.** `init` scaffolds, `mock` fakes a Trace,
> `test` runs static probes only (unprobed checks print `-`, never pass).
> For real validation use the HIL fixtures in `latch/hil/` and
> `protocol/test-vectors/`.

The LastState Command Line Interface provides developers with tools to integrate, test, and manage their embedded crash reporting systems.

## Installation

```bash
npm install -g laststate-cli
```

Or using Python:

```bash
pip install laststate-cli
```

## Commands

### `ls init` - Initialize a new project

Initialize a new LastState integration in your project:

```bash
laststate init --project-name "MyEmbeddedProject"
```

This creates the necessary configuration files and sample code to get started with crash reporting.
It also runs `git init` (best-effort, skipped inside an existing repo or
without git); use `--no-git` to skip.

### `ls test` - Test your integration

Run tests against your Latch integration:

```bash
laststate test
```

This validates your Latch setup and ensures proper crash capture behavior.

### `ls mock` - Run mock server for development

Start a mock server that simulates the Trace backend for local development:

```bash
laststate mock --port 8080
```

### `ls analyze` - Analyze crash reports

Analyze crash reports from your embedded devices:

```bash
laststate analyze path/to/crash-report.lep
```

### `ls config` - Manage configuration

View and update your LastState configuration:

```bash
laststate config list
laststate config set api-key YOUR_API_KEY
```

## Getting Started

1. Initialize your project:
   ```bash
   laststate init --project-name "MyEmbeddedProject"
   ```

2. Add crash reporting to your firmware:
   ```c
   #include <latch/latch.h>
   
   void main() {
       ls_init();
       ls_boot();
       
       // Your application code here
       ls_breadcrumb("main:loop");
   }
   ```

3. Test your integration:
   ```bash
   laststate test
   ```

4. Deploy to production:
   ```bash
   laststate deploy --environment production
   ```

## Documentation

Full documentation is available at https://docs.laststate.io