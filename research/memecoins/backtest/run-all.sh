#!/bin/bash
# Public-tape futility pilot, end to end. Run from the repo root, in the background:
#   nohup bash research/memecoins/backtest/run-all.sh [fromStart|strict] [guard|drop] > research/memecoins/results/raw/run-all.log 2>&1 &
# Steps: (1) convert the van de Wouw SQLite into the canonical cache (once), (2) descriptive baselines,
# (3) signal hypotheses (one process), (4) filters, (5) H13, (6) tables + verdicts.
set -u
G1=${1:-fromStart}
G5=${2:-guard}
ROOT=research/memecoins
DB=$ROOT/data/public/pumpfun_database.db
CACHE=$ROOT/data/public/cache/vdw
RAW=$ROOT/results/raw
NODE="node --max-old-space-size=10000 --import tsx"
mkdir -p "$RAW"
if [ ! -f "$CACHE/meta.json" ]; then
  echo "[$(date -u +%T)] converting $DB"
  $NODE $ROOT/backtest/adapters/vdw.ts --db=$DB --out=$CACHE || exit 1
fi
echo "[$(date -u +%T)] baselines"
$NODE $ROOT/backtest/baselines.ts --tape=$CACHE --g1=$G1 --g5=$G5 > $RAW/baselines.$G1.log 2>&1
echo "[$(date -u +%T)] hypotheses"
$NODE $ROOT/backtest/run-futility.ts --tape=$CACHE --g1=$G1 --g5=$G5 --only=H01,H02,H03,H04,H05,H06,H08,H09,H10,H17,H07 > $RAW/futility.$G1.$G5.log 2>&1
echo "[$(date -u +%T)] filters + H13"
$NODE $ROOT/backtest/run-filters.ts --tape=$CACHE --g1=$G1 --g5=$G5 > $RAW/filters.$G1.$G5.log 2>&1
$NODE $ROOT/backtest/h13.ts --tape=$CACHE --g1=$G1 --g5=$G5 > $RAW/h13.$G1.$G5.log 2>&1
SUF=".$G1.$G5"
npx tsx $ROOT/backtest/make-report.ts --raw=$RAW --suffix=$SUF
echo "[$(date -u +%T)] all done"
