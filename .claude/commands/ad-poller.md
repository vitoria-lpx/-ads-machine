---
name: ad-poller
description: Scrape all competitor ads from Meta Ad Library via Apify. Detects new ads, flags 30d+ validated winners, marks killed ads, and sends Slack alerts. Run daily or manually.
---

# Daily Ad Poller

You are a competitive ad intelligence scraper. You pull every active Meta ad from tracked competitors, dedup against existing records, update longevity tiers, and push new ads to the Ad Swipe File.

**What you produce:** New competitor ad records in Airtable with copy, media URLs, and metadata -- ready for `/ad-analyzer` to enrich.

---

## Prerequisites

1. **Notion MCP** connected (`NOTION_TOKEN` in `.env`)
2. **Airtable MCP** connected — only for reading the Competitors table
3. **Apify MCP** connected or `APIFY_TOKEN` in `.env`
4. **Competitors table** populated with at least 1 competitor with a Facebook Page ID
5. **CLAUDE.md** configured with Competitors table ID and Notion Swipe File Page ID

---

## Config

Read from CLAUDE.md:

```
Competitors Table: {Airtable table ID — Competitors continua no Airtable}
Notion Swipe File Page ID: 38e3ef898c4e80ca82caf8c0ce5b7531
```

### Find or Create Swipe File Database

Antes do Step 1, resolver o ID da database Notion:

```
Use Notion MCP: search
  query: "Swipe File"
  filter: { property: "object", value: "database" }
```

Se encontrar database com title = "Swipe File" → guardar seu ID como `swipe_db_id` e continuar.

Se não encontrar → criar:

```
Use Notion MCP: create_database
  parent: { type: "page_id", page_id: "38e3ef898c4e80ca82caf8c0ce5b7531" }
  title: "Swipe File"
  properties:
    "Name":             { title: {} }
    "Competitor":       { select: {} }
    "Nicho":            { select: { options: [{name:"Beleza"},{name:"Moda"},{name:"Wellness"}] } }
    "Page Name":        { rich_text: {} }
    "Ad Library URL":   { url: {} }
    "Ad Active Status": { select: { options: [{name:"Active"},{name:"Inactive"}] } }
    "Start Date":       { date: {} }
    "Days Active":      { number: {} }
    "Longevity Tier":   { select: { options: [{name:"Testing"},{name:"Solid"},{name:"Performer"},{name:"Long-Runner"},{name:"Killed"}] } }
    "Display Format":   { select: {} }
    "Hook Copy":        { rich_text: {} }
    "Transcript":       { rich_text: {} }
    "Angle Category":   { select: {} }
    "Visual Style":     { rich_text: {} }
    "Video URL":        { url: {} }
    "Scrape Date":      { date: {} }
    "Pipeline Status":  { select: { options: [{name:"New"},{name:"Ready"},{name:"Done"},{name:"Rejected"}] } }
```

Guardar o ID retornado como `swipe_db_id`.

---

## Step 1: Load Active Competitors

Fetch all records from Competitors table:

```
Use Airtable MCP: list_records
  base_id: {from CLAUDE.md}
  table_id: {Competitors table ID}
  fields: Name, Facebook Page ID, Nicho
```

Each competitor MUST have a `Facebook Page ID`. Skip any without one and warn the user.

Group competitors by Nicho and set per-brand targets:

| Nicho | Marcas | Cota base/marca | Buscar/marca | Cota/nicho |
|-------|--------|-----------------|--------------|-----------|
| Beleza | 10 | 5 Long-Runners | 60 | 50 |
| Wellness | 10 | 5 Long-Runners | 60 | 50 |
| Moda | 6 | 8 Long-Runners | 70 | 48 |

A cota base por marca é um **piso, não um teto**. Se uma marca não tiver Long-Runners suficientes para bater sua cota, a diferença é redistribuída para outras marcas do mesmo nicho que tiverem mais candidatos do que a própria cota (ver Step 3).

**Target total: ~148 Long-Runner video ads por execução (cota/nicho acima)**

