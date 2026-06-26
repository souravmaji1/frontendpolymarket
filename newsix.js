const WebSocket = require('ws');

// ==================== ARG PARSING ====================
const slug = process.argv[2] || 'atp-montsi-donski-2026-06-06';

function parseArgs() {
  const args = process.argv.slice(3);
  const parsed = {};
  for (const arg of args) {
    const [key, val] = arg.split('=');
    if (key && val !== undefined) parsed[key.replace(/^--/, '')] = val;
  }
  return parsed;
}
const args = parseArgs();
function getArg(key, defaultVal) {
  return args[key] !== undefined ? parseFloat(args[key]) : defaultVal;
}

// ==================== CONFIG ====================
const config = {
  paperBalance: getArg('balance', 10),
  buyZoneLow: getArg('buyLow', 0.62) / 100,
  buyZoneHigh: getArg('buyHigh', 0.64) / 100,
  sellZoneLow: getArg('sellLow', 0.68) / 100,
  sellZoneHigh: getArg('sellHigh', 0.69) / 100,
  buyCooldownMs: getArg('cooldown', 0),
  staleThresholdMs: 500,
  maxSpreadToTrade: 0.05,
  maxSizePercent: 0.20,
  wsReconnectDelayMs: 500,
  restSnapshotCooldownMs: 300,
};

// ==================== STATE ====================
let running = true;
let positions = {};
let paperBalance = config.paperBalance;
let lastSellTime = {};
let wsInstance = null;
let tokenToOutcome = {};
let clobTokenIds = [];
let trades = [];
let startTime = Date.now();
let tradeCounter = 0;
let wsLatencies = [];

// ==================== LOCAL ORDERBOOK ====================
const localBooks = {};

function initBook(assetId) {
  if (localBooks[assetId]) return;
  localBooks[assetId] = {
    asks: new Map(),
    bids: new Map(),
    bestBid: null,
    bestAsk: null,
    bidSize: 0,
    askSize: 0,
    lastSeq: -1,
    lastUpdateTime: 0,
    snapshotLoaded: false,
    fetchingSnapshot: false,
    lastSnapshotFetchTime: 0,
    tickSize: null,
  };
}

function applyLevel(book, side, price, size) {
  const map = side === 'asks' ? book.asks : book.bids;
  if (size <= 0) map.delete(price);
  else map.set(price, size);
}

function getBestPrices(assetId) {
  const book = localBooks[assetId];
  if (!book || !book.snapshotLoaded) return null;

  let bestBid = -1, bidSize = 0;
  let bestAsk = 2, askSize = 0;

  for (const [p, s] of book.bids) {
    if (p > bestBid) {
      bestBid = p;
      bidSize = s;
    }
  }
  for (const [p, s] of book.asks) {
    if (p < bestAsk) {
      bestAsk = p;
      askSize = s;
    }
  }

  if (bestBid < 0 || bestAsk > 1) return null;

  return {
    bestBid,
    bidSize,
    bestAsk,
    askSize,
    mid: (bestBid + bestAsk) / 2,
    spread: bestAsk - bestBid,
  };
}

function isStale(assetId) {
  const book = localBooks[assetId];
  if (!book || !book.snapshotLoaded) return true;
  return (Date.now() - book.lastUpdateTime) > config.staleThresholdMs;
}

