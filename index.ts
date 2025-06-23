#!/usr/bin/env node

import { Command } from 'commander';
import { generateMigrations } from './src/migrate.js';

const program = new Command();

program
  .name('dev')
  .description('Development utilities CLI')
  .version('1.0.0');

const devCommand = program
  .command('dev')
  .description('Development commands');

devCommand
  .command('migrate')
  .description('Generate migration files based on git commits')
  .option('-p, --path <path>', 'Path to generate migrations in', process.cwd())
  .action(async (options) => {
    try {
      await generateMigrations(options.path);
      console.log('✅ Migrations generated successfully');
    } catch (error) {
      console.error('❌ Error generating migrations:', error.message);
      process.exit(1);
    }
  });

program.parse();