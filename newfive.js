'use strict';

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const WebSocket = require('ws');

if (!isMainThread) {
  const { workerId, clobTokenIds, tokenToOutcome, sharedBuffer, slotMap } = workerData;

  const SLOTS = 3;
  const f64   = new Float64Array(sharedBuffer);

  function writeSharedBuffer(assetId, ask, bid) {
    const slot = slotMap[assetId];
    if (slot === undefined) return;
    const base = slot * SLOTS;
    f64[base + 0] = ask;
    f64[base + 1] = bid;
    f64[base + 2] = Date.now();
  }

  function postTick(assetId, ask, bid, latencyMs) {
    parentPort.postMessage({ type: 'tick', assetId, ask, bid, latencyMs, workerId });
  }

  async function poll() {
    for (const id of clobTokenIds) {
      try {
        const t0 = Date.now();
        const r = await fetch(`https://clob.polymarket.com/price?token_id=${id}`);
        if (!r.ok) continue;
        const d = await r.json();
        const mid = parseFloat(d.price || 0);
        if (mid <= 0) continue;
        const slot = slotMap[id];
        const prevAsk = f64[slot * SLOTS];
        const latencyMs = Date.now() - t0;
        writeSharedBuffer(id, mid, prevAsk > 0 ? prevAsk * 0.999 : 0);
        postTick(id, mid, prevAsk > 0 ? prevAsk * 0.999 : 0, latencyMs);
      } catch {}
    }
  }

  setInterval(poll, 3000 + workerId * 700);

  function connect() {
    const ws = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/market');

    ws.on('open', () => {
      ws.send(JSON.stringify({
        assets_ids: clobTokenIds,
        type: 'market',
        custom_feature_enabled: true,
      }));
    });

    ws.on('message', (raw) => {
      try {
        const recvTime = Date.now();
        const msg = JSON.parse(raw.toString());
        const topTs = msg.timestamp ? parseInt(msg.timestamp) : null;
        for (const c of (msg.price_changes || [])) {
          const assetId = c.asset_id;
          if (!assetId || slotMap[assetId] === undefined) continue;
          const ask = parseFloat(c.best_ask || 0);
          const bid = parseFloat(c.best_bid || 0);
          if (ask <= 0 && bid <= 0) continue;
          const serverTs = c.timestamp ? parseInt(c.timestamp) : topTs;
          const lat = (serverTs && Math.abs(recvTime - serverTs) < 30000)
            ? recvTime - serverTs
            : null;
          writeSharedBuffer(assetId, ask || 0, bid || 0);
          postTick(assetId, ask || 0, bid || 0, lat);
        }
      } catch {}
    });

    ws.on('close', () => setTimeout(connect, 3000 + Math.random() * 2000));
    ws.on('error', () => {});
  }

  connect();
  setInterval(() => {}, 60000);
  return;
}

const slug = process.argv[2] || 'atp-montsi-donski-2026-06-06';

function parseArgs() {
  const args = process.argv.slice(3);
  const parsed = {};
  for (const arg of args) {
    const [key, val] = arg.replace(/^--/, '').split('=');
    if (key && val !== undefined) parsed[key] = val;
  }
  return parsed;
}

const args = parseArgs();
function getArg(k, def) { return args[k] !== undefined ? parseFloat(args[k]) : def; }

const config = {
  paperBalance:   getArg('balance',  10),
  buyZoneLow:     getArg('buyLow',   0.62) / 100,
  buyZoneHigh:    getArg('buyHigh',  0.64) / 100,
  sellZoneLow:    getArg('sellLow',  0.68) / 100,
  sellZoneHigh:   getArg('sellHigh', 0.69) / 100,
  stopLossBuffer: getArg('stopBuf',  0.005),
  numWorkers:     Math.max(1, Math.min(4, getArg('workers', 2))),
  momentumWindow: 3,
};

let running      = true;
let paperBalance = config.paperBalance;
let positions    = {};
let lastAsk      = {};
let lastBid      = {};
let lastSellTime = {};
let askHistory   = {};
let trades       = [];
let tradeCounter = 0;
let startTime    = Date.now();
let wsLatencies  = [];
let tickCounts   = {};
let tokenToOutcome = {};
let clobTokenIds   = [];

const NUM_WORKER_SLOTS = 8;
const SLOTS_PER_ASSET  = 3;
const sharedBuffer = new SharedArrayBuffer(NUM_WORKER_SLOTS * SLOTS_PER_ASSET * 8);
const f64 = new Float64Array(sharedBuffer);
let slotMap = {};