function triggerRestSnapshot(assetId) {
  const book = localBooks[assetId];
  if (!book || book.fetchingSnapshot) return;
  const now = Date.now();
  if (now - book.lastSnapshotFetchTime < config.restSnapshotCooldownMs) return;

  book.fetchingSnapshot = true;
  book.lastSnapshotFetchTime = now;
  const name = tokenToOutcome[assetId] || assetId.slice(0, 8);

  fetch(`https://clob.polymarket.com/book?token_id=${assetId}`)
    .then(r => r.ok ? r.json() : Promise.reject(r.status))
    .then(data => {
      const b = localBooks[assetId];
      if (!b) return;
      b.bids.clear();
      b.asks.clear();

      for (const lvl of (data.bids || [])) {
        const p = parseFloat(lvl.price), s = parseFloat(lvl.size);
        if (p > 0 && s > 0) b.bids.set(p, s);
      }
      for (const lvl of (data.asks || [])) {
        const p = parseFloat(lvl.price), s = parseFloat(lvl.size);
        if (p > 0 && s > 0) b.asks.set(p, s);
      }

      b.snapshotLoaded = true;
      b.lastUpdateTime = Date.now();
      b.fetchingSnapshot = false;

      const px = getBestPrices(assetId);
      if (px) log(`[REST] ${name} | bid ${(px.bestBid * 100).toFixed(2)}¢ | ask ${(px.bestAsk * 100).toFixed(2)}¢ | spread ${(px.spread * 100).toFixed(2)}¢`, 'info');
    })
    .catch(err => {
      log(`[REST] snapshot failed ${name}: ${err}`, 'warn');
      if (localBooks[assetId]) localBooks[assetId].fetchingSnapshot = false;
    });
}

// ==================== COLORS ====================
const C = {
  reset: '\x1b[0m',
  grey: '\x1b[90m',
  white: '\x1b[37m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  bold: '\x1b[1m',
};

// ==================== LOGGING ====================
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
  const sells = trades.filter(t => t.type === 'SELL');
  const realizedPnL = sells.reduce((s, t) => s + t.pnl, 0);
  const wins = sells.filter(t => t.pnl >= 0).length;
  const losses = sells.filter(t => t.pnl < 0).length;
  const winRate = (wins + losses) > 0 ? ((wins / (wins + losses)) * 100).toFixed(0) + '%' : '--';
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  const avgLat = wsLatencies.length > 0
    ? (wsLatencies.slice(-20).reduce((a, b) => a + b, 0) / Math.min(wsLatencies.length, 20)).toFixed(0) + 'ms'
    : '--';

  const staleNames = clobTokenIds
    .filter(id => isStale(id))
    .map(id => tokenToOutcome[id] || id.slice(0, 8));
  const healthStr = staleNames.length === 0
    ? `${C.green}all feeds healthy${C.reset}`
    : `${C.yellow}STALE: ${staleNames.join(', ')}${C.reset}`;

  console.log(`\n${C.grey}─────────────────────────────────────────${C.reset}`);
  console.log(`${C.white} Balance:    ${C.green}$${paperBalance.toFixed(2)}${C.reset}  (started $${config.paperBalance})`);
  console.log(`${C.white} Realized:   ${realizedPnL >= 0 ? C.cyan : C.red}${realizedPnL >= 0 ? '+' : ''}$${realizedPnL.toFixed(4)}${C.reset}`);
  console.log(`${C.white} Win Rate:   ${C.yellow}${winRate}${C.reset}  (${wins}W / ${losses}L)`);
  console.log(`${C.white} Open Pos:   ${C.magenta}${Object.keys(positions).length}${C.reset}`);
  console.log(`${C.white} Runtime:    ${C.grey}${mm}:${ss}${C.reset}`);
  console.log(`${C.white} Trades:     ${C.grey}${trades.length}${C.reset}`);
  console.log(`${C.white} Avg WS Lat: ${C.grey}${avgLat}${C.reset}`);
  console.log(`${C.white} Feed:       ${healthStr}`);

  for (const id of clobTokenIds) {
    const px = getBestPrices(id);
    const name = tokenToOutcome[id] || id.slice(0, 8);
    const age = localBooks[id] ? Date.now() - localBooks[id].lastUpdateTime : 9999;
    if (px) {
      const ageColor = age > config.staleThresholdMs ? C.yellow : C.grey;
      console.log(`${C.grey} Book[${name}]: bid ${(px.bestBid * 100).toFixed(2)}¢ | ask ${(px.bestAsk * 100).toFixed(2)}¢ | mid ${(px.mid * 100).toFixed(2)}¢ | spread ${(px.spread * 100).toFixed(2)}¢ | ${ageColor}age ${age}ms${C.reset}`);
    }
  }
  console.log(`${C.grey}─────────────────────────────────────────${C.reset}\n`);
}

