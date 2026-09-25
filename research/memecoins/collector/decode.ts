/**
 * IDL-driven Anchor event decoder for pump.fun (6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P)
 * and PumpSwap (pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA).
 *
 * Events arrive as `Program data: <base64>` log lines (anchor `emit!`) and, in full
 * transactions, as self-CPI inner instructions (anchor `emit_cpi!`: 8-byte
 * EVENT_IX_TAG e445a52e51cb9a1d + 8-byte event discriminator + borsh body).
 *
 * The programs append fields over time, so decoding is sequential and TOLERANT:
 * when the buffer ends, the remaining fields are simply absent (older events).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bs58 from 'bs58';

export const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
export const PUMP_AMM_PROGRAM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
export const WSOL_MINT = 'So11111111111111111111111111111111111111112';
export const EVENT_IX_TAG = 'e445a52e51cb9a1d';

type IdlType = string | { vec?: IdlType; option?: IdlType; array?: [IdlType, number]; defined?: { name: string } };
interface IdlField { name: string; type: IdlType }
interface Layout { name: string; program: 'pump' | 'amm'; fields: IdlField[] }

const here = path.dirname(fileURLToPath(import.meta.url));
const idlDir = path.resolve(here, '..', 'idl');

// program -> (discriminator hex -> layout). Keyed per program: the two IDLs share some discriminators.
const layouts: Record<'pump' | 'amm', Map<string, Layout>> = { pump: new Map(), amm: new Map() };
const typeDefs = new Map<string, IdlField[]>(); // struct name -> fields (per program; names are compatible)

function loadIdl(file: string, program: 'pump' | 'amm') {
  const idl = JSON.parse(fs.readFileSync(path.join(idlDir, file), 'utf8'));
  for (const t of idl.types ?? []) {
    if (t.type?.kind === 'struct' && Array.isArray(t.type.fields)) {
      const key = `${program}.${t.name}`;
      typeDefs.set(key, t.type.fields);
    }
  }
  for (const e of idl.events ?? []) {
    const fields = typeDefs.get(`${program}.${e.name}`);
    if (!fields) continue;
    layouts[program].set(Buffer.from(e.discriminator).toString('hex'), { name: e.name, program, fields });
  }
}
loadIdl('pump.json', 'pump');
loadIdl('pump_amm.json', 'amm');

class Reader {
  o = 0;
  constructor(public b: Buffer) {}
  left() { return this.b.length - this.o; }
  need(n: number) { if (this.left() < n) throw new EndOfData(); }
}
class EndOfData extends Error {}

function readType(r: Reader, t: IdlType, program: 'pump' | 'amm'): unknown {
  if (typeof t === 'string') {
    switch (t) {
      case 'pubkey': { r.need(32); const v = bs58.encode(r.b.subarray(r.o, r.o + 32)); r.o += 32; return v; }
      case 'u64': { r.need(8); const v = r.b.readBigUInt64LE(r.o); r.o += 8; return v; }
      case 'i64': { r.need(8); const v = r.b.readBigInt64LE(r.o); r.o += 8; return v; }
      case 'u128': case 'i128': {
        r.need(16); const lo = r.b.readBigUInt64LE(r.o); const hi = t === 'i128' ? r.b.readBigInt64LE(r.o + 8) : r.b.readBigUInt64LE(r.o + 8);
        r.o += 16; return (hi << 64n) + lo;
      }
      case 'u32': { r.need(4); const v = r.b.readUInt32LE(r.o); r.o += 4; return v; }
      case 'i32': { r.need(4); const v = r.b.readInt32LE(r.o); r.o += 4; return v; }
      case 'u16': { r.need(2); const v = r.b.readUInt16LE(r.o); r.o += 2; return v; }
      case 'u8': { r.need(1); const v = r.b.readUInt8(r.o); r.o += 1; return v; }
      case 'i8': { r.need(1); const v = r.b.readInt8(r.o); r.o += 1; return v; }
      case 'bool': { r.need(1); const v = r.b.readUInt8(r.o) !== 0; r.o += 1; return v; }
      case 'string': {
        r.need(4); const n = r.b.readUInt32LE(r.o); r.o += 4; r.need(n);
        const v = r.b.subarray(r.o, r.o + n).toString('utf8'); r.o += n; return v;
      }
      default: throw new Error(`unsupported idl type ${t}`);
    }
  }
  if (t.vec) {
    r.need(4); const n = r.b.readUInt32LE(r.o); r.o += 4;
    if (n > 10_000) throw new Error('vec too long');
    const out: unknown[] = []; for (let i = 0; i < n; i++) out.push(readType(r, t.vec, program)); return out;
  }
  if (t.option) { r.need(1); const tag = r.b.readUInt8(r.o); r.o += 1; return tag ? readType(r, t.option, program) : null; }
  if (t.array) { const out: unknown[] = []; for (let i = 0; i < t.array[1]; i++) out.push(readType(r, t.array[0], program)); return out; }
  if (t.defined) {
    const fields = typeDefs.get(`${program}.${t.defined.name}`);
    if (!fields) throw new Error(`unknown defined type ${t.defined.name}`);
    const o: Record<string, unknown> = {};
    for (const f of fields) o[f.name] = readType(r, f.type, program);
    return o;
  }
  throw new Error('bad idl type');
}

export interface DecodedEvent { name: string; program: 'pump' | 'amm'; data: Record<string, any>; complete: boolean }

/** Decode an event body (8-byte discriminator + borsh) emitted by `program`. Null if unknown. */
export function decodeEvent(buf: Buffer, program: 'pump' | 'amm'): DecodedEvent | null {
  if (buf.length < 8) return null;
  const layout = layouts[program].get(buf.subarray(0, 8).toString('hex'));
  if (!layout) return null;
  const r = new Reader(buf.subarray(8));
  const data: Record<string, any> = {};
  let complete = true;
  for (const f of layout.fields) {
    try { data[f.name] = readType(r, f.type, layout.program); } catch (e) {
      if (e instanceof EndOfData) { complete = false; break; }
      throw e;
    }
  }
  return { name: layout.name, program: layout.program, data, complete };
}

