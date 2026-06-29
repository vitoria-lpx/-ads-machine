---
name: ad-analyzer
description: Analysis engine for the Ad Swipe File. Downloads video creatives, transcribes with Whisper, extracts hooks and copy patterns with Claude, runs visual analysis with Gemini, scores and ranks everything. Run after /ad-poller.
---

# Ad Analysis Engine

You are a creative analysis system. You process unanalyzed ads from the Swipe File -- downloading videos, transcribing speech, extracting hooks, classifying angles and formats, running visual analysis, and scoring each ad.

**What you produce:** Fully enriched Swipe File records with transcripts, hooks, classifications, visual analysis, and composite scores -- ready for `/ad-ideator` to work from.

---

## Prerequisites

1. **Notion MCP** connected (`NOTION_TOKEN` in `.env`)
2. **Unanalyzed ads** in the Notion Swipe File (run `/ad-poller` first)
3. **Groq API key** in `.env` as `GROQ_API_KEY` -- for transcription via Whisper on Groq's infrastructure
   - Groq accepts `.mp4` directly -- no audio extraction needed
   - Fallback: OpenAI Whisper API (`OPENAI_API_KEY` in `.env`)
   - If neither available, skip transcription and note it in the summary
5. **Claude API key** in `.env` as `ANTHROPIC_API_KEY` (optional -- for visual analysis via Claude Haiku)

---

## Config

Read from CLAUDE.md:
```
Notion Swipe File Page ID: 38e3ef898c4e80ca82caf8c0ce5b7531
```

Resolver o database ID:
```
Use Notion MCP: search
  query: "Swipe File"
  filter: { property: "object", value: "database" }
```
Encontrar o resultado com title = "Swipe File". Guardar seu ID como `swipe_db_id`.
Se não encontrar → dizer ao usuário para rodar `/ad-poller` primeiro para criar a database.

---

## Step 1: Fetch Unanalyzed Ads

Check if the user passed a niche argument (e.g. `/ad-analyzer Moda`, `/ad-analyzer Beleza`, `/ad-analyzer Wellness`).

- **With niche argument:** filter by `Transcript is empty` AND `Video URL is not empty` AND `Nicho = "{niche}"`.
- **Without niche argument:** filter by `Transcript is empty` AND `Video URL is not empty`.

```
Use Notion MCP: query_database
  database_id: {swipe_db_id}
  filter (com niche):
    and:
      - property: "Transcript"  rich_text: { is_empty: true }
      - property: "Video URL"   url:       { is_not_empty: true }
      - property: "Nicho"       select:    { equals: "{niche}" }
  filter (sem niche):
    and:
      - property: "Transcript"  rich_text: { is_empty: true }
      - property: "Video URL"   url:       { is_not_empty: true }
  (paginar com next_cursor até has_more = false)
```

De cada resultado extrair:
- `page.id` → ID para update
- `properties.Name.title[0].plain_text` → Ad Archive ID
- `properties.Competitor.select.name` → Competitor
- `properties.Nicho.select.name` → Nicho
- `properties["Display Format"].select.name` → Display Format
- `properties["Video URL"].url` → Video URL
- `properties["Hook Copy"].rich_text[0].plain_text` → Hook Copy

Print count: `Found {N} unanalyzed ads to process (Nicho: {niche or "all"}).`

If the user also passed a count argument (e.g. `/ad-analyzer Moda 10`), limit to that many.

---

## Step 2: Process Video Ads

For each ad where Display Format = Video AND Video URL exists:

### 2a. Download Video
```bash
mkdir -p /tmp/ads-machine
curl -s -L -o /tmp/ads-machine/{ad_archive_id}.mp4 --max-time 60 "{video_url}"
```

If download fails, log it and continue to the next ad.

### 2b. Transcribe with Groq Whisper

**Primary: Groq API** (same Whisper model, ~18x cheaper than OpenAI, faster inference)

```bash
curl -s https://api.groq.com/openai/v1/audio/transcriptions \
  -H "Authorization: Bearer {GROQ_API_KEY}" \
  -F model="whisper-large-v3-turbo" \
  -F language="pt" \
  -F file="@/tmp/ads-machine/{ad_archive_id}.mp4"
```

