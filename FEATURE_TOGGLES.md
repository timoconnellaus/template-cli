# Feature Toggles System Specification

## Overview

The Feature Toggles system extends the Template Update CLI to support conditional synchronization based on enabled features. Instead of syncing all template changes, projects can selectively enable features and only receive updates relevant to those features.

## Core Concepts

### Feature
A discrete piece of functionality that can be enabled or disabled in a project. Examples: organizations, billing, analytics.

### Feature Manifest
A configuration file (`template-features.json`) that defines available features, their dependencies, and associated files.

### Feature-Exclusive Files
Files that should only exist when a specific feature is enabled. These are completely added/removed based on feature state.

### Feature-Conditional Content
Sections within shared files that are included/excluded based on feature state. Marked with special comments or directives.

### Feature Dependencies
Features can depend on other features (e.g., billing requires organizations).

## Architecture

### 1. Feature Manifest Structure

```json
{
  "version": "1.0.0",
  "features": {
    "organizations": {
      "description": "Multi-tenant organization support",
      "dependencies": ["authentication"],
      "exclusivePatterns": [
        "src/features/organizations/**",
        "src/pages/org-*",
        "src/api/*-org.*",
        "**/*.org.{ts,tsx,css}"
      ],
      "sharedFiles": {
        "src/routes/index.tsx": ["blocks", "imports"],
        "src/components/Header.tsx": ["blocks"],
        "src/onboarding/steps.tsx": ["injections"]
      },
      "injectionPoints": {
        "onboarding-steps": {
          "file": "src/onboarding/steps.tsx",
          "content": "{ id: 'organization', component: OrganizationStep },",
          "position": "before:preferences"
        }
      }
    },
    "billing": {
      "description": "Stripe billing integration",
      "dependencies": ["organizations"],
      "exclusivePatterns": [
        "src/features/billing/**",
        "src/pages/billing/**"
      ]
    }
  }
}
```

### 2. Project Configuration

```json
{
  "version": "1.0.0",
  "enabledFeatures": ["authentication", "organizations"],
  "templateVersion": "1.5.0"
}
```

### 3. Enhanced Migration Format

```typescript
export const migration = {
  // Feature-exclusive file
  "src/features/organizations/OrgSelector.tsx": {
    type: "new",
    path: "src/features/organizations/OrgSelector.tsx",
    featureExclusive: "organizations"
  },
  
  // Shared file with conditional content
  "src/routes/index.tsx": {
    type: "modify",
    diffFile: "routes-index.diff",
    features: {
      "organizations": "routes-index-orgs.diff",
      "_base": "routes-index-base.diff"
    }
  }
} as const;
```

### 4. Feature Blocks in Code

```typescript
// src/routes/index.tsx
import { useAuth } from '@/auth';
// @feature:organizations:start
import { useOrganization } from '@/org/hooks';
// @feature:organizations:end

export function Router() {
  const { user } = useAuth();
  // @feature:organizations:start
  const { currentOrg, isLoading } = useOrganization();
  
  if (user && !currentOrg && !isLoading) {
    return <Redirect to="/select-organization" />;
  }
  // @feature:organizations:end

  return <MainRoutes />;
}
```

### 5. Injection Points

```typescript
// src/onboarding/steps.tsx
export const onboardingSteps = [
  { id: 'profile', component: ProfileStep },
  { id: 'preferences', component: PreferencesStep },
  // @inject-point:onboarding-steps
];
```

### 6. Enhanced Applied Migrations Tracking

```json
{
  "version": "1.0.0",
  "template": "/path/to/template",
  "enabledFeatures": ["authentication", "organizations"],
  "appliedMigrations": [...],
  "skippedMigrations": [
    {
      "name": "2025-06-24_billing-components",
      "reason": "feature:billing not enabled"
    }
  ],
  "featureFiles": {
    "organizations": [
      "src/features/organizations/OrgSelector.tsx",
      "src/api/org-endpoints.ts"
    ]
  }
}
```

## User Workflows

### Template User Workflow

1. **Initialize with Features**
   ```bash
   bun run dev init my-project --features authentication,organizations
   ```

2. **Check Feature Status**
   ```bash
   bun run dev features list        # Show enabled/available features
   bun run dev features status      # Show which files belong to which features
   ```

3. **Enable a Feature**
   ```bash
   bun run dev features enable billing
   # Or manually edit project-config.json then run:
   bun run dev update --sync-features
   ```

4. **Disable a Feature**
   ```bash
   bun run dev features disable organizations
   # Prompts for confirmation if files have local modifications
   ```

### Template Developer Workflow

1. **Define Features**
   - Create/update `template-features.json`
   - Mark feature-exclusive directories and files
   - Define injection points and conditional blocks

2. **Develop with Features**
   ```bash
   # Start dev with specific features
   npm run dev -- --features=organizations,billing
   
   # Use environment variable
   ENABLED_FEATURES=organizations npm run dev
   ```

3. **Generate Feature-Aware Migrations**
   ```bash
   bun run dev dev generate add-org-ui
   # System auto-detects which features are affected
   ```

## Development Experience

### Vite Plugin for Template Development

The Vite plugin provides real-time feature toggling during development:

1. **File Resolution**: Excludes feature-exclusive files/directories
2. **Code Transformation**: Strips feature blocks from shared files
3. **Import Rewriting**: Handles conditional imports
4. **HMR Support**: Re-processes when features change
5. **Dev Toolbar**: Visual feature toggle interface