const C = {
  reset:   '\x1b[0m',  grey:    '\x1b[90m', white:   '\x1b[37m',
  green:   '\x1b[32m', red:     '\x1b[31m', yellow:  '\x1b[33m',
  cyan:    '\x1b[36m', magenta: '\x1b[35m', bold:    '\x1b[1m',
  blue:    '\x1b[34m',
};

function log(text, type = 'info') {
  const time = new Date().toLocaleTimeString();
  const colors = { buy: C.cyan, sell_win: C.green, sell_loss: C.red, info: C.grey, warn: C.yellow };
  console.log(`${colors[type] || C.grey}[${time}] ${text}${C.reset}`);
}

function pad(str, len, right = false) {
  const s = String(str);
  return right ? s.padStart(len) : s.padEnd(len);
}

function printLiveSummary() {
  const realizedPnL = trades.filter(t => t.type === 'SELL').reduce((s, t) => s + t.pnl, 0);
  const wins   = trades.filter(t => t.type === 'SELL' && t.pnl >= 0).length;
  const losses = trades.filter(t => t.type === 'SELL' && t.pnl <  0).length;
  const winRate = (wins + losses) > 0 ? ((wins / (wins + losses)) * 100).toFixed(0) + '%' : '--';
  const openCount = Object.keys(positions).length;
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  const avgLat = wsLatencies.length > 0
    ? (wsLatencies.slice(-20).reduce((a, b) => a + b, 0) / Math.min(wsLatencies.length, 20)).toFixed(0) + 'ms'
    : '--';
  const totalTicks = Object.values(tickCounts).reduce((a, b) => a + b, 0);

  console.log(`\n${C.grey}─────────────────────────────────────────${C.reset}`);
  console.log(`${C.white} Balance:    ${C.green}$${paperBalance.toFixed(2)}${C.reset}  (started $${config.paperBalance})`);
  console.log(`${C.white} Realized:   ${realizedPnL >= 0 ? C.cyan : C.red}${realizedPnL >= 0 ? '+' : ''}$${realizedPnL.toFixed(4)}${C.reset}`);
  console.log(`${C.white} Win Rate:   ${C.yellow}${winRate}${C.reset}  (${wins}W / ${losses}L)`);
  console.log(`${C.white} Open Pos:   ${C.magenta}${openCount}${C.reset}`);
  console.log(`${C.white} Workers:    ${C.blue}${config.numWorkers} active${C.reset}`);
  console.log(`${C.white} Total Ticks:${C.grey} ${totalTicks}${C.reset}`);
  console.log(`${C.white} Runtime:    ${C.grey}${mm}:${ss}${C.reset}`);
  console.log(`${C.white} Avg WS Lat: ${C.grey}${avgLat}${C.reset}`);
  console.log(`${C.grey}─────────────────────────────────────────${C.reset}\n`);
}