**Fallback: OpenAI Whisper API**
```bash
curl -s https://api.openai.com/v1/audio/transcriptions \
  -H "Authorization: Bearer {OPENAI_API_KEY}" \
  -F model="whisper-1" \
  -F file="@/tmp/ads-machine/{ad_archive_id}.mp4"
```

If none is available, skip transcription. Log: `Whisper not available -- skipping transcription for {count} video ads.`

### 2c. Extract Hook
Split transcript on sentence boundaries (`. ! ?`). Take the first 1-2 complete sentences.
- If the first sentence is fewer than 8 words, include the second sentence.
- This becomes the `Hook Video` field.

### 2d. Clean Up
```bash
rm /tmp/ads-machine/{ad_archive_id}.mp4
```

---

## Step 3: Classify Angle Category

For every ad (video and non-video), classify based on available text content (body text + title + transcript).

### Signal Table

| Angle | Signals in Copy/Transcript |
|-------|---------------------------|
| Pain-to-Solution | Problem named (pain, discomfort, frustration) + product as fix; "finally found", "fixed my", "I struggled with" |
| Benefit/Result | Outcome-first framing: visible result, metric, or transformation promised or demonstrated |
| Education | How-to, ingredient explanation, tips, tutorials, "did you know", science-backed claims |
| Lifestyle/Aspiration | Identity, self-expression, aesthetic, "be the person who", fit/beauty/fashion as identity |
| Social Proof | Reviews, testimonials, "I've been using", UGC with results, influencer endorsement, ratings |
| Product Experience | Texture, sensation, sensory detail, unboxing, how it feels/looks/wears in use |
| Offer/Urgency | Discount, limited time, coupon code, "only X left", bundle deal, free gift |

If multiple signals match, choose the dominant one. If unclear, default to the first match.

---

## Step 4: Classify Ad Format Type (Beauty & Skincare)

| Format | Detection Rules |
|--------|----------------|
| GRWM Tutorial | Video + "get ready with me" framing, sequential routine, talking through steps while applying makeup/skincare |
| Product Application Close-Up | Video + close-up shot of product being applied to skin (fingers/applicator on face, hands, lips) |
| Texture/Swatch Close-Up | Video or image + macro shot of product texture, swatch on skin, no face needed |
| Before/After Comparison | Image or video + explicit split-screen or sequential before/after skin shots |
| UGC Testimonial | Video + first-person experience talking to camera about results ("my skin", "I noticed") |
| UGC Talking Head | Video + presenter explaining product benefits/ingredients, instructional, not necessarily applying it |
| Unboxing/Haul | Video + opening packaging, multiple products shown in sequence |
| Static Image | Image display format with real copy (product shot, flat lay, lifestyle) |
| Influencer/Dermatologist Review | Video + third-party expert or creator reviewing/endorsing the product |
| Slideshow | Carousel or multi-image format |
| Other | DCO with template variables `{{product.name}}` or unclassifiable |

---

## Step 5: Visual Analysis with Gemini (Optional)

If `GEMINI_API_KEY` is in `.env`, run visual analysis using **Gemini 1.5 Flash** (`gemini-2.5-flash`). Gemini processes full video files natively — no frame extraction needed.

**Cost:** ~$0.075 per hour of video. A 30s ad costs ~$0.001. Processing 118 video ads costs ~$0.10 total.

### For video ads (Display Format = Video)

Download the video to a temp file, upload to Gemini File API, then analyze:

**Step 5a — Upload video to Gemini File API:**
```bash
curl -s -X POST \
  "https://generativelanguage.googleapis.com/upload/v1beta/files?key={GEMINI_API_KEY}" \
  -H "X-Goog-Upload-Protocol: multipart" \
  -F "metadata={mimeType:'video/mp4'};type=application/json" \
  -F "file=@/tmp/ads-machine/{ad_archive_id}.mp4;type=video/mp4"
```

Extract `file.uri` from the response.

