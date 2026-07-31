# Sources and provenance

Playlist `PL4PwY0m4Tbqtfd8GsvrXzUim5D6Gu_Hyp` (Meteora "LP Army" bootcamps).
Transcripts were auto-generated YouTube captions, deduplicated from VTT and
mined by one extraction agent per session on 2026-07-28.

## Transcribed and mined (14)

| # | video id | session |
|---|---|---|
| 2 | `kw5K2CCC_HA` | LP Army Bootcamp #12 — February — Day 2 |
| 3 | `UgN3mS7rqgU` | Meteora LP Army Bootcamp #11 — January — Day 1 |
| 5 | `jeWsa9LNsQs` | LP Army Bootcamp — Español #1 — Día 1 |
| 6 | `oXcqFhZ1BWE` | LP Army Bootcamp #10 — December — Day 2 |
| 7 | `r-lZxHdaFOI` | LP Army Bootcamp #10 — December — Day 1 |
| 8 | `Q-kDde-lcDw` | LP Army **ADVANCED** Bootcamp #1 — Pool Creation |
| 9 | `srlsLSlyrpA` | LP Army Bootcamp #9 — November — Day 2 |
| 10 | `bpBTyks8_a0` | LP Army Bootcamp — Day 1 |
| 11 | `28i6TA5UpxU` | LP Army Bootcamp — Day 2 |
| 12 | `PzjK3M3Cwx0` | LP Army Bootcamp — Day 1 |
| 13 | `WLQy_tlo3ME` | LP Army Bootcamp — Day 2 (tools, safety, shapes, live position) |
| 14 | `hltVa_1lMQ8` | LP Army Bootcamp — Day 1 (DLMM fundamentals, platform tour) |
| 15 | `RdO2tiTuqow` | LP Army Bootcamp — Day 2 |
| 16 | `PcEMcQUdb8s` | LP Army Bootcamp — Day 1 (platform tour, fees, bins, strategies) |

Recurring instructors: "heavy metal cook", Chief, Mario, Goa, GeekLad, Alex,
Otter, Yousef, Hugo. Where they disagree, `disagreements.md` records both
positions.

The **ADVANCED** session (`Q-kDde-lcDw`) is the single most valuable one for
this project: it is the only session giving per-configuration dynamic-fee
ceilings, the full rent/cost breakdown, and the blue-chip "depth beats fee
tier" argument.

## Missing (1)

| # | video id | session | why |
|---|---|---|---|
| 4 | `nyHSuqW8iGY` | LP Army Bootcamp — Español #1 — Día 2 | **No retrievable caption track.** YouTube returns an empty response for every language and format tried (`en`, `es`, `es-orig`, auto and manual, `vtt`/`json3`/`srv3`), and `--list-subs` reports nothing available. Not a rate limit — the sibling Día 1 video downloaded normally in the same run. |

Impact is unquantified but likely small: the Spanish Day 1 session tracked the
English curriculum closely, so Día 2 probably duplicates English Day 2 material
that IS covered here. If it ever becomes retrievable, re-run the extraction and
merge it in rather than assuming coverage.

## Method

1. Captions downloaded with `yt-dlp` into an isolated virtualenv (the public
   `timedtext` endpoint now returns empty bodies, so direct fetching fails).
2. VTT converted to plain timestamped text with rolling-window deduplication.
3. One extraction agent per transcript, schema-constrained, instructed to
   restate every claim in its own words, preserve all numbers verbatim, record
   instructor disagreements separately, and skip songs/banter/administrivia.
4. One merge agent deduplicated 830 raw items into 10 topic sections with
   strength labels and a numeric index.
5. Claims touching our own pools were then checked against on-chain state and
   `data/pnl.db` — see SKILL.md section 1. Where measurement and video
   disagree, measurement wins.