Print the competitor list:
```
Found {N} competitors:
  Beleza ({N}): {Name}, {Name}, ...
  Wellness ({N}): {Name}, {Name}, ...
  Moda ({N}): {Name}, {Name}, ...
```

If no competitors found, tell the user to populate the Competitors table first or run `/ads-setup`.

---

## Step 1b: Resolve Page IDs (if needed)

If any competitor has a Facebook Page URL but no numeric Page ID, resolve it automatically:

**Actor:** `apify/facebook-page-contact-information` (official Apify -- 4.8k users, 99.6% success, ~$0.013/page)

```json
{
  "pages": ["https://www.facebook.com/{page_slug}/"]
}
```

**CRITICAL:** The response contains TWO different IDs. You MUST use the right one:
- `facebookId` / `pageId` = the Facebook profile ID (DO NOT USE for Ad Library)
- `pageAdLibrary.id` = the Ad Library Page ID (USE THIS ONE)

Also extract from the response:
- `title` = confirmed page name
- `ad_status` = "This Page is currently running ads." or "This Page isn't currently running ads."
- `website`, `category`, `followers` = useful metadata

Update the Competitors table with the resolved `pageAdLibrary.id`.

If the resolver fails, tell the user to find it manually: facebook.com/ads/library > search the page name > copy `view_all_page_id=` from the URL.

---

## Step 2: Scrape Each Competitor via Apify

For each competitor, scrape ALL ads (active + inactive/historical) from the Meta Ad Library.

### Primary Actor: `apify/facebook-ads-scraper`

Official Apify actor. 16k+ users, 99.4% success rate. Most reliable long-term.

**Input per competitor:**
```json
{
  "startUrls": [{"url": "https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&is_targeted_country=false&media_type=video&search_type=page&sort_data[direction]=desc&sort_data[mode]=total_impressions&view_all_page_id={PAGE_ID}"}],
  "resultsLimit": 60
}
```

`resultsLimit` por nicho: **60** para Beleza e Wellness, **70** para Moda.
Busca volume maior para compensar: (1) DCOs e anúncios com menos de 60 dias, e (2) o filtro de duração ≥30s + presença de voz que roda depois no `/ad-analyzer` e descarta parte dos candidatos antes de contarem pra cota.

Key URL parameters:
- `active_status=all` -- pulls active AND historical/inactive ads
- `sort_data[mode]=total_impressions` -- highest impression ads first
- `country=ALL` -- all countries (change to `GB`, `US`, etc. to filter)
- `media_type=video` -- requests video-only results, but Meta's Ad Library still returns DCO/DPA ads that include video variants. The post-scrape filter in Step 3 discards these.

Use the Apify MCP `call-actor` tool. Set `async: false` so it waits for results.

### Fallback Actor 1: `curious_coder~facebook-ads-library-scraper`

Use if the primary actor is unavailable or returns errors.

```json
{
  "urls": [{"url": "https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=ALL&media_type=video&search_type=page&view_all_page_id={PAGE_ID}"}],
  "scrapePageAds.activeStatus": "all",
  "scrapePageAds.sortBy": "impressions_desc",
  "count": 50
}
```

### Fallback Actor 2: `whoareyouanas/meta-ad-scraper`

Simplest input -- takes Page ID directly.

```json
{
  "pageId": "{PAGE_ID}",
  "activeStatus": "all",
  "country": "ALL",
  "mediaType": "video",
  "sortMode": "total_impressions",
  "sortDirection": "desc",
  "maxItems": 50
}
```

### Scraping rules

- Run competitors in sequence (not parallel) to avoid Apify rate limits
- Each scrape takes 30-120 seconds depending on ad count
- Print progress after each: `[{N}/{total}] {Name}: {count} ads scraped`
- If the primary actor fails on a competitor, retry once. If it fails again, try Fallback 1. Log which actor succeeded.

---

## Step 3: Filter and Dedup

**Filter before dedup — two gates:**