function printFinalReport() {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  console.log(`\n${C.yellow}${'═'.repeat(110)}${C.reset}`);
  console.log(`${C.bold}${C.yellow} FINAL TRADE REPORT${C.reset}`);
  console.log(`${C.yellow}${'═'.repeat(110)}${C.reset}`);

  const hdr = [
    pad('#', 4), pad('Time', 10), pad('Type', 9), pad('Outcome', 18),
    pad('Shares', 10, true), pad('Buy¢', 7, true), pad('Sell¢', 7, true),
    pad('Cost($)', 9, true), pad('Proceeds', 10, true), pad('P&L($)', 9, true),
    pad('Balance', 9, true), pad('Latency', 9, true), pad('Reason', 20),
  ].join('  ');
  console.log(`${C.grey}  ${hdr}${C.reset}`);
  console.log(`${C.grey}  ${'─'.repeat(108)}${C.reset}`);

  let runningBal = config.paperBalance;
  for (const t of trades) {
    let color = C.grey, typeLabel = t.type;
    if (t.type === 'BUY') {
      color = C.cyan;
      runningBal -= t.cost;
    } else {
      color = t.pnl >= 0 ? C.green : C.red;
      typeLabel = t.pnl >= 0 ? 'SELL WIN' : 'SELL LOSS';
      runningBal += t.proceeds;
    }
    const row = [
      pad(t.id, 4), pad(t.time, 10), pad(typeLabel, 9),
      pad(t.outcome.substring(0, 17), 18),
      pad(t.shares.toFixed(4), 10, true),
      pad((t.buyAsk * 100).toFixed(2), 7, true),
      pad(t.type === 'SELL' ? (t.sellAsk * 100).toFixed(2) : '—', 7, true),
      pad(t.type === 'BUY' ? t.cost.toFixed(4) : '—', 9, true),
      pad(t.type === 'SELL' ? t.proceeds.toFixed(4) : '—', 10, true),
      pad(t.type === 'SELL' ? (t.pnl >= 0 ? '+' : '') + t.pnl.toFixed(4) : '—', 9, true),
      pad('$' + runningBal.toFixed(4), 9, true),
      pad(t.latencyMs != null ? t.latencyMs + 'ms' : '--', 9, true),
      pad((t.reason || '').substring(0, 20), 20),
    ].join('  ');
    console.log(`${color}  ${row}${C.reset}`);
  }

  const sells = trades.filter(t => t.type === 'SELL');
  const realizedPnL = sells.reduce((s, t) => s + t.pnl, 0);
  const totalCost = trades.filter(t => t.type === 'BUY').reduce((s, t) => s + t.cost, 0);
  const totalProc = sells.reduce((s, t) => s + t.proceeds, 0);
  const wins = sells.filter(t => t.pnl >= 0).length;
  const losses = sells.filter(t => t.pnl < 0).length;
  const winRate = (wins + losses) > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) + '%' : '--';
  const avgWin = wins > 0 ? (sells.filter(t => t.pnl >= 0).reduce((s, t) => s + t.pnl, 0) / wins).toFixed(4) : '--';
  const avgLoss = losses > 0 ? (sells.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0) / losses).toFixed(4) : '--';
  const avgLat = wsLatencies.length > 0
    ? (wsLatencies.reduce((a, b) => a + b, 0) / wsLatencies.length).toFixed(0) + 'ms' : '--';

  console.log(`${C.grey}  ${'─'.repeat(108)}${C.reset}`);
  console.log(`\n${C.yellow}  SUMMARY${C.reset}`);
  console.log(`${C.white}  Final Balance : ${C.green}$${paperBalance.toFixed(4)}${C.reset}   (started $${config.paperBalance})`);
  console.log(`${C.white}  Total Cost    : ${C.red}-$${totalCost.toFixed(4)}${C.reset}`);
  console.log(`${C.white}  Total Proceeds: ${C.green}+$${totalProc.toFixed(4)}${C.reset}`);
  console.log(`${C.white}  Realized P&L  : ${realizedPnL >= 0 ? C.green : C.red}${realizedPnL >= 0 ? '+' : ''}$${realizedPnL.toFixed(4)}${C.reset}`);
  console.log(`${C.white}  Trades        : ${trades.length} total  (${trades.filter(t => t.type === 'BUY').length} buys / ${sells.length} sells)`);
  console.log(`${C.white}  Win Rate      : ${C.yellow}${winRate}${C.reset}  (${wins}W / ${losses}L)`);
  console.log(`${C.white}  Avg Win       : ${C.green}+$${avgWin}${C.reset}`);
  console.log(`${C.white}  Avg Loss      : ${C.red}$${avgLoss}${C.reset}`);
  console.log(`${C.white}  Avg WS Lat    : ${C.grey}${avgLat}${C.reset}`);
  console.log(`${C.white}  Runtime       : ${C.grey}${mm}:${ss}${C.reset}`);
  console.log(`${C.yellow}${'═'.repeat(110)}${C.reset}\n`);
}