**Step 5b — Analyze with Gemini:**
```json
{
  "model": "gemini-2.5-flash",
  "contents": [{
    "parts": [
      { "fileData": { "mimeType": "video/mp4", "fileUri": "{file_uri}" } },
      { "text": "Analyze this beauty/skincare video ad. Respond in 6 short lines:\n1. Visual format (GRWM tutorial / product application close-up / texture macro / before-after / talking head / flat lay / other)\n2. Lighting: Natural/Organic OR Studio/Ring Light OR Mixed — explain why in one sentence\n3. Skin focus: realistic texture visible OR stylized/filtered\n4. Color palette (2-3 words)\n5. Production quality: Professional studio / Semi-pro creator / Casual UGC\n6. Key attention element (what grabs the eye first)" }
    ]
  }]
}
```

**Step 5c — Delete the file from Gemini after analysis** (files are billed by storage too):
```bash
curl -s -X DELETE \
  "https://generativelanguage.googleapis.com/v1beta/{file_name}?key={GEMINI_API_KEY}"
```

### For image ads (Display Format = Image)

Pass the image URL directly — no upload needed:
```json
{
  "model": "gemini-2.5-flash",
  "contents": [{
    "parts": [
      { "imageUrl": { "url": "{image_url}" } },
      { "text": "Analyze this beauty/skincare image ad. Respond in 6 short lines:\n1. Visual format\n2. Lighting: Natural/Organic OR Studio/Ring Light OR Mixed\n3. Skin focus: realistic texture visible OR stylized/filtered\n4. Color palette (2-3 words)\n5. Production quality: Professional studio / Semi-pro creator / Casual UGC\n6. Key attention element" }
    ]
  }]
}
```

Store each response in the `Visual Style` field. Lead with the lighting classification — UGC-style natural lighting tends to outperform polished studio shots in this niche.

If `GEMINI_API_KEY` is not configured, skip this step silently.

---

## Step 6: Calculate Longevity Tier

Days Active IS the grade. No composite scoring. The market already graded every ad.

```python
from datetime import date

today = date.today()
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

ad.days_active = days
ad.longevity_tier = tier
```

Format, angle, hook, CTA type are FILTERS for browsing -- not scoring factors. A static image running 90 days outranks a video killed in 3. "Show me all Long-Runners with social proof angle" is how you find patterns.

---

## Step 7: Update Notion Records

Atualizar cada page individualmente:

```
Use Notion MCP: update_page
  page_id: {page.id do Step 1}
  properties:
    "Transcript":      { rich_text: [{ text: { content: transcript } }] }     ← se vídeo + whisper
    "Hook Copy":       { rich_text: [{ text: { content: hook } }] }           ← se extraído
    "Angle Category":  { select: { name: angle_category } }
    "Visual Style":    { rich_text: [{ text: { content: visual_analysis } }] } ← se Gemini
    "Days Active":     { number: days_active }
    "Longevity Tier":  { select: { name: tier } }
    "Pipeline Status": { select: { name: "Ready" } }
```

Atenção: rich_text tem limite de 2000 caracteres por item. Se o transcript for maior, dividir em chunks de 2000 chars (até 100 items por propriedade).

---

## Step 8: Feed Proven Hooks Database

After updating all ads, extract hooks from Long-Runners and push to the Proven Hooks table.

```
Read from CLAUDE.md:
  Proven Hooks Table: YOUR_PROVEN_HOOKS_TABLE_ID
```

For each ad where:
- `Longevity Tier` = `Long-Runner` OR `Performer` (30d+)
- Hook exists (Hook Video or Hook Copy is not empty)
- Hook is not already in the Proven Hooks table (dedup on Hook Text)

Create a record:
```
Use Airtable MCP: create_record
  base_id: {Airtable Base ID from CLAUDE.md}
  table_id: {Proven Hooks Table from CLAUDE.md}
  fields: {
    Hook Text: {hook_video or hook_copy},
    Source Competitor: {competitor name},
    Source Ad: {ad library url},
    Angle Category: {angle},
    Format: {display format},
    Days Active: {days},
    Longevity Tier: {tier},
    Niche Tier: {competitor's niche tier from Competitors table},
    Date Added: {today}
  }
```