/** Decode a `Program data: <b64>` log line emitted by `program`; null if not an event we know. */
export function decodeLogLine(line: string, program: 'pump' | 'amm'): DecodedEvent | null {
  if (!line.startsWith('Program data: ')) return null;
  let buf: Buffer;
  try { buf = Buffer.from(line.slice(14), 'base64'); } catch { return null; }
  return decodeEvent(buf, program);
}

export function programTag(programId: string): 'pump' | 'amm' | null {
  return programId === PUMP_PROGRAM ? 'pump' : programId === PUMP_AMM_PROGRAM ? 'amm' : null;
}

const INVOKE_RE = /^Program ([1-9A-HJ-NP-Za-km-z]{32,44}) invoke \[\d+\]$/;
const EXIT_RE = /^Program ([1-9A-HJ-NP-Za-km-z]{32,44}) (success|failed)/;

/**
 * Extract pump/PumpSwap events from a transaction's log messages, in execution order.
 * Tracks the invoke stack so that a `Program data:` line is only accepted when it was
 * emitted by the pump or PumpSwap program itself (another program printing a look-alike
 * event line is ignored). `truncated` = the runtime cut the log (events may be missing).
 */
export function extractLogEvents(logs: string[]): { events: DecodedEvent[]; truncated: boolean } {
  const stack: string[] = [];
  const events: DecodedEvent[] = [];
  let truncated = false;
  for (const l of logs) {
    if (l.startsWith('Program data: ')) {
      const tag = programTag(stack[stack.length - 1] ?? '');
      if (tag) { const e = decodeLogLine(l, tag); if (e) events.push(e); }
      continue;
    }
    if (l.startsWith('Log truncated')) { truncated = true; continue; }
    const inv = INVOKE_RE.exec(l);
    if (inv) { stack.push(inv[1]); continue; }
    if (EXIT_RE.test(l)) { stack.pop(); continue; }
  }
  return { events, truncated };
}

/** Decode a self-CPI event instruction payload (base58 instruction data from getTransaction). */
export function decodeCpiEventIx(dataB58: string, program: 'pump' | 'amm'): DecodedEvent | null {
  let buf: Buffer;
  try { buf = Buffer.from(bs58.decode(dataB58)); } catch { return null; }
  if (buf.length < 16 || buf.subarray(0, 8).toString('hex') !== EVENT_IX_TAG) return null;
  return decodeEvent(buf.subarray(8), program);
}

/** Minimal shape of a `getTransaction`/`getTransactionsForAddress` (encoding json) result. */
export interface RpcTx {
  slot: number; blockTime?: number | null; transactionIndex?: number;
  transaction: { signatures: string[]; message: { accountKeys: string[] } };
  meta: { err: unknown; logMessages?: string[] | null; loadedAddresses?: { writable: string[]; readonly: string[] } | null;
    innerInstructions?: { index: number; instructions: { programIdIndex: number; data: string }[] }[] | null } | null;
}

/** Extract events from a full transaction: the log path, or the self-CPI path when logs were truncated. */
export function extractTxEvents(tx: RpcTx): { events: DecodedEvent[]; truncated: boolean; via: 'logs' | 'cpi' } {
  const logs = tx.meta?.logMessages ?? [];
  const fromLogs = extractLogEvents(logs);
  if (!fromLogs.truncated) return { ...fromLogs, via: 'logs' };
  const keys = [...tx.transaction.message.accountKeys, ...(tx.meta?.loadedAddresses?.writable ?? []), ...(tx.meta?.loadedAddresses?.readonly ?? [])];
  const events: DecodedEvent[] = [];
  const groups = [...(tx.meta?.innerInstructions ?? [])].sort((a, b) => a.index - b.index);
  for (const g of groups) for (const ix of g.instructions) {
    const tag = programTag(keys[ix.programIdIndex] ?? '');
    if (!tag) continue;
    const e = decodeCpiEventIx(ix.data, tag);
    if (e) events.push(e);
  }
  return { events, truncated: true, via: 'cpi' };
}

/** (sig:idx) keys of the trade events of a full tx, with venue — the dedupe identity used by the store. */
export function tradeEventKeys(tx: RpcTx): { key: string; venue: 0 | 1 }[] {
  const sig = tx.transaction.signatures[0];
  const out: { key: string; venue: 0 | 1 }[] = []; let idx = 0;
  for (const e of extractTxEvents(tx).events) {
    if (e.program === 'pump' && e.name === 'TradeEvent') out.push({ key: `${sig}:${idx++}`, venue: 0 });
    else if (e.program === 'amm' && (e.name === 'BuyEvent' || e.name === 'SellEvent')) out.push({ key: `${sig}:${idx++}`, venue: 1 });
  }
  return out;
}

export const KNOWN_EVENTS = [...layouts.pump.values(), ...layouts.amm.values()].map(l => `${l.program}.${l.name}`);