// ==================== SAFETY GUARD ====================
function rejectReason(assetId, px) {
  const book = localBooks[assetId];
  if (!book || !book.snapshotLoaded) return 'no-snapshot';
  if ((Date.now() - book.lastUpdateTime) > config.staleThresholdMs) return 'stale';
  if (px.spread > config.maxSpreadToTrade) return `wide-spread-${(px.spread * 100).toFixed(2)}c`;
  return null;
}

// ==================== TRADING LOGIC ====================
function tryBuy(assetId, outcomeName, latencyMs) {
  if (positions[assetId]) return;
  if ((Date.now() - (lastSellTime[assetId] || 0)) < config.buyCooldownMs) return;

  const px = getBestPrices(assetId);
  if (!px) return;

  const reason = rejectReason(assetId, px);
  if (reason) {
    if (reason === 'stale') triggerRestSnapshot(assetId);
    return;
  }

  const ask = px.bestAsk;
  if (ask < config.buyZoneLow || ask > config.buyZoneHigh) return;

  const cost = 1.00;
  const shares = cost / ask;
  if (paperBalance < cost) return;

  if (px.askSize > 0 && (shares / px.askSize) > config.maxSizePercent) return;

  paperBalance -= cost;
  positions[assetId] = { shares, buyAsk: ask, outcomeName, peakBid: px.bestBid };

  tradeCounter++;
  trades.push({
    id: tradeCounter, type: 'BUY', outcome: outcomeName,
    shares, buyAsk: ask, sellAsk: null,
    cost, proceeds: null, pnl: null,
    balanceAfter: paperBalance,
    time: new Date().toLocaleTimeString(),
    assetId, latencyMs: latencyMs ?? null,
    reason: `Buy zone | spread ${(px.spread * 100).toFixed(2)}¢`,
  });

  log(
    `BUY ${outcomeName} | ask ${(ask * 100).toFixed(2)}¢ | mid ${(px.mid * 100).toFixed(2)}¢ | ${shares.toFixed(4)}sh | spread ${(px.spread * 100).toFixed(2)}¢ | lat:${latencyMs ?? '--'}ms | bal $${paperBalance.toFixed(2)}`,
    'buy'
  );
  printLiveSummary();
}