function printFinalReport() {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  console.log(`\n${C.yellow}${'═'.repeat(120)}${C.reset}`);
  console.log(`${C.bold}${C.yellow}  FINAL TRADE REPORT — Multi-Worker${C.reset}`);
  console.log(`${C.yellow}${'═'.repeat(120)}${C.reset}`);

  const hdr = [
    pad('#', 4), pad('Time', 10), pad('Type', 10), pad('Outcome', 18),
    pad('Shares', 10, true), pad('Buy¢', 7, true), pad('Sell¢', 7, true),
    pad('Cost', 9, true), pad('Proceeds', 10, true), pad('P&L', 9, true),
    pad('Balance', 10, true), pad('Latency', 9, true), pad('Reason', 22),
  ].join('  ');
  console.log(`${C.grey}  ${hdr}${C.reset}`);
  console.log(`${C.grey}  ${'─'.repeat(118)}${C.reset}`);

  let runningBal = config.paperBalance;
  for (const t of trades) {
    let color = C.grey;
    let typeLabel = t.type;
    if (t.type === 'BUY') {
      color = C.cyan;
      runningBal -= t.cost;
    } else {
      color = t.pnl >= 0 ? C.green : C.red;
      typeLabel = t.pnl >= 0 ? 'SELL WIN' : 'SELL LOSS';
      runningBal += t.proceeds;
    }
    const row = [
      pad(t.id, 4), pad(t.time, 10), pad(typeLabel, 10),
      pad(t.outcome.substring(0, 17), 18),
      pad(t.shares.toFixed(4), 10, true),
      pad((t.buyAsk * 100).toFixed(2), 7, true),
      pad(t.type === 'SELL' ? (t.sellAsk * 100).toFixed(2) : '—', 7, true),
      pad(t.type === 'BUY'  ? t.cost.toFixed(4) : '—', 9, true),
      pad(t.type === 'SELL' ? t.proceeds.toFixed(4) : '—', 10, true),
      pad(t.type === 'SELL' ? (t.pnl >= 0 ? '+' : '') + t.pnl.toFixed(4) : '—', 9, true),
      pad('$' + runningBal.toFixed(4), 10, true),
      pad(t.latencyMs != null ? t.latencyMs + 'ms' : '--', 9, true),
      pad((t.reason || '').substring(0, 22), 22),
    ].join('  ');
    console.log(`${color}  ${row}${C.reset}`);
  }

  const sellTrades  = trades.filter(t => t.type === 'SELL');
  const realizedPnL = sellTrades.reduce((s, t) => s + t.pnl, 0);
  const totalCost   = trades.filter(t => t.type === 'BUY').reduce((s, t) => s + t.cost, 0);
  const totalProc   = sellTrades.reduce((s, t) => s + t.proceeds, 0);
  const wins        = sellTrades.filter(t => t.pnl >= 0).length;
  const losses      = sellTrades.filter(t => t.pnl <  0).length;
  const winRate     = (wins + losses) > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) + '%' : '--';
  const avgWin      = wins   > 0 ? (sellTrades.filter(t => t.pnl >= 0).reduce((s, t) => s + t.pnl, 0) / wins).toFixed(4)  : '--';
  const avgLoss     = losses > 0 ? (sellTrades.filter(t => t.pnl <  0).reduce((s, t) => s + t.pnl, 0) / losses).toFixed(4) : '--';
  const avgLat      = wsLatencies.length > 0
    ? (wsLatencies.reduce((a, b) => a + b, 0) / wsLatencies.length).toFixed(0) + 'ms' : '--';

  console.log(`${C.grey}  ${'─'.repeat(118)}${C.reset}`);
  console.log(`\n${C.yellow}  SUMMARY${C.reset}`);
  console.log(`${C.white}  Final Balance  : ${C.green}$${paperBalance.toFixed(4)}${C.reset}  (started $${config.paperBalance})`);
  console.log(`${C.white}  Total Cost     : ${C.red}-$${totalCost.toFixed(4)}${C.reset}`);
  console.log(`${C.white}  Total Proceeds : ${C.green}+$${totalProc.toFixed(4)}${C.reset}`);
  console.log(`${C.white}  Realized P&L   : ${realizedPnL >= 0 ? C.green : C.red}${realizedPnL >= 0 ? '+' : ''}$${realizedPnL.toFixed(4)}${C.reset}`);
  console.log(`${C.white}  Trades         : ${trades.length}  (${trades.filter(t => t.type === 'BUY').length} buys / ${sellTrades.length} sells)`);
  console.log(`${C.white}  Win Rate       : ${C.yellow}${winRate}${C.reset}  (${wins}W / ${losses}L)`);
  console.log(`${C.white}  Avg Win        : ${C.green}+$${avgWin}${C.reset}`);
  console.log(`${C.white}  Avg Loss       : ${C.red}$${avgLoss}${C.reset}`);
  console.log(`${C.white}  Avg WS Lat     : ${C.grey}${avgLat}${C.reset}`);
  console.log(`${C.white}  Runtime        : ${C.grey}${mm}:${ss}${C.reset}`);
  console.log(`${C.yellow}${'═'.repeat(120)}${C.reset}\n`);
}

function isRisingIntoZone(assetId, ask) {
  const hist = askHistory[assetId] || [];
  if (hist.length < 2) return true;
  return ask >= hist[hist.length - 1];
}

function recordAsk(assetId, ask) {
  if (!askHistory[assetId]) askHistory[assetId] = [];
  askHistory[assetId].push(ask);
  if (askHistory[assetId].length > config.momentumWindow) askHistory[assetId].shift();
}

function tryBuy(assetId, outcomeName, ask, latencyMs) {
  if (positions[assetId]) return;
  if (!ask || ask <= 0) return;
  if (paperBalance < 1.0) return;

  if (ask >= config.buyZoneLow && ask <= config.buyZoneHigh) {
    if (!isRisingIntoZone(assetId, ask)) {
      log(`SKIP BUY ${outcomeName} @ ${(ask * 100).toFixed(2)}¢ — falling into zone`, 'info');
      return;
    }

    const cost   = 1.00;
    const shares = cost / ask;

    paperBalance -= cost;
    positions[assetId] = { shares, buyAsk: ask, outcomeName, peakAsk: ask };

    tradeCounter++;
    trades.push({
      id: tradeCounter, type: 'BUY', outcome: outcomeName, shares,
      buyAsk: ask, sellAsk: null, cost, proceeds: null, pnl: null,
      balanceAfter: paperBalance, time: new Date().toLocaleTimeString(),
      assetId, latencyMs, reason: 'Buy zone hit',
    });

    log(
      `BUY  ${outcomeName} | ${(ask * 100).toFixed(2)}¢ | ${shares.toFixed(4)}sh | lat:${latencyMs != null ? latencyMs + 'ms' : '--'} | bal $${paperBalance.toFixed(2)}`,
      'buy'
    );
    printLiveSummary();
  }
}