**Gate 1 — Format (discard immediately):**
```python
ALLOWED_FORMATS = {"VIDEO"}

video_ads = [ad for ad in scraped_ads if ad["snapshot"]["displayFormat"] in ALLOWED_FORMATS]
discarded_format = len(scraped_ads) - len(video_ads)
# Log: f"[{competitor}] Discarded {discarded_format} non-video ads (DCO/DPA/IMAGE/CAROUSEL)"
```

**Gate 2 — Long-Runner only (60d+):**
```python
from datetime import date, datetime

today = date.today()

def calc_days_active(ad):
    start_str = ad.get('startDateFormatted') or ''
    start_ts = ad.get('startDate')
    if start_str:
        try:
            start = datetime.fromisoformat(start_str.replace('Z', '+00:00')).date()
        except:
            start = date.fromtimestamp(start_ts) if start_ts else None
    elif start_ts:
        start = date.fromtimestamp(start_ts)
    else:
        return 0
    return (today - start).days

long_runners = [ad for ad in video_ads if calc_days_active(ad) >= 60]
discarded_tier = len(video_ads) - len(long_runners)
# Log: f"[{competitor}] Discarded {discarded_tier} video ads with <60 days active"
```

Ads com menos de 60 dias são descartados e **nunca inseridos no Notion**.

**Quota com redistribuição — rodar só depois que TODAS as marcas do nicho tiverem passado pelos Gates 1 e 2:**
```python
quota_base = {"Beleza": 5, "Wellness": 5, "Moda": 8}[nicho]

# 1. Pool de long_runners por marca, ordenado por dias ativos desc
pools = {brand: sorted(lr, key=calc_days_active, reverse=True)
         for brand, lr in long_runners_by_brand.items()}

# 2. Alocação garantida: até quota_base por marca
selected = {brand: pool[:quota_base] for brand, pool in pools.items()}

# 3. Sobra (acima da cota) vira pool de redistribuição; déficit = quanto falta
leftover_pool, deficit = [], 0
for brand, pool in pools.items():
    if len(pool) < quota_base:
        deficit += quota_base - len(pool)
    else:
        leftover_pool += pool[quota_base:]

# 4. Preencher déficit com o excedente de outras marcas, por dias ativos desc
leftover_pool.sort(key=calc_days_active, reverse=True)
for ad in leftover_pool[:deficit]:
    selected[ad.brand].append(ad)

# Log por marca: f"[{brand}] {len(selected[brand])} selecionados (base {quota_base}{f' + {extra} redistribuídos' if extra else ''})"
# Log por nicho: f"[{nicho}] {total}/{niche_cap} Long-Runners (déficit coberto: {len(leftover_pool[:deficit])}/{deficit})"
```

Before inserting, fetch existing records from the Notion Swipe File:

```
Use Notion MCP: query_database
  database_id: {swipe_db_id}
  page_size: 100
  (paginar com next_cursor até has_more = false)
```

De cada resultado extrair:
- `properties.Name.title[0].plain_text` → Archive ID
- `page.id` → Notion page ID (necessário para updates)
- `properties["Ad Active Status"].select.name` → status atual

Montar map: `{ archiveId → { pageId, adActiveStatus } }`

**Dedup logic:**
- Ad no scrape mas NÃO no Notion = INSERT novo page
- Ad no scrape E já no Notion = atualizar `Ad Active Status` se mudou, senão skip
- Ad no Notion com `Ad Active Status = Active` mas ausente do scrape = atualizar `Ad Active Status` → "Inactive"

**IMPORTANT:** When scraping with `active_status=all`, the source data includes both active and inactive ads. The `Ad Active Status` field tracks the Meta status. The `Status` field tracks YOUR status (Active, Killed, Winner, Starred). These are different things:
- `Ad Active Status` = what Meta says (Active or Inactive)
- `Status` = your classification (Active in swipe file, Killed from swipe file, Winner, Starred)

---

## Step 4: Transform and Insert New Ads

**Only Long-Runner (60d+) real video ads reach this step. DCO, non-video, and sub-60d ads are discarded in Step 3.**

For each new ad, transform the Apify response into an Airtable record.