function trySell(assetId, latencyMs) {
  const pos = positions[assetId];
  if (!pos) return;

  const px = getBestPrices(assetId);
  if (!px) return;

  const reason = rejectReason(assetId, px);
  if (reason) {
    if (reason === 'stale') triggerRestSnapshot(assetId);
    return;
  }

  const bid = px.bestBid;
  if (bid > pos.peakBid) pos.peakBid = bid;

  let sellReason = '';
  if (bid <= pos.buyAsk) {
    sellReason = `Hard stop ${(pos.buyAsk * 100).toFixed(2)}→${(bid * 100).toFixed(2)}¢`;
  } else if (bid >= config.sellZoneLow && bid <= config.sellZoneHigh) {
    sellReason = `Target ${(bid * 100).toFixed(2)}¢`;
  } else {
    return;
  }

  const proceeds = pos.shares * bid;
  const cost = pos.shares * pos.buyAsk;
  const pnl = proceeds - cost;
  paperBalance += proceeds;
  lastSellTime[assetId] = Date.now();
  delete positions[assetId];

  tradeCounter++;
  trades.push({
    id: tradeCounter, type: 'SELL', outcome: pos.outcomeName,
    shares: pos.shares, buyAsk: pos.buyAsk, sellAsk: bid,
    cost, proceeds, pnl,
    balanceAfter: paperBalance,
    time: new Date().toLocaleTimeString(),
    assetId, latencyMs: latencyMs ?? null,
    reason: sellReason,
  });

  const type = pnl >= 0 ? 'sell_win' : 'sell_loss';
  const icon = pnl >= 0 ? 'SELL WIN ' : 'SELL LOSS';
  log(
    `${icon} ${pos.outcomeName} | ${(pos.buyAsk * 100).toFixed(2)}¢→${(bid * 100).toFixed(2)}¢ | mid ${(px.mid * 100).toFixed(2)}¢ | P&L ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(4)} | spread ${(px.spread * 100).toFixed(2)}¢ | lat:${latencyMs ?? '--'}ms | bal $${paperBalance.toFixed(2)} | ${sellReason}`,
    type
  );
  printLiveSummary();
}

// ==================== WS EVENT HANDLERS ====================
function handleBookSnapshot(assetId, bids, asks) {
  const book = localBooks[assetId];
  if (!book) return;

  book.bids.clear();
  book.asks.clear();

  for (const lvl of (bids || [])) {
    const p = parseFloat(lvl.price), s = parseFloat(lvl.size);
    if (p > 0 && s > 0) book.bids.set(p, s);
  }
  for (const lvl of (asks || [])) {
    const p = parseFloat(lvl.price), s = parseFloat(lvl.size);
    if (p > 0 && s > 0) book.asks.set(p, s);
  }

  book.snapshotLoaded = true;
  book.lastUpdateTime = Date.now();

  const px = getBestPrices(assetId);
  const name = tokenToOutcome[assetId] || assetId.slice(0, 8);
  if (px) log(`[WS-SNAP] ${name} | bid ${(px.bestBid * 100).toFixed(2)}¢ | ask ${(px.bestAsk * 100).toFixed(2)}¢ | spread ${(px.spread * 100).toFixed(2)}¢`, 'info');
}

function handleBestBidAsk(msg) {
  const assetId = msg.asset_id;
  const book = localBooks[assetId];
  if (!book) return;

  const bestBid = parseFloat(msg.best_bid);
  const bestAsk = parseFloat(msg.best_ask);
  if (!isNaN(bestBid) && bestBid > 0) {
    book.bestBid = bestBid;
    book.bids.set(bestBid, book.bids.get(bestBid) || 1);
  }
  if (!isNaN(bestAsk) && bestAsk > 0) {
    book.bestAsk = bestAsk;
    book.asks.set(bestAsk, book.asks.get(bestAsk) || 1);
  }

  const bs = parseFloat(msg.best_bid_size || msg.best_bid_size === 0 ? msg.best_bid_size : 0);
  const as = parseFloat(msg.best_ask_size || msg.best_ask_size === 0 ? msg.best_ask_size : 0);
  if (!isNaN(bs) && bs >= 0) book.bidSize = bs;
  if (!isNaN(as) && as >= 0) book.askSize = as;

  book.lastUpdateTime = Date.now();
  book.snapshotLoaded = true;

  const px = getTradePx(assetId);
  const name = tokenToOutcome[assetId] || assetId.slice(0, 8);
  const latencyMs = msg.timestamp ? Math.max(0, Date.now() - parseInt(msg.timestamp)) : null;
  if (latencyMs != null && latencyMs < 30000) wsLatencies.push(latencyMs);

  if (px) {
    log(`[TOP] ${name} | bid ${(px.bestBid * 100).toFixed(2)}¢ | ask ${(px.bestAsk * 100).toFixed(2)}¢ | spread ${(px.spread * 100).toFixed(2)}¢ | lat:${latencyMs ?? '--'}ms`, 'info');
    const outcomeName = tokenToOutcome[assetId];
    if (outcomeName) {
      tryBuy(assetId, outcomeName, latencyMs);
      if (positions[assetId]) trySell(assetId, latencyMs);
    }
  }
}

