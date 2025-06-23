#!/usr/bin/env node

import { Command } from 'commander';
import { generateMigration } from './src/migrate.js';

const program = new Command();

program
  .name('dev')
  .description('Development utilities CLI')
  .version('1.0.0');

const devCommand = program
  .command('dev')
  .description('Development commands');

devCommand
  .command('generate [name]')
  .description('Generate migration files based on current state vs last migration')
  .option('-p, --path <path>', 'Path to generate migrations in', process.cwd())
  .action(async (name, options) => {
    try {
      await generateMigration(options.path, name);
    } catch (error) {
      console.error('❌ Error generating migration:', error.message);
      process.exit(1);
    }
  });

program.parse();