# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

The Ads Machine is not a traditional application — it's a collection of Claude Code **skills** (slash commands in `.claude/commands/*.md`) plus reference docs and one Python MCP server. There is no build step, package manifest, or test suite for the skills themselves; "running" this project means invoking its slash commands inside Claude Code against a user's own Airtable base, Apify account, and Meta Ad Account.

Each skill file in `.claude/commands/` is a prompt/instruction set that Claude executes directly — read the relevant `.md` file before changing behavior for that command rather than searching for application code.

## The closed loop (architecture)

The system is a 9-stage pipeline (full description in `docs/blueprint.md`) that scrapes competitor ads, learns from winners, generates new ads, launches them, and feeds performance data back in:

```
/ad-poller     -> scrapes Meta Ad Library via Apify, writes new ads to Airtable, calculates Days Active
/ad-analyzer   -> downloads creatives, Whisper transcribes, Claude extracts hooks/angle, Gemini does visual analysis, scores 0-100
/ad-swipe      -> read/search interface over the swipe file (no scoring math here — Days Active from /ad-poller is the only grading signal)
/ad-ideator    -> takes 1 Long-Runner and produces 5 variations, writes new Ad Pipeline records
/ad-scripter   -> writes timed video script + ad copy (PAS/AIDA/Story/Before-After/Controversy frameworks from reference/ad-frameworks.md)
/ad-brief      -> turns a script into a shot list / filming card
/ad-launch     -> Safe Mode (default): generates copy-paste Ads Manager specs. Advanced mode: calls Meta Graph API directly, requires a compliance checklist confirmation first, and always creates campaigns PAUSED
/ad-monitor    -> pulls Meta Insights, assigns Kill/Watch/Scale/Winner verdicts against reference/kpi-benchmarks.md, writes winners back into the swipe file
```

Data flows: `Meta Ad Library (Apify) -> Ad Swipe File (Airtable) -> Ad Pipeline (Airtable) -> Meta Ads Manager (Graph API) -> Performance Data (Meta Insights) -> winners loop back to Swipe File`.

Grading is purely by **Days Active** (60+ = Long-Runner, 30-59 = Performer, 14-29 = Solid, 7-13 = Testing, <7 = Killed). Angle/format/hook/CTA are filter dimensions for browsing the swipe file, not scoring inputs — don't reintroduce a separate quality score that competes with Days Active.

`/ad-autoresearch` and `/ad-report` are read-only consumers of the swipe file (daily diff / periodic summary) — they don't write Pipeline or Swipe File records.

## MCP servers

External tools are wired through MCP, configured via `/ads-setup` or manually from `mcp-configs/*.json` (placeholders filled from `.env`):

- **Airtable** (required) — the database: Competitors, Ad Swipe File, Proven Hooks, Ad Pipeline tables
- **Apify** (required) — Meta Ad Library scraping
- **Meta Ads** (required for launching) — ships in-repo at `mcp-servers/meta-ads-mcp/server.py` (FastMCP, Python, Graph API `v21.0`)
- **Slack** (optional) — alerts from poller/monitor
- **n8n** (optional) — cron scheduling, see `n8n/ad-poller-workflow.json`

### Meta Ads MCP server (`mcp-servers/meta-ads-mcp/server.py`)

- Requires `META_ACCESS_TOKEN` and `META_AD_ACCOUNT_ID` env vars; install deps with `pip install -r mcp-servers/meta-ads-mcp/requirements.txt`.
- All Meta object IDs are validated with `_require_valid_id()` (numeric, optional prefix like `act_`) before any API call — don't bypass this when adding new tools.
- A `RateLimiter` dataclass enforces 200 calls/hour per Meta's guidelines; new write tools must go through it.
- Read tools (insights, list) are safe with any valid token; write tools (create/update) require the Meta app to have passed App Review — see compliance section below before adding or calling write tools.

## Meta API compliance (read before touching Meta integration code)