function handleTickSizeChange(msg) {
  const assetId = msg.asset_id;
  const book = localBooks[assetId];
  if (!book) return;

  book.tickSize = msg.new_tick_size || msg.tick_size || null;
  const name = tokenToOutcome[assetId] || assetId.slice(0, 8);
  log(`[TICK] ${name} tick size changed -> ${book.tickSize}`, 'warn');
  triggerRestSnapshot(assetId);
}

function getTradePx(assetId) {
  const book = localBooks[assetId];
  if (!book || !book.snapshotLoaded) return null;

  if (book.bestBid != null && book.bestAsk != null) {
    if (book.bestBid > 0 && book.bestAsk > 0) {
      return {
        bestBid: book.bestBid,
        bestAsk: book.bestAsk,
        bidSize: book.bidSize || 0,
        askSize: book.askSize || 0,
        mid: (book.bestBid + book.bestAsk) / 2,
        spread: book.bestAsk - book.bestBid,
      };
    }
  }

  return getBestPrices(assetId);
}

function handleBookDelta(assetId, changes, seq, latencyMs, topOfBookFromMsg = null) {
  const book = localBooks[assetId];
  if (!book) return;

  if (book.lastSeq >= 0 && seq > 0 && seq !== book.lastSeq + 1) {
    log(`[SEQ] ${tokenToOutcome[assetId] || assetId.slice(0, 8)} gap ${book.lastSeq + 1}→${seq} — refetching`, 'warn');
    triggerRestSnapshot(assetId);
  }
  if (seq > 0) book.lastSeq = seq;

  for (const c of (changes || [])) {
    const price = parseFloat(c.price);
    const size = parseFloat(c.size);
    const side = c.side === 'BUY' ? 'bids' : 'asks';
    if (!isNaN(price) && price > 0) applyLevel(book, side, price, size);

    if (!isNaN(parseFloat(c.best_bid)) && parseFloat(c.best_bid) > 0) {
      book.bestBid = parseFloat(c.best_bid);
      book.bids.set(book.bestBid, book.bids.get(book.bestBid) || 1);
    }
    if (!isNaN(parseFloat(c.best_ask)) && parseFloat(c.best_ask) > 0) {
      book.bestAsk = parseFloat(c.best_ask);
      book.asks.set(book.bestAsk, book.asks.get(book.bestAsk) || 1);
    }
  }

  if (topOfBookFromMsg && topOfBookFromMsg.best_bid != null && topOfBookFromMsg.best_ask != null) {
    const bb = parseFloat(topOfBookFromMsg.best_bid);
    const ba = parseFloat(topOfBookFromMsg.best_ask);
    if (!isNaN(bb) && bb > 0) book.bestBid = bb;
    if (!isNaN(ba) && ba > 0) book.bestAsk = ba;
  }

  book.lastUpdateTime = Date.now();

  const px = getTradePx(assetId);
  const name = tokenToOutcome[assetId] || assetId.slice(0, 8);

  if (px) {
    book.bidSize = px.bidSize;
    book.askSize = px.askSize;
    log(`[WS] ${name} | bid ${(px.bestBid * 100).toFixed(2)}¢ x${px.bidSize} | ask ${(px.bestAsk * 100).toFixed(2)}¢ x${px.askSize} | spread ${(px.spread * 100).toFixed(2)}¢ | lat:${latencyMs ?? '--'}ms`, 'info');
  }

  const outcomeName = tokenToOutcome[assetId];
  if (!outcomeName) return;
  tryBuy(assetId, outcomeName, latencyMs);
  if (positions[assetId]) trySell(assetId, latencyMs);
}

