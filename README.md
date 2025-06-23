# Template CLI

A powerful CLI tool for template-based project initialization and synchronization with intelligent migration tracking.

## Overview

Template CLI enables you to:
- **Initialize new projects** from evolving templates
- **Synchronize existing repositories** with template updates using historical reconstruction
- **Track and apply incremental changes** through a sophisticated migration system
- **Resolve conflicts intelligently** when template updates conflict with local changes

## Installation

```bash
npm install -g @timoaus/template-cli
```

## Quick Start

### For Template Users

#### Initialize a new project from a template
```bash
template-cli init my-new-project --template /path/to/template
```

#### Check for template updates
```bash
template-cli check
```

#### Apply pending updates
```bash
template-cli update
```

#### Sync an existing repository with a template
```bash
template-cli sync --template /path/to/template
```

### For Template Developers

#### Generate a migration from template changes
```bash
template-cli dev generate "add-new-feature" --path /path/to/template
```

## Core Features

### 🚀 **Project Initialization**
Initialize new projects from templates with full migration history applied automatically.

### 🔄 **Smart Synchronization**
Sync existing repositories with templates using intelligent historical reconstruction:
- Analyzes your repository against template evolution history
- Finds the best matching point in template timeline
- Establishes tracking from the correct historical state
- Minimal disruption to existing code

### 📈 **Migration Tracking**
- Incremental updates through structured migrations
- Unified diff format for precise change tracking
- Support for file additions, modifications, deletions, and moves
- Handles complex template evolution histories (10+ migrations)

### ⚡ **Conflict Resolution**
When template updates conflict with local changes:
- Interactive resolution with clear options
- Integration with Claude Code CLI for intelligent merging
- Preserves user intent while incorporating template improvements

### 📊 **Similarity Analysis**
Advanced scoring algorithm for historical matching:
- **Exact matches**: 10 points per identical file
- **Partial matches**: 5 points for similar content (>80% similarity)
- **Missing files**: -3 points penalty
- **Extra files**: -1 point penalty  
- **Directory structure**: +2 points bonus per matching directory

## Commands

### Template User Commands

| Command | Description |
|---------|-------------|
| `init <target>` | Initialize new project from template |
| `check` | Check for pending template updates |
| `update` | Apply pending template updates |
| `sync` | Sync existing repo with template history |

### Template Developer Commands

| Command | Description |
|---------|-------------|
| `dev generate [name]` | Generate migration from template changes |

## Configuration

### `.migrateignore`
Control which files are tracked in migrations using gitignore-style patterns:

```
node_modules/**
.git/**
*.log
.env*
dist/**
```

### `applied-migrations.json`
Automatically created to track which migrations have been applied:

```json
{
  "version": "1.0.0",
  "template": "/path/to/template",
  "appliedMigrations": [
    {
      "name": "2025-06-23T10-30-00_initial-setup",
      "timestamp": "2025-06-23T10-30-00", 
      "appliedAt": "2025-06-23T15:45:00.000Z"
    }
  ]
}
```

## Use Cases

### 🏗️ **Template Maintainers**
- Evolve templates over time with structured migrations
- Distribute updates to all projects using the template
- Track template usage and update adoption

### 👩‍💻 **Project Teams**
- Start new projects with latest template features
- Receive template improvements automatically
- Maintain customizations while staying up-to-date

### 🔄 **Repository Migration**
- Migrate existing projects to use templates
- Establish tracking for repositories that predate templates
- Synchronize divergent codebases with template standards

## Examples

### Sync Workflow
```bash
# You have an existing project that was based on a template
cd my-existing-project

# Sync with the template to establish tracking
template-cli sync --template ../my-template

# Result: Finds best historical match and creates applied-migrations.json
# ✅ Best match found: "2025-06-20T10-00-00_add-auth-system" (85% similarity)
#    - 12 exact file matches
#    - 3 files with minor differences  
#    - 2 files only in your repo
#    - 5 newer migrations available to apply

# Apply newer template updates
template-cli update

# Result: Applies 5 pending migrations with conflict resolution
```

### Template Development Workflow
```bash
# Make changes to your template
cd my-template
# ... edit files ...

# Generate migration
template-cli dev generate "add-user-auth"

# Result: Creates migrations/2025-06-23T14-30-00_add-user-auth/
# ✅ Migration 'add-user-auth' generated successfully
# 📁 Created: migrations/2025-06-23T14-30-00_add-user-auth

# Projects can now update
cd ../project-using-template
template-cli check
# Result: Shows "add-user-auth" as pending migration

template-cli update
# Result: Applies the new authentication features
```

## Advanced Features

### Performance
- Handles large template histories efficiently (25+ migrations in <10s)
- Incremental state reconstruction minimizes memory usage
- Smart file scanning with ignore pattern optimization

### Reliability  
- Atomic migration application with rollback on errors
- Comprehensive test suite with 138 passing tests
- Type-safe TypeScript implementation

### Integration
- Works with any project structure or framework
- Git integration for change tracking
- Compatible with existing development workflows

## Documentation

- **[SPEC.md](./SPEC.md)** - Complete technical specification
- **[SYNC.md](./SYNC.md)** - Historical synchronization methodology  
- **[CONTRIBUTING.md](./CONTRIBUTING.md)** - Development and release guidelines
- **[CHANGELOG.md](./CHANGELOG.md)** - Release history

## License

MIT