Per `reference/compliance.md`: advertisers have been permanently banned for connecting unapproved developer apps to Meta, even long-standing high-spend accounts. Consequences are:

- Default `/ad-launch` behavior must stay Safe Mode (generate specs for manual entry in Ads Manager) — don't make direct API calls the default path.
- Direct Graph API write access is gated behind an explicit compliance checklist confirmation in the skill, and created campaigns/ad sets/ads must always be created **paused**.
- Don't add code that creates a Meta developer app workflow on the same account used for spend, or that removes/loosens the existing rate limiting.

## Reference files

`reference/*.md` holds the universal ad-strategy knowledge the skills draw on (frameworks, KPI benchmarks, copy patterns, compliance, troubleshooting, etc. — see table in `README.md`). These contain no client data; skill prompts read from them rather than hardcoding strategy knowledge inline. When changing how a skill writes copy or makes kill/scale decisions, update the relevant `reference/` file rather than duplicating the rule inside the skill's `.md`.

## Per-installation config

`templates/CLAUDE.md.template` is normally a *separate* file from this one — it's the template `/ads-setup` fills in and writes to an end user's own clone (business info, Airtable table IDs, Meta account IDs, KPI targets). For this installation, the config block below has been merged into this same file because every skill (`ad-poller`, `ad-analyzer`, `ad-swipe`, `ad-ideator`, `ad-scripter`, `ad-brief`, `ad-monitor`, `ad-report`, `ad-autoresearch`) literally parses a "Read from CLAUDE.md" block with these exact field names — so this file now also serves as that runtime config.

## Niche

This installation is configured for **Beauty & Skincare** (Produtos de beleza — skincare diário, cuidados com a pele, hidratante labial). The angle/format classification tables and the Gemini visual-analysis prompt in `.claude/commands/ad-analyzer.md` have been adapted accordingly (GRWM tutorials, product application close-ups, texture/swatch macros, before/after comparisons, and an explicit Natural/Organic vs. Studio/Ring-Light lighting check).

## Business Config
| Field | Value |
|-------|-------|
| Business Name | Laby |
| Website | https://laby.com.br |
| Niche | Produtos de beleza (skincare diário, cuidados com a pele, hidratante labial) |
| Main Offer | Kit com 2 cremes hidratantes |
| Price Point | R$250 |

## Audience Config
| Field | Value |
|-------|-------|
| Age Range | 25-35 anos |
| Gender | Mulheres |
| Location | Brasil |
| Pain Point | Pele ressecada |
| Desired Outcome | Pele hidratada e macia |

## Competitors
| Name | Facebook Page ID | Niche Tier | Notes |
|------|-----------------|------------|-------|
| Direct Competitor 1 | 100065592365486 | Direct | Principal concorrente |
| Principia Skincare Pro | 103012921320160 | Aspirational | |
| Hidratei | 111303550764874 | Aspirational | |
| Aspirational Brand | 61551219302888 | Aspirational | |
| Alex Hormozi | 116482854782233 | Aspirational | Framework source — hooks estruturais |

## Ad Account Config
| Field | Value |
|-------|-------|
| Meta Ad Account ID | Not configured |
| Facebook Page ID | Not configured |
| Pixel ID | Not configured |
| Monthly Budget | Not configured |
| Target CPL | Not configured |
| Target ROAS | 3.0 |

## Ad Research Config
| Field | Value |
|-------|-------|
| Airtable Base ID | appACpl3rkO8fB2nH |
| Competitors Table | tbl8qC1uJnntAO2ST |
| Proven Hooks Table | tblFdymfaHC0uYEmZ |
| Ad Pipeline Table | tblWMso9ejwROeyec |
| Notion Swipe File Page ID | 38e3ef898c4e80ca82caf8c0ce5b7531 |

## Connected Tools
| Tool | Status |
|------|--------|
| Airtable | Connected |
| Apify | Connected |
| Meta Ads | Not configured — configure when ad account is created |
| Slack | Not connected (optional) |
| n8n | Not connected (optional) |