// ==================== WEBSOCKET ====================
function connectWebSocket() {
  if (!running) return;
  log('Connecting to Polymarket CLOB WebSocket…', 'info');

  const ws = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/market');
  wsInstance = ws;

  ws.on('open', () => {
    log(`WebSocket connected — subscribing to ${clobTokenIds.length} assets`, 'info');
    ws.send(JSON.stringify({
      assets_ids: clobTokenIds,
      type: 'market',
      custom_feature_enabled: true,
    }));
  });

  ws.on('message', (data) => {
    const recvTime = Date.now();
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    let latencyMs = null;
    if (msg.timestamp) {
      const tl = recvTime - parseInt(msg.timestamp);
      if (tl >= 0 && tl < 30000) {
        latencyMs = tl;
        wsLatencies.push(tl);
      }
    }

    if (msg.event_type === 'book' || msg.type === 'book') {
      const assetId = msg.asset_id;
      if (assetId && localBooks[assetId]) handleBookSnapshot(assetId, msg.bids, msg.asks);
      return;
    }

    if (msg.event_type === 'best_bid_ask') {
      handleBestBidAsk(msg);
      return;
    }

    if (msg.event_type === 'tick_size_change') {
      handleTickSizeChange(msg);
      return;
    }

    if (msg.event_type === 'last_trade_price') {
      const assetId = msg.asset_id;
      if (assetId && localBooks[assetId]) {
        localBooks[assetId].lastTradePrice = parseFloat(msg.price || msg.last_trade_price || 0);
        localBooks[assetId].lastUpdateTime = Date.now();
      }
      return;
    }

    const priceChanges = msg.price_changes || (msg.event_type === 'price_change' ? [msg] : []);
    for (const change of priceChanges) {
      const assetId = change.asset_id;
      if (!assetId || !localBooks[assetId]) continue;

      let tickLat = latencyMs;
      if (change.timestamp) {
        const tl = recvTime - parseInt(change.timestamp);
        if (tl >= 0 && tl < 30000) {
          tickLat = tl;
          wsLatencies.push(tl);
        }
      }

      if (change.changes && change.changes.length > 0) {
        handleBookDelta(assetId, change.changes, change.hash ?? -1, tickLat, change);
      } else {
        const book = localBooks[assetId];
        const rawBid = parseFloat(change.best_bid || 0);
        const rawAsk = parseFloat(change.best_ask || 0);

        if (!isNaN(rawBid) && rawBid > 0) {
          book.bestBid = rawBid;
          book.bids.set(rawBid, book.bids.get(rawBid) || 1);
        }
        if (!isNaN(rawAsk) && rawAsk > 0) {
          book.bestAsk = rawAsk;
          book.asks.set(rawAsk, book.asks.get(rawAsk) || 1);
        }

        book.lastUpdateTime = Date.now();
        book.snapshotLoaded = true;

        if (!book.bestBid || !book.bestAsk) {
          triggerRestSnapshot(assetId);
        } else {
          handleBookDelta(assetId, [], change.hash ?? -1, tickLat, change);
        }
      }
    }
  });

  ws.on('close', () => {
    if (!running) return;
    log('WebSocket closed. Reconnecting in 500ms…', 'warn');
    setTimeout(connectWebSocket, config.wsReconnectDelayMs);
  });

  ws.on('error', (err) => {
    log(`WebSocket error: ${err.message}`, 'warn');
  });
}

