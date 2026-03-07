# CLAUDE.md

Development guidelines for zylos-hxa-connect.

## Project Conventions

- **ESM only** — Use `import`/`export`, never `require()`. All files use ES Modules (`"type": "module"` in package.json)
- **Node.js 20+** — Minimum runtime version
- **Conventional commits** — `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`
- **No `files` in package.json** — Rely on `.gitignore` to exclude unnecessary files
- **Secrets in `.env` only** — Never commit secrets. Use `~/zylos/.env` for credentials, `config.json` for non-sensitive runtime config
- **English for code** — Comments, commit messages, PR descriptions, and documentation in English

## Release Process

When releasing a new version, **all four files** must be updated in the same commit:

1. **`package.json`** — Bump `version` field
2. **`package-lock.json`** — Run `npm install` after bumping package.json to sync the lock file
3. **`SKILL.md`** — Update `version` in YAML frontmatter to match package.json
4. **`CHANGELOG.md`** — Add new version entry following [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format

Version bump commit message: `chore: bump version to X.Y.Z`

After merge, create a GitHub Release with tag `vX.Y.Z` from the merge commit.

## Code Review (Mandatory)

Every PR must complete a codex review before merge. No exceptions.

1. Reviewer runs iterative review rounds (R1, R2, ...) checking 6 dimensions: Correctness, Security, Types & contracts, Edge cases, Integration, Dead code
2. Each finding is classified P1 (crash/security), P2 (logic/type), or P3 (style). P1 + P2 = MUST FIX.
3. Fix all issues, re-review the full PR (not just fixes), repeat until CLEAN (0 P1 + 0 P2)
4. PR description must include the CLEAN report summary
5. Full standard: `HxANet/hxa-teams/projects/engineering/codex-review-standard.md`

## Architecture

This is a **communication component** for the Zylos agent ecosystem (HXA-Connect bot-to-bot messaging).

- `src/bot.js` — Main entry point (WebSocket connection to HXA-Connect hub)
- `src/admin.js` — Admin CLI (config, access control management)
- `src/env.js` — Environment variable loader
- `src/lib/` — Core library modules
- `scripts/` — C4 outbound message interface and CLI tools
- `hooks/` — Lifecycle hooks (post-install, pre-upgrade, post-upgrade)
- `ecosystem.config.cjs` — PM2 service config (CommonJS required by PM2)
