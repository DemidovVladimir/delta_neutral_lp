/**
 * pair-candles.ts — build a simulator candle cache for ANY DLMM pair from
 * GeckoTerminal 1m pool OHLCV (the BACKLOG A20 recipe, made durable).
 *
 * The Rust simulator reads `simulator/data/SOLUSDC_1m_<startMs>_<endMs>.csv`
 * keyed by the EXACT window. For non-SOL/USDC pairs we write pool prices
 * (base priced in quote, e.g. HYPE in SOL) into that cache format, scaled
 * to a SOL-like level so position sizing in USD stays meaningful.
 *
 * ⚠ Files written by this script are NOT real SOL/USDC data. Never reuse
 * their exact (startMs,endMs) keys for real-Binance runs. Tell them apart:
 * GT-derived files start with a flat/normalized close (75.000000) or carry
 * O=H=L=C gap-fill rows.
 *
 * Modes (exactly one):
 *   --normalize <price>   first close → price (fresh window, e.g. 75)
 *   --scale <k>           explicit multiplier on raw pool price
 *   --splice <master.csv> extend an existing cache: k is derived so the raw
 *                         close at the master's last minute matches the
 *                         master, then [from,to) continues seamlessly.
 *                         --from must equal the master's end minute.
 *
 * Usage:
 *   npx tsx scripts/pair-candles.ts --pool <address> --from <ISO> --to <ISO> \
 *     (--normalize 75 | --scale <k> | --splice simulator/data/<master>.csv) \
 *     [--network solana] [--out <path>] [--force]
 *
 * Gap-fill is flat (pool price IS flat between swaps). Prints coverage so
 * you can judge how tradeless the pair is.
 */

import * as fs from 'fs';
import * as path from 'path';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(name);

const pool = arg('--pool');
const network = arg('--network') ?? 'solana';
const fromIso = arg('--from');
const toIso = arg('--to');
if (!pool || !fromIso || !toIso) {
  console.error('required: --pool <address> --from <ISO> --to <ISO>');
  process.exit(1);
}
const fromMs = Date.parse(fromIso);
const toMs = Date.parse(toIso);
if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs % 60_000 || toMs % 60_000 || fromMs >= toMs) {
  console.error('--from/--to must be valid ISO times on minute boundaries, from < to');
  process.exit(1);
}

const modes = ['--normalize', '--scale', '--splice'].filter((m) => has(m));
if (modes.length !== 1) {
  console.error('exactly one of --normalize <price> | --scale <k> | --splice <master.csv>');
  process.exit(1);
}

type Candle = { ms: number; o: number; h: number; l: number; c: number };

async function fetchWindow(startMs: number, endMs: number): Promise<Map<number, Candle>> {
  const out = new Map<number, Candle>();
  let before = Math.floor(endMs / 1000);
  const floorSec = Math.floor(startMs / 1000);
  for (let page = 0; page < 200; page++) {
    const url =
      `https://api.geckoterminal.com/api/v2/networks/${network}/pools/${pool}/ohlcv/minute` +
      `?aggregate=1&limit=1000&currency=token&before_timestamp=${before}`;
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (res.status === 429) {
      console.error(`  429 rate-limited, sleeping 65s (page ${page})`);
      await new Promise((r) => setTimeout(r, 65_000));
      page--;
      continue;
    }
    if (!res.ok) throw new Error(`GT ${res.status}: ${await res.text()}`);
    const json: any = await res.json();
    const rows: number[][] = json?.data?.attributes?.ohlcv_list ?? [];
    if (!rows.length) break;
    let oldest = Infinity;
    for (const [ts, o, h, l, c] of rows) {
      oldest = Math.min(oldest, ts);
      const ms = ts * 1000;
      if (ms >= startMs && ms < endMs) out.set(ms, { ms, o, h, l, c });
    }
    if (oldest <= floorSec) break;
    before = oldest;
    await new Promise((r) => setTimeout(r, 2500)); // free tier ~30 calls/min
  }
  return out;
}

(async () => {
  // For --splice we also need the raw candle at the master's LAST minute, so
  // fetch one extra hour of overlap before `from`.
  const splicePath = arg('--splice');
  const overlapMs = splicePath ? 60 * 60_000 : 0;
  console.error(`fetching GT ${network}/${pool} 1m, ${new Date(fromMs - overlapMs).toISOString()} → ${new Date(toMs).toISOString()}`);
  const raw = await fetchWindow(fromMs - overlapMs, toMs);
  console.error(`  ${raw.size} raw candles`);
  if (!raw.size) throw new Error('no candles returned — wrong pool/window?');

  let k: number;
  let seedRaw: number | undefined; // RAW flat-fill value for minutes before the first raw candle
  if (splicePath) {
    const master = fs.readFileSync(splicePath, 'utf8').trim().split('\n');
    const last = master[master.length - 1].split(',');
    const masterEndMs = Number(last[0]) + 60_000;
    const masterClose = Number(last[4]);
    if (masterEndMs !== fromMs) throw new Error(`--from (${fromMs}) must equal master end (${masterEndMs})`);
    // nearest raw close at or before the master's last minute
    let rawClose: number | undefined;
    for (let ms = Number(last[0]); ms >= fromMs - overlapMs; ms -= 60_000) {
      const c = raw.get(ms);
      if (c) { rawClose = c.c; break; }
    }
    if (rawClose === undefined) throw new Error('no raw candle in the overlap hour — extend overlap');
    k = masterClose / rawClose;
    seedRaw = rawClose; // ×k reproduces the master's last close exactly
    console.error(`  splice k = ${k} (master close ${masterClose} / raw ${rawClose})`);
  } else if (has('--scale')) {
    k = Number(arg('--scale'));
  } else {
    const firstMs = [...raw.keys()].filter((ms) => ms >= fromMs).sort((a, b) => a - b)[0];
    k = Number(arg('--normalize')) / raw.get(firstMs)!.c;
    console.error(`  normalize k = ${k}`);
  }

  const lines: string[] = [];
  let prevRaw = seedRaw; // always RAW; every emitted value is raw × k
  let real = 0;
  for (let ms = fromMs; ms < toMs; ms += 60_000) {
    const c = raw.get(ms);
    if (c) {
      lines.push(`${ms},${(c.o * k).toFixed(6)},${(c.h * k).toFixed(6)},${(c.l * k).toFixed(6)},${(c.c * k).toFixed(6)}`);
      prevRaw = c.c;
      real++;
    } else {
      if (prevRaw === undefined) {
        // before the first trade of a fresh window: seed with the first real candle's open
        const firstMs = [...raw.keys()].filter((m) => m >= fromMs).sort((a, b) => a - b)[0];
        prevRaw = raw.get(firstMs)!.o;
      }
      const v = (prevRaw * k).toFixed(6);
      lines.push(`${ms},${v},${v},${v},${v}`);
    }
  }

  const out = arg('--out') ?? path.join('simulator', 'data', `SOLUSDC_1m_${fromMs}_${toMs}.csv`);
  if (fs.existsSync(out) && !has('--force')) throw new Error(`${out} exists — pass --force to overwrite`);
  fs.writeFileSync(out, lines.join('\n') + '\n');
  console.error(`wrote ${out}: ${lines.length} rows, ${real} real (${((real / lines.length) * 100).toFixed(1)}% traded), first close ${lines[0].split(',')[4]}, last close ${lines[lines.length - 1].split(',')[4]}`);
})();