function trySell(assetId, ask, latencyMs) {
  const pos = positions[assetId];
  if (!pos || !ask || ask <= 0) return false;
  if (ask > pos.peakAsk) pos.peakAsk = ask;

  let shouldSell = false;
  let sellReason = '';

  if (ask <= pos.buyAsk - config.stopLossBuffer) {
    shouldSell = true;
    sellReason = `StopLoss ${(pos.buyAsk * 100).toFixed(2)}→${(ask * 100).toFixed(2)}¢`;
  }

  if (!shouldSell && ask >= config.sellZoneLow && ask <= config.sellZoneHigh) {
    shouldSell = true;
    sellReason = `Target ${(ask * 100).toFixed(2)}¢`;
  }

  if (!shouldSell && pos.peakAsk > config.sellZoneHigh && ask >= config.sellZoneLow) {
    shouldSell = true;
    sellReason = `Trail ${(pos.peakAsk * 100).toFixed(2)}→${(ask * 100).toFixed(2)}¢`;
  }

  if (!shouldSell) return false;

  const proceeds = pos.shares * ask;
  const cost     = pos.shares * pos.buyAsk;
  const pnl      = proceeds - cost;
  paperBalance  += proceeds;
  lastSellTime[assetId] = Date.now();

  tradeCounter++;
  trades.push({
    id: tradeCounter, type: 'SELL', outcome: pos.outcomeName, shares: pos.shares,
    buyAsk: pos.buyAsk, sellAsk: ask, cost, proceeds, pnl,
    balanceAfter: paperBalance, time: new Date().toLocaleTimeString(),
    assetId, latencyMs, reason: sellReason,
  });
  delete positions[assetId];

  const type = pnl >= 0 ? 'sell_win' : 'sell_loss';
  const icon = pnl >= 0 ? 'SELL WIN ' : 'SELL LOSS';
  log(
    `${icon} ${pos.outcomeName} | ${(pos.buyAsk * 100).toFixed(2)}→${(ask * 100).toFixed(2)}¢ | P&L ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(4)} | lat:${latencyMs != null ? latencyMs + 'ms' : '--'} | bal $${paperBalance.toFixed(2)} | ${sellReason}`,
    type
  );
  printLiveSummary();
  return true;
}

function processTick(assetId, rawAsk, rawBid, source, latencyMs) {
  if (latencyMs != null && latencyMs >= 0 && latencyMs < 30000) wsLatencies.push(latencyMs);

  const ask = rawAsk > 0 ? rawAsk : (lastAsk[assetId] || 0);
  const bid = rawBid > 0 ? rawBid : (lastBid[assetId] || 0);
  if (ask > 0) { lastAsk[assetId] = ask; recordAsk(assetId, ask); }
  if (bid > 0)   lastBid[assetId] = bid;

  tickCounts[assetId] = (tickCounts[assetId] || 0) + 1;

  const outcomeName = tokenToOutcome[assetId] || assetId.slice(0, 8);

  log(
    `[W${source}] ${outcomeName} | Ask:${ask > 0 ? (ask * 100).toFixed(2) + '¢' : 'N/A'} | Bid:${bid > 0 ? (bid * 100).toFixed(2) + '¢' : 'N/A'} | lat:${latencyMs != null ? latencyMs + 'ms' : '--'}`,
    'info'
  );

  const hadPosition = !!positions[assetId];
  if (hadPosition) {
    const sold = trySell(assetId, ask, latencyMs);
    if (sold) {
      tryBuy(assetId, outcomeName, ask, latencyMs);
      return;
    }
  } else {
    tryBuy(assetId, outcomeName, ask, latencyMs);
  }
}

function spawnWorkers() {
  for (let w = 0; w < config.numWorkers; w++) {
    const worker = new Worker(__filename, {
      workerData: {
        workerId: w + 1,
        clobTokenIds,
        tokenToOutcome,
        sharedBuffer,
        slotMap,
      },
    });

    worker.on('message', (msg) => {
      if (!running) return;
      if (msg.type === 'tick') {
        processTick(msg.assetId, msg.ask, msg.bid, msg.workerId, msg.latencyMs);
      }
    });

    worker.on('error', (err) => log(`Worker ${w + 1} error: ${err.message}`, 'warn'));
    worker.on('exit',  (code) => {
      if (!running) return;
      log(`Worker ${w + 1} exited (${code}), restarting...`, 'warn');
      setTimeout(() => spawnWorkers(), 3000);
    });

    log(`Worker ${w + 1} started`, 'info');
  }
}