**Key field mappings (Primary actor: `apify/facebook-ads-scraper`) -- CONFIRMED via live test:**

| Swipe File Field | Source Path | Notes |
|-----------------|------------|-------|
| Ad Archive ID | `adArchiveId` | String. Primary dedup key. Also available as `adArchiveID` |
| Competitor | Competitor name from your table | Not in the scrape output -- you add this |
| Page Name | `pageName` | Top-level field |
| Ad Library URL | `https://www.facebook.com/ads/library/?id={adArchiveId}` | Construct from ID |
| Status | `Active` | Your classification -- always start as Active |
| Ad Active Status | `isActive` (boolean) | `true` = Active, `false` = Inactive. Convert to text for Airtable |
| Start Date | `startDateFormatted` | ISO string e.g. `2026-02-13T08:00:00.000Z`. Also `startDate` as unix timestamp |
| End Date | `endDateFormatted` | ISO string. Present for ALL ads (active ads show today's date) |
| Display Format | `snapshot.displayFormat` | Values: `VIDEO`, `IMAGE`, `DCO`, `CAROUSEL`. Map to title case for Airtable |
| Body Text | `snapshot.body.text` | Full ad copy with formatting preserved |
| Title | `snapshot.title` | May be `{{product.name}}` for DCO ads -- skip those |
| CTA Type | `snapshot.ctaType` | e.g. `LEARN_MORE`, `SIGN_UP`, `APPLY_NOW` |
| CTA Text | `snapshot.ctaText` | e.g. `Learn more`, `Sign up`, `Apply now` |
| Link URL | `snapshot.linkUrl` | Landing page URL |
| Video URL | `snapshot.videos[0].videoHdUrl` | HD preferred. Fallback: `snapshot.videos[0].videoSdUrl` |
| Image URL | `snapshot.images[0].originalImageUrl` | For carousels, use `snapshot.cards[0].originalImageUrl` |
| Publisher Platforms | `publisherPlatform` | Array: `["FACEBOOK", "INSTAGRAM", "AUDIENCE_NETWORK"]` |
| Word Count | Count words in `snapshot.body.text` | |
| Hook Copy | First line of Body Text (up to first period or newline) | |
| Scrape Date | Today's date | |
| Scrape Batch ID | Apify dataset ID | From the `call-actor` response |
| Is Analyzed | false | |

**DCO/DPA ads are discarded in Step 3** and never reach this step. No DCO record is inserted into Notion.

**Carousel ads:** Creative data is in `snapshot.cards[]` array. Each card has its own `body`, `title`, `ctaType`, `originalImageUrl`, `videoSdUrl`.

**CRITICAL: How to fetch Video URL from Apify datasets**

When calling `get-dataset-items`, do NOT use the `fields` projection parameter if you need Video URL. Apify's field projection does not correctly return nested array fields like `snapshot.videos[0].videoHdUrl` — the field will silently come back empty.

Instead, always fetch items **without** the `fields` parameter (or with `clean: true` only). Then extract the video URL from the full item:
- Primary path: `item["snapshot.videos"][0]?.videoHdUrl` (when items are returned as objects)
- Flat path (as Apify sometimes returns): `item["snapshot.videos.videoHdUrl"]` — this is an array; take `[0]`
- SD fallback: same paths with `videoSdUrl`

If the Video URL is still empty after extraction, log it and leave the Airtable field blank. Never skip inserting the record.

**CRITICAL: Never strip the query string from Video URL.** The URL's query parameters (`_nc_ohc`, `oh`, `oe`, etc.) are Facebook CDN's authorization signature, not tracking cruft -- without them the download returns 403 Forbidden regardless of how fresh the URL is. Insert the Video URL exactly as returned by Apify, including everything after the `?`. Confirmed live 2026-07-10: a truncated URL (cut at `.mp4`, no query string) failed with 403; the same URL with its full query string succeeded (200 OK).

**IMPORTANT: Output fields vary between actors.** When processing results:
1. Fetch full items (no `fields` restriction) to avoid losing nested array data
2. Log the first result to see the exact field names returned
3. Try the primary field name first, then known alternatives
4. If a field is missing, leave it blank rather than erroring

**Fallback field name mappings:**

| Field | Primary (`apify/facebook-ads-scraper`) | Fallback 1 (`curious_coder`) | Fallback 2 (`whoareyouanas`) |
|-------|---------------------------------------|------------------------------|------------------------------|
| Archive ID | `adArchiveId` | `ad_archive_id` | `adArchiveID` |
| Body text | `snapshot.body.text` | `snapshot.body.text` | `description` |
| Page name | `pageName` | `snapshot.page_name` | `brandName` |
| Start date | `startDateFormatted` (ISO) | `start_date` (unix) | `startDate` |
| Active status | `isActive` (boolean) | `scrapePageAds.activeStatus` | `activeStatus` |
| Video URL | `snapshot.videos[0].videoHdUrl` | `snapshot.videos[0].video_hd_url` | `videoUrl` |
| Image URL | `snapshot.images[0].originalImageUrl` | `snapshot.images[0].original_image_url` | `imageUrl` |
| Display format | `snapshot.displayFormat` | `snapshot.displayFormat` | `mediaType` |

Criar um Notion page por anúncio (Notion não tem batch create para database pages):

```
Use Notion MCP: create_page
  parent: { database_id: swipe_db_id }
  properties:
    "Name":             { title: [{ text: { content: ad.adArchiveId } }] }
    "Competitor":       { select: { name: competitor_name } }
    "Nicho":            { select: { name: nicho } }
    "Page Name":        { rich_text: [{ text: { content: ad.pageName } }] }
    "Ad Library URL":   { url: "https://www.facebook.com/ads/library/?id={adArchiveId}" }
    "Ad Active Status": { select: { name: ad.isActive ? "Active" : "Inactive" } }
    "Start Date":       { date: { start: ad.startDateFormatted } }
    "Days Active":      { number: days_active }
    "Longevity Tier":   { select: { name: longevity_tier } }
    "Display Format":   { select: { name: ad.snapshot.displayFormat } }
    "Hook Copy":        { rich_text: [{ text: { content: first_line_of_body } }] }
    "Video URL":        { url: video_url }   ← omitir se vazio
    "Scrape Date":      { date: { start: today_iso } }
    "Pipeline Status":  { select: { name: "New" } }
```

Omitir propriedades sem valor (não enviar null).

---

## Step 5: Update Longevity Tiers

After all inserts, recalculate longevity tiers for ALL active ads in the Swipe File:

```python
from datetime import date

today = date.today()
for ad in all_ads:
    end = ad.end_date or today  # Active ads use today
    days = (end - ad.start_date).days
    if days >= 60:
        tier = "Long-Runner"
    elif days >= 30:
        tier = "Performer"
    elif days >= 14:
        tier = "Solid"
    elif days >= 7:
        tier = "Testing"
    else:
        tier = "Killed"
    ad.longevity_tier = tier
    ad.days_active = days
```

**Days Active IS the grade.** No composite scoring. The market already graded every ad by how long the advertiser kept spending on it. Everything else (format, angle, hook, CTA) is a filter for browsing, not a scoring factor.

Para cada anúncio onde o tier mudou, atualizar o Notion page:

```
Use Notion MCP: update_page
  page_id: {pageId do map de dedup}
  properties:
    "Days Active":    { number: days }
    "Longevity Tier": { select: { name: tier } }
```

---

## Step 6: Slack Alert (Optional)

If `SLACK_WEBHOOK_URL` is configured in `.env` or Slack MCP is connected, send a daily summary:

```
Ad Poller Complete

{N} competitors scraped
{new_count} new ads found
{killed_count} ads killed (disappeared)
{winner_count} validated winners (30d+)

Top new hooks:
1. "{first line of highest word-count new ad}"
2. "{second}"
3. "{third}"

Run /ad-analyzer to process {unanalyzed_count} unanalyzed ads.
```

If Slack is not configured, skip this step silently.

---

## Step 7: Print Summary

```
=== Ad Poller Complete ===

Competitors scraped: {N}
Target: ~148 Long-Runner video ads (50 Beleza / 50 Wellness / 48 Moda)

Novos Long-Runners inseridos: {new}
Já existiam (pulados): {existing}

Por nicho:
  Beleza: {count}/50 Long-Runners inseridos (déficit redistribuído: {n})
  Wellness: {count}/50 Long-Runners inseridos (déficit redistribuído: {n})
  Moda: {count}/48 Long-Runners inseridos (déficit redistribuído: {n})

Descartados no total:
  Formato inválido (DCO/DPA/IMAGE): {total_format_discarded}
  Vídeo mas <60 dias ativos: {total_tier_discarded}
  Acima da cota do nicho (sem sobra pra redistribuir): {total_quota_discarded}

Por marca:
  {Name}: {inserted} inseridos ({base} base + {extra} redistribuídos) / {long_runners} Long-Runners encontrados / {fetched} buscados
  ...

Unanalyzed ads: {count}
Next step: Run /ad-analyzer to transcribe and classify new ads.
```

---

## CRITICAL RULES

1. **Primary actor is `apify/facebook-ads-scraper`** (official Apify, 16k+ users, 99.4% success). Fallback 1: `curious_coder~facebook-ads-library-scraper`. Fallback 2: `whoareyouanas/meta-ad-scraper`.
2. **Always scrape with `active_status=all`** to get both active and historical/inactive ads. Inactive ads that ran 60+ days are proven winners.
3. **Start dates may be ISO strings or unix timestamps** depending on the actor. Handle both: try parsing as ISO first, then as unix timestamp.
4. **DCO ads are discarded.** `displayFormat = DCO` means Meta assembles the creative dynamically — no real video. Do not insert DCO records.
5. **Dedup on Ad Archive ID.** Same ad can appear in multiple scrapes.
6. **Notion não tem batch create para database pages.** Criar e atualizar um page por vez.
7. **Facebook Page ID vs Profile ID:** The Competitors table stores the Ad Library page ID, NOT the profile ID. Use `apify/facebook-page-contact-information` to resolve page URLs to Ad Library IDs (the `pageAdLibrary.id` field -- NOT `facebookId` or `pageId`).
8. **Run competitors in sequence.** Parallel scraping hits Apify rate limits.
9. **Never delete records.** Mark killed ads as Killed with an End Date. History matters.
10. **Ad Active Status vs Status:** `Ad Active Status` is what Meta reports (Active/Inactive). `Status` is your swipe file classification (Active, Killed, Winner, Starred). An ad can be `Ad Active Status = Inactive` but `Status = Winner` -- that means it ran successfully and was turned off after scaling.
11. **If the primary actor fails**, retry once. If it fails again, switch to Fallback 1. If that fails, try Fallback 2. Log which actor worked for each competitor.
12. **Fallback if all Apify actors are down:** Adicionar pages manualmente na database "Swipe File" no Notion. The rest of the pipeline (analyzer, ideator, scripter) still works.
13. **Filter before dedup — two gates.** (1) Format: only `displayFormat = VIDEO` proceeds; DCO/DPA/IMAGE/CAROUSEL are dropped. (2) Longevity: only ads with days_active >= 60 proceed; sub-60d ads are discarded and never inserted into Notion.
14. **Per-brand quota with redistribution.** After both filters, each brand gets a base quota (5 for Beleza/Wellness, 8 for Moda) sorted by days active descending. This is a floor, not a ceiling: run quota allocation only after all brands in a niche have been scraped, then fill any brand's deficit from other brands' surplus in the same niche (cross-brand, sorted by days active). Target output: ~148 Long-Runner ads per full run (50 Beleza / 50 Wellness / 48 Moda). `resultsLimit` per brand (60 Beleza/Wellness, 70 Moda) was raised specifically to feed this redistribution and to leave headroom for the ≥30s + has-voice filter applied downstream in `/ad-analyzer`.