// ==================== INIT ====================
async function init() {
  log(`Fetching market data for slug: ${slug}`, 'info');
  try {
    const res = await fetch(`https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(slug)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const market = data[0];
    if (!market) throw new Error('Market not found for that slug');

    const safeParse = (val) => {
      if (Array.isArray(val)) return val;
      if (typeof val === 'string') {
        try { return JSON.parse(val); } catch { return []; }
      }
      return [];
    };

    clobTokenIds = safeParse(market.clobTokenIds);
    const prices = safeParse(market.outcomePrices);
    const outcomes = safeParse(market.outcomes);
    if (clobTokenIds.length === 0) throw new Error('No CLOB token IDs found');

    for (let i = 0; i < clobTokenIds.length; i++) {
      const id = clobTokenIds[i];
      tokenToOutcome[id] = outcomes[i] || `Outcome ${i + 1}`;
      lastSellTime[id] = 0;
      initBook(id);
    }

    log(`Market: ${market.question}`, 'info');
    log(`Outcomes: ${outcomes.join(' vs ')}`, 'info');
    log(`Assets: ${clobTokenIds.length} token(s)`, 'info');
    log(`Prices: ${prices.map((p, i) => `${outcomes[i] || i}: ${(parseFloat(p) * 100).toFixed(2)}¢`).join(' | ')}`, 'info');
    log(`Strategy: BUY ${(config.buyZoneLow * 100).toFixed(2)}–${(config.buyZoneHigh * 100).toFixed(2)}¢ | SELL ${(config.sellZoneLow * 100).toFixed(2)}–${(config.sellZoneHigh * 100).toFixed(2)}¢`, 'info');
    log(`Stale threshold: ${config.staleThresholdMs}ms | Max spread: ${(config.maxSpreadToTrade * 100).toFixed(1)}¢ | Max size: ${(config.maxSizePercent * 100).toFixed(0)}% of depth`, 'info');
    log(`Starting balance: $${config.paperBalance}`, 'info');

    log('Fetching initial REST snapshots…', 'info');
    await Promise.all(clobTokenIds.map(id =>
      fetch(`https://clob.polymarket.com/book?token_id=${id}`)
        .then(r => r.ok ? r.json() : Promise.reject(r.status))
        .then(data => {
          const book = localBooks[id];
          if (!book) return;
          book.bids.clear();
          book.asks.clear();

          for (const lvl of (data.bids || [])) {
            const p = parseFloat(lvl.price), s = parseFloat(lvl.size);
            if (p > 0 && s > 0) book.bids.set(p, s);
          }
          for (const lvl of (data.asks || [])) {
            const p = parseFloat(lvl.price), s = parseFloat(lvl.size);
            if (p > 0 && s > 0) book.asks.set(p, s);
          }

          book.snapshotLoaded = true;
          book.lastUpdateTime = Date.now();

          const px = getBestPrices(id);
          if (px) log(`[INIT] ${tokenToOutcome[id]} | bid ${(px.bestBid * 100).toFixed(2)}¢ | ask ${(px.bestAsk * 100).toFixed(2)}¢ | spread ${(px.spread * 100).toFixed(2)}¢`, 'info');
        })
        .catch(err => log(`[INIT] snapshot failed ${tokenToOutcome[id]}: ${err}`, 'warn'))
    ));

    connectWebSocket();
  } catch (err) {
    log(`Error: ${err.message}`, 'info');
    process.exit(1);
  }
}

// ==================== GRACEFUL SHUTDOWN ====================
function stop() {
  running = false;
  if (wsInstance) wsInstance.close();
  log('Bot stopped.', 'info');
  printFinalReport();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

// ==================== START ====================
console.log('\x1b[33m');
console.log('  ██████╗  ██████╗ ██╗  ██╗   ██╗██████╗  ██████╗ ████████╗');
console.log('  ██╔══██╗██╔═══██╗██║  ╚██╗ ██╔╝██╔══██╗██╔═══██╗╚══██╔══╝');
console.log('  ██████╔╝██║   ██║██║   ╚████╔╝ ██████╔╝██║   ██║   ██║   ');
console.log('  ██╔═══╝ ██║   ██║██║    ╚██╔╝  ██╔══██╗██║   ██║   ██║   ');
console.log('  ██║     ╚██████╔╝███████╗██║   ██████╔╝╚██████╔╝   ██║   ');
console.log('  ╚═╝      ╚═════╝ ╚══════╝╚═╝   ╚═════╝  ╚═════╝    ╚═╝   ');
console.log('\x1b[0m');
console.log(`\x1b[90m  Slug:      ${slug}\x1b[0m`);
console.log(`\x1b[90m  Buy zone:  ${(config.buyZoneLow * 100).toFixed(2)}–${(config.buyZoneHigh * 100).toFixed(2)}¢\x1b[0m`);
console.log(`\x1b[90m  Sell zone: ${(config.sellZoneLow * 100).toFixed(2)}–${(config.sellZoneHigh * 100).toFixed(2)}¢\x1b[0m`);
console.log(`\x1b[90m  Balance:   $${config.paperBalance}\x1b[0m`);
console.log(`\x1b[90m  Cooldown:  ${config.buyCooldownMs}ms\x1b[0m\n`);

init();