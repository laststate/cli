#!/usr/bin/env node

import { Command } from 'commander';
import { init } from './commands/init.js';
import { test } from './commands/test.js';
import { mock } from './commands/mock.js';
import { analyze } from './commands/analyze.js';
import { config } from './commands/config.js';

const program = new Command();

program
  .name('laststate')
  .description('LastState CLI for embedded crash reporting')
  .version('1.0.0');

program
  .command('init')
  .description('Initialize a new LastState project')
  .option('--project-name <name>', 'Name of the project')
  .option('--target <target>', 'Target platform (e.g., esp32, cortex-m)')
  .option('--no-git', 'Skip git init in the scaffolded project')
  .action(init);

program
  .command('test')
  .description('Test your Latch integration')
  .option('--verbose', 'Verbose output')
  .action(test);

program
  .command('mock')
  .description('Run mock server for development')
  .option('--port <port>', 'Port to run mock server on', '8080')
  .option('--host <host>', 'Host to bind to', 'localhost')
  .action(mock);

program
  .command('analyze')
  .description('Analyze crash reports')
  .argument('<file>', 'Path to crash report file')
  .option('--output-format <format>', 'Output format (json, text)', 'text')
  .action(analyze);

const cfg = program.command('config').description('Manage configuration');
cfg.command('list').description('List all configuration values').action(() => config('list'));
cfg.command('get').description('Get a configuration value').argument('<key>', 'key').action((k: string) => config('get', k));
cfg.command('set').description('Set a configuration value').argument('<key>', 'key').argument('<value>', 'value').action((k: string, v: string) => config('set', k, v));

program.parse();