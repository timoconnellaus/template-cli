# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-06-23

### Added
- **Core Template CLI functionality**
  - `init` command for initializing projects from templates
  - `check` command for checking pending migrations
  - `update` command for applying pending migrations
  - `sync` command for historical template synchronization
  - `dev generate` command for creating migrations

- **Sync Feature**
  - Intelligent historical reconstruction for existing repositories
  - Similarity scoring algorithm with comprehensive matching
  - Incremental state reconstruction for accurate historical analysis
  - Support for large template evolution histories (10+ migrations)

- **Conflict Resolution**
  - Interactive conflict resolution during migration application
  - Integration with Claude Code CLI for intelligent merging
  - User diff calculation from migration history baseline

- **Comprehensive Test Suite**
  - 138 tests covering all functionality
  - Unit tests for all utilities and commands
  - Integration tests for end-to-end workflows
  - Performance tests for large-scale scenarios

### Technical Details
- Built with TypeScript and Bun
- Uses unified diff format for migration tracking
- Supports gitignore-style patterns via `.migrateignore`
- Maintains backward compatibility with existing projects

### Documentation
- Complete specification in SPEC.md
- Sync methodology documentation in SYNC.md
- Development guidance in CLAUDE.md