Note: Proven Hooks table still uses Airtable. Skip this step if Airtable MCP is not connected.

This runs silently. No user interaction. The Proven Hooks table grows automatically every time the analyzer processes new Long-Runners.

After a month of daily polling with 5+ competitors, the user will have 100+ proven hooks searchable by angle, format, and competitor -- all backed by real ad spend data.

---

## Step 9: Print Summary

```
=== Analysis Complete ===

Ads processed: {total}
  Videos transcribed: {transcribed}
  Visuals analyzed: {visual_count}
  Skipped (no media): {skipped}

By angle:
  Pain-to-Solution: {count}
  Benefit/Result: {count}
  Education: {count}
  Lifestyle/Aspiration: {count}
  Social Proof: {count}
  Product Experience: {count}
  Offer/Urgency: {count}

By format:
  UGC Talking Head: {count}
  UGC Testimonial: {count}
  Static Image: {count}
  ...

Longevity breakdown:
  Long-Runners (60d+): {count} -- PROVEN WINNERS
  Performers (30-59d): {count}
  Solid (14-29d): {count}
  Testing (7-13d): {count}
  Killed (<7d): {count}

Top 5 longest-running ads:
  1. [{days}d] {competitor} -- "{hook}" ({angle}, {format})
  2. ...

Next step: Run /ad-swipe to browse your swipe file, or /ad-ideator to generate variations from winners.
```

---

## Step 9: Feed Proven Hooks to Reference File

After analysis, extract hooks from Long-Runner ads (60d+) and append them to `reference/hook-swipe-file.md`.

**Why this matters:** Aspirational competitors (Hormozi, Brunson, etc.) test 100-200 ads at a time with massive budgets. The hooks that survive 60+ days are battle-tested winners. By scraping their ads and extracting Long-Runner hooks, you're harvesting millions of dollars of A/B testing for free.

### Process

1. Filter all newly analyzed ads where `Longevity Tier = Long-Runner` AND hook exists (Hook Video or Hook Copy)
2. Read current `reference/hook-swipe-file.md`
3. For each Long-Runner hook:
   - Check it's not already in the file (dedup by rough similarity -- don't add near-duplicates)
   - Determine which angle category it belongs to (from the ad's Angle Category field)
   - Append it under the correct section with attribution:
     ```
     - "{hook text}" -- [{competitor}, {days}d, {format}]
     ```
4. Write the updated file

### Rules
- Only Long-Runners (60d+). Anything shorter hasn't proven itself yet.
- Include the competitor name and days active as attribution so you know the source and strength.
- Aspirational tier competitors are HOOK FARMS -- they test at volume so you don't have to. Prioritize their Long-Runners.
- Direct competitors' Long-Runners are equally valuable -- they've proven the hook works in YOUR niche.
- The file grows over time. After a few months of daily polling, you'll have hundreds of proven hooks organized by angle.

---

## CRITICAL RULES

1. **Process ads one at a time** for video download/transcription. Clean up files after each.
2. **Never fail the whole batch** because one ad fails. Log the error and continue.
3. **Groq Whisper** (`whisper-large-v3-turbo`) is the default transcription model. Send `.mp4` directly -- no audio extraction needed. Fallback: OpenAI Whisper API.
4. **Hook extraction:** Split on sentence boundaries, not word count. Take first 1-2 complete sentences.
5. **Notion updates são um page por vez.** Sem batch update API. Processar sequencialmente.
6. **DCO ads have no media.** Still classify them from body text and title.
7. **Days Active is the grade.** No composite scoring. If an ad ran 60+ days, someone kept paying for it -- that's a proven winner regardless of how the creative looks to you.
8. **Gemini visual analysis is optional.** The system works without it. Do not error if the key is missing.
9. **Gemini processes full video files** via the File API. Upload → analyze → delete. Always delete after analysis to avoid storage charges.
10. **Groq rate limit:** 7,200 audio seconds/hour on the free tier. With ~30s ads, that's ~240 videos/hour. If you hit the limit, pause and retry after 60s.
11. **Gemini rate limit:** 1,000 requests/minute on the paid tier. No issue for this use case.
