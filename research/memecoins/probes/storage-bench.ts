// Bench: bytes/row for candidate trade-table layouts (synthetic rows, realistic field widths).
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import bs58 from 'bs58';
import fs from 'node:fs';
const dir = process.argv[2]; const N = 200_000;
const rnd = (n: number) => bs58.encode(crypto.randomBytes(n));
const mints = Array.from({ length: 3000 }, () => rnd(32)); const traders = Array.from({ length: 40000 }, () => rnd(32));
const layouts: Record<string, string> = {
  text_pk: `CREATE TABLE t(sig TEXT, idx INT, slot INT, ts INT, venue INT, mint TEXT, trader TEXT, is_buy INT, sol INT, tok INT, vsol INT, vtok INT, fee INT, PRIMARY KEY(sig, idx)) WITHOUT ROWID; CREATE INDEX i1 ON t(mint, slot);`,
  text_uidx: `CREATE TABLE t(sig TEXT, idx INT, slot INT, ts INT, venue INT, mint TEXT, trader TEXT, is_buy INT, sol INT, tok INT, vsol INT, vtok INT, fee INT, UNIQUE(sig, idx)); CREATE INDEX i1 ON t(mint, slot);`,
  dict_hash: `CREATE TABLE k(id INTEGER PRIMARY KEY, pk TEXT UNIQUE); CREATE TABLE t(sig TEXT, idx INT, slot INT, ts INT, venue INT, mint_id INT, trader_id INT, is_buy INT, sol INT, tok INT, vsol INT, vtok INT, fee INT, uid INT UNIQUE); CREATE INDEX i1 ON t(mint_id, slot);`,
};
for (const [name, ddl] of Object.entries(layouts)) {
  const f = `${dir}/${name}.db`; try { fs.rmSync(f); } catch {}
  const db = new Database(f); db.exec(ddl);
  const dict = name === 'dict_hash'; const ids = new Map<string, number>();
  const kid = (p: string) => { let i = ids.get(p); if (!i) { i = ids.size + 1; ids.set(p, i); db.prepare('INSERT INTO k(id, pk) VALUES (?, ?)').run(i, p); } return i; };
  const ins = dict ? db.prepare('INSERT INTO t VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)') : db.prepare('INSERT INTO t VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
  let slot = 450_000_000;
  db.transaction(() => { for (let i = 0; i < N; i++) {
    if (i % 300 === 0) slot++;
    const sig = rnd(64), m = mints[Math.floor(Math.random() ** 3 * mints.length)], tr = traders[Math.floor(Math.random() * traders.length)];
    const vals = [sig, 0, slot, 1790333748 + (i >> 10), 1, m, tr, i & 1, 100_000_000 + i * 7, 23948133465066 + i, 40304243480 + i, 798675220803510 - i, 1114666 + i];
    if (dict) { vals[5] = kid(m); vals[6] = kid(tr); vals.push(crypto.createHash('sha256').update(sig + ':0').digest().readBigInt64LE(0)); }
    ins.run(...vals);
  } })();
  db.close();
  console.log(name, 'bytes/row', Math.round(fs.statSync(f).size / N));
}