### Testing Strategy

Template developers can test different feature combinations:

```json
{
  "scripts": {
    "dev:core": "ENABLED_FEATURES= vite",
    "dev:orgs": "ENABLED_FEATURES=organizations vite",
    "dev:full": "ENABLED_FEATURES=organizations,billing,analytics vite"
  }
}
```

## Implementation Details

### Feature State Transitions

#### Enabling a Feature
1. Validate all dependencies are enabled
2. Find all previously skipped migrations for the feature
3. Apply feature-exclusive file migrations
4. Apply feature-specific diffs to shared files
5. Update tracking in `applied-migrations.json`

#### Disabling a Feature
1. Check for dependent features (cannot disable if others depend on it)
2. Identify all feature-exclusive files from tracking
3. Check for local modifications
4. Prompt user for confirmation with options:
   - Delete files (with backup option)
   - Keep as orphaned files
   - Cancel operation
5. Remove feature blocks from shared files
6. Update tracking

### Conflict Resolution

When feature-specific changes conflict with user modifications:

1. Calculate user diff from baseline (applied migrations)
2. Show conflict details
3. Offer resolution options:
   - Keep user version
   - Use template version
   - Use Claude Code CLI for intelligent merging
4. Continue with remaining files

### Feature Composition

When multiple features modify the same file:

1. Apply base changes first
2. Apply feature changes in dependency order
3. Use composition rules from manifest for complex interactions
4. Validate final result

## Acceptance Criteria

### Core Functionality
- [ ] Projects can declare enabled features in configuration
- [ ] Migration generation detects and tags feature associations
- [ ] Feature-exclusive files are only created when feature is enabled
- [ ] Feature-conditional content is properly added/removed from shared files
- [ ] Feature dependencies are validated and enforced
- [ ] Skipped migrations are tracked and can be applied later

### User Commands
- [ ] `init` command accepts `--features` flag
- [ ] `features list` shows all available and enabled features
- [ ] `features enable <name>` enables a feature and applies migrations
- [ ] `features disable <name>` disables a feature with proper cleanup
- [ ] `update --sync-features` synchronizes based on current feature set

### Developer Experience
- [ ] Vite plugin strips/includes code based on active features
- [ ] Feature blocks are properly processed during development
- [ ] Import resolution handles feature-exclusive modules
- [ ] HMR works when toggling features

### Safety & Correctness
- [ ] Cannot enable feature without its dependencies
- [ ] Cannot disable feature if others depend on it
- [ ] User modifications are preserved or explicitly handled
- [ ] Feature state remains consistent after errors

## Test Scenarios

### Unit Tests

1. **Feature Manifest Parsing**
   - Valid manifest structure
   - Invalid dependency chains
   - Pattern matching for exclusive files

2. **Migration Generation**
   - Feature detection from file paths
   - Feature block parsing
   - Injection point handling
   - Multi-feature file modifications

3. **Feature State Management**
   - Enabling/disabling features
   - Dependency validation
   - File tracking updates

4. **Diff Generation & Application**
   - Feature-specific diff creation
   - Conditional diff application
   - Feature block stripping

### Integration Tests

1. **Feature Enable Flow**
   - Enable feature with no dependencies
   - Enable feature with satisfied dependencies
   - Enable feature with unsatisfied dependencies (should fail)
   - Enable feature with existing skipped migrations
   - Enable feature that modifies shared files

2. **Feature Disable Flow**
   - Disable feature with no dependents
   - Disable feature with dependents (should fail)
   - Disable feature with modified files
   - Disable feature with user choosing different cleanup options

3. **Migration Application**
   - Apply migration with all features enabled
   - Apply migration with some features disabled
   - Apply migration that adds feature-exclusive files
   - Apply migration that modifies shared files conditionally

4. **Conflict Resolution**
   - User modified feature block content
   - User modified file with incoming feature changes
   - Multiple features modifying same file
   - Feature injection point conflicts

5. **Project Initialization**
   - Init with no features
   - Init with specific features
   - Init with invalid feature combination
   - Init from template without feature support

### End-to-End Tests

1. **Complete Feature Lifecycle**
   - Initialize project with features
   - Generate migrations in template
   - Update project with new migrations
   - Enable additional feature
   - Disable feature
   - Re-enable previously disabled feature

2. **Developer Workflow**
   - Start dev server with features
   - Toggle features during development
   - Generate migration while features active
   - Test migration application in different feature states

3. **Complex Scenarios**
   - Cascading feature dependencies
   - Circular dependency detection
   - Multiple features affecting same injection point
   - Feature removal with extensive modifications

### Edge Cases

1. **Binary Files**: Feature-exclusive binary files
2. **Empty Features**: Features with no files
3. **Large Migrations**: Performance with many feature files
4. **Corrupted State**: Recovery from invalid tracking files
5. **Partial Application**: Rollback on migration failure

## Future Enhancements

1. **Feature Versioning**: Support different versions of the same feature
2. **Feature Presets**: Predefined feature combinations (e.g., "starter", "pro")
3. **Dynamic Features**: Runtime feature detection and loading
4. **Feature Analytics**: Track which features are commonly used together
5. **Gradual Migration**: Slowly migrate from non-feature to feature-based approach