async function init() {
  log(`Fetching market: ${slug}`, 'info');
  try {
    const res = await fetch(`https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(slug)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const market = data[0];
    if (!market) throw new Error('Market not found');

    const safeParse = (v) => {
      if (Array.isArray(v)) return v;
      if (typeof v === 'string') { try { return JSON.parse(v); } catch { return []; } }
      return [];
    };

    clobTokenIds       = safeParse(market.clobTokenIds);
    const prices       = safeParse(market.outcomePrices);
    const outcomes     = safeParse(market.outcomes);

    if (clobTokenIds.length === 0) throw new Error('No CLOB token IDs');
    if (clobTokenIds.length > NUM_WORKER_SLOTS) throw new Error(`Too many tokens (max ${NUM_WORKER_SLOTS})`);

    clobTokenIds.forEach((id, i) => {
      tokenToOutcome[id] = outcomes[i] || `Outcome ${i + 1}`;
      lastAsk[id]        = parseFloat(prices[i] || 0);
      lastBid[id]        = 0;
      lastSellTime[id]   = 0;
      tickCounts[id]     = 0;
      askHistory[id]     = [];
      slotMap[id]        = i;
    });

    log(`Market    : ${market.question}`, 'info');
    log(`Outcomes  : ${outcomes.join(' vs ')}`, 'info');
    log(`Assets    : ${clobTokenIds.length} token(s)`, 'info');
    log(`Workers   : ${config.numWorkers}`, 'info');
    log(
      `Prices    : ${prices.map((p, i) => `${outcomes[i] || i}: ${(parseFloat(p) * 100).toFixed(2)}¢`).join(' | ')}`,
      'info'
    );
    log(
      `Strategy  : BUY ${(config.buyZoneLow * 100).toFixed(2)}–${(config.buyZoneHigh * 100).toFixed(2)}¢ | SELL ${(config.sellZoneLow * 100).toFixed(2)}–${(config.sellZoneHigh * 100).toFixed(2)}¢ | StopBuf ${(config.stopLossBuffer * 100).toFixed(2)}¢`,
      'info'
    );
    log(`Balance   : $${config.paperBalance}`, 'info');

    spawnWorkers();
  } catch (err) {
    log(`Init error: ${err.message}`, 'warn');
    process.exit(1);
  }
}

function stop() {
  running = false;
  log('Stopping...', 'info');
  printFinalReport();
  process.exit(0);
}

process.on('SIGINT',  stop);
process.on('SIGTERM', stop);

console.log('\x1b[33m');
console.log('  ██████╗  ██████╗ ██╗  ██╗   ██╗██████╗  ██████╗ ████████╗');
console.log('  ██╔══██╗██╔═══██╗██║  ╚██╗ ██╔╝██╔══██╗██╔═══██╗╚══██╔══╝');
console.log('  ██████╔╝██║   ██║██║   ╚████╔╝ ██████╔╝██║   ██║   ██║   ');
console.log('  ██╔═══╝ ██║   ██║██║    ╚██╔╝  ██╔══██╗██║   ██║   ██║   ');
console.log('  ██║     ╚██████╔╝███████╗██║   ██████╔╝╚██████╔╝   ██║   ');
console.log('  ╚═╝      ╚═════╝ ╚══════╝╚═╝   ╚═════╝  ╚═════╝    ╚═╝   ');
console.log('                              MULTI-WORKER EDITION');
console.log('\x1b[0m');
console.log(`\x1b[90m  Slug:      ${slug}\x1b[0m`);
console.log(`\x1b[90m  Buy zone:  ${(config.buyZoneLow * 100).toFixed(2)}–${(config.buyZoneHigh * 100).toFixed(2)}¢\x1b[0m`);
console.log(`\x1b[90m  Sell zone: ${(config.sellZoneLow * 100).toFixed(2)}–${(config.sellZoneHigh * 100).toFixed(2)}¢\x1b[0m`);
console.log(`\x1b[90m  StopBuf:   ${(config.stopLossBuffer * 100).toFixed(2)}¢\x1b[0m`);
console.log(`\x1b[90m  Balance:   $${config.paperBalance}\x1b[0m`);
console.log(`\x1b[90m  Workers:   ${config.numWorkers}\x1b[0m\n`);

init();