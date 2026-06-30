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
  paperBalance:        getArg('balance',       10),
  buyZoneLow:          getArg('buyLow',        0.80) / 100,
  buyZoneHigh:         getArg('buyHigh',       0.80) / 100,
  sellZoneLow:         getArg('sellLow',       0.90) / 100,
  sellZoneHigh:        getArg('sellHigh',      0.99) / 100,
  buyCooldownMs:       getArg('cooldown',      0),
  stopLossConsecTicks: getArg('stopTicks',     5),      // INCREASED for tennis
  maxTotalDips:        getArg('maxDips',       8),      // INCREASED for tennis
  hardStopCents:       getArg('hardStop',      8),      // INCREASED for tennis
  trailActivateCents:  getArg('trailActivate', 5),      // INCREASED for tennis
  trailDropCents:      getArg('trailDrop',     2.5),    // INCREASED for tennis
  maxHoldMs:           getArg('maxHold',       0),
  reentryDipCents:     getArg('reentryDip',    1.5),    // Recovery threshold from post-sell low
  partialSellCents:    getArg('partialSell',   -3),     // Partial sell at -3¢
  partialSellPct:      getArg('partialPct',    0.50),   // Sell 50% on partial
};

// ==================== STATE ====================
let running        = true;
let positions      = {};
let paperBalance   = config.paperBalance;
let lastAsk        = {};
let lastBid        = {};
let lastSellTime   = {};
let wsInstance     = null;
let pollInterval   = null;
let tokenToOutcome = {};
let clobTokenIds   = [];
let trades         = [];
let startTime      = Date.now();
let tradeCounter   = 0;
let wsLatencies    = [];

let consecDownTicks = {};
let totalDipCount   = {};

// Post-sell recovery tracking (REPLACES broken reentryGate)
// null = no tracking (free to buy normally)
// number = lowest price seen since last sell
let postSellLow = {};

// ==================== COLORS ====================
const C = {
  reset:   '\x1b[0m',
  grey:    '\x1b[90m',
  white:   '\x1b[37m',
  green:   '\x1b[32m',
  red:     '\x1b[31m',
  yellow:  '\x1b[33m',
  cyan:    '\x1b[36m',
  magenta: '\x1b[35m',
  bold:    '\x1b[1m',
};

// ==================== LOGGING ====================
function log(text, type = 'info') {
  const time = new Date().toLocaleTimeString();
  const colors = {
    buy:       C.cyan,
    sell_win:  C.green,
    sell_loss: C.red,
    info:      C.grey,
    warn:      C.yellow,
    partial:   C.magenta,
  };
  const color = colors[type] || C.grey;
  console.log(`${color}[${time}] ${text}${C.reset}`);
}

function pad(str, len, right = false) {
  const s = String(str);
  if (right) return s.padStart(len);
  return s.padEnd(len);
}

function printLiveSummary() {
  const realizedPnL = trades.filter(t => t.type === 'SELL' || t.type === 'PARTIAL').reduce((s, t) => s + (t.pnl || 0), 0);
  const wins   = trades.filter(t => t.type === 'SELL' && t.pnl >= 0).length;
  const losses = trades.filter(t => t.type === 'SELL' && t.pnl < 0).length;
  const winRate = (wins + losses) > 0 ? ((wins / (wins + losses)) * 100).toFixed(0) + '%' : '--';
  const openCount = Object.keys(positions).length;
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  const avgLatency = wsLatencies.length > 0
    ? (wsLatencies.slice(-20).reduce((a, b) => a + b, 0) / Math.min(wsLatencies.length, 20)).toFixed(0) + 'ms' : '--';

  console.log(`\n${C.grey}─────────────────────────────────────────${C.reset}`);
  console.log(`${C.white} Balance:    ${C.green}$${paperBalance.toFixed(2)}${C.reset}  (started $${config.paperBalance})`);
  console.log(`${C.white} Realized:   ${realizedPnL >= 0 ? C.cyan : C.red}${realizedPnL >= 0 ? '+' : ''}$${realizedPnL.toFixed(4)}${C.reset}`);
  console.log(`${C.white} Win Rate:   ${C.yellow}${winRate}${C.reset}  (${wins}W / ${losses}L)`);
  console.log(`${C.white} Open Pos:   ${C.magenta}${openCount}${C.reset}`);
  console.log(`${C.white} Runtime:    ${C.grey}${mm}:${ss}${C.reset}`);
  console.log(`${C.white} Trades:     ${C.grey}${trades.length}${C.reset}`);
  console.log(`${C.white} Avg WS Lat: ${C.grey}${avgLatency}${C.reset}`);
  console.log(`${C.grey}─────────────────────────────────────────${C.reset}\n`);
}

function printFinalReport() {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  console.log(`\n${C.yellow}${'═'.repeat(120)}${C.reset}`);
  console.log(`${C.bold}${C.yellow}  FINAL TRADE REPORT${C.reset}`);
  console.log(`${C.yellow}${'═'.repeat(120)}${C.reset}`);

  const hdr = [
    pad('#',        4),
    pad('Time',    12),
    pad('Type',    12),
    pad('Outcome', 20),
    pad('Shares',  10, true),
    pad('Buy¢',     7, true),
    pad('Sell¢',    7, true),
    pad('Cost($)',  9, true),
    pad('Proceeds',10, true),
    pad('P&L($)',   9, true),
    pad('Balance',  9, true),
    pad('Latency',  9, true),
    pad('Reason',  28),
  ].join('  ');
  console.log(`${C.grey}  ${hdr}${C.reset}`);
  console.log(`${C.grey}  ${'─'.repeat(120)}${C.reset}`);

  let runningBalance = config.paperBalance;
  for (const t of trades) {
    let color = C.grey;
    let typeLabel = t.type;
    if (t.type === 'BUY') {
      color = C.cyan;
      runningBalance -= t.cost;
    } else if (t.type === 'PARTIAL') {
      color = C.magenta;
      runningBalance += t.proceeds;
    } else {
      color = t.pnl >= 0 ? C.green : C.red;
      typeLabel = t.pnl >= 0 ? 'SELL WIN' : 'SELL LOSS';
      runningBalance += t.proceeds;
    }
    const row = [
      pad(t.id,           4),
      pad(t.time,        12),
      pad(typeLabel,     12),
      pad(t.outcome.substring(0, 19), 20),
      pad(t.shares.toFixed(4),        10, true),
      pad((t.buyAsk * 100).toFixed(2), 7, true),
      pad(t.type !== 'BUY' ? (t.sellAsk * 100).toFixed(2) : '—', 7, true),
      pad(t.type === 'BUY'  ? t.cost.toFixed(4) : '—',            9, true),
      pad(t.type !== 'BUY' ? t.proceeds.toFixed(4) : '—',       10, true),
      pad(t.type !== 'BUY' ? (t.pnl >= 0 ? '+' : '') + t.pnl.toFixed(4) : '—', 9, true),
      pad('$' + runningBalance.toFixed(4), 9, true),
      pad(t.latencyMs != null ? t.latencyMs + 'ms' : '--', 9, true),
      pad((t.reason || '').substring(0, 28), 28),
    ].join('  ');
    console.log(`${color}  ${row}${C.reset}`);
  }

  const sellTrades  = trades.filter(t => t.type === 'SELL');
  const realizedPnL = sellTrades.reduce((s, t) => s + t.pnl, 0) + trades.filter(t => t.type === 'PARTIAL').reduce((s, t) => s + t.pnl, 0);
  const totalCost   = trades.filter(t => t.type === 'BUY').reduce((s, t) => s + t.cost, 0);
  const totalProc   = sellTrades.reduce((s, t) => s + t.proceeds, 0) + trades.filter(t => t.type === 'PARTIAL').reduce((s, t) => s + t.proceeds, 0);
  const wins        = sellTrades.filter(t => t.pnl >= 0).length;
  const losses      = sellTrades.filter(t => t.pnl < 0).length;
  const winRate     = (wins + losses) > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) + '%' : '--';
  const avgWin      = wins > 0 ? (sellTrades.filter(t => t.pnl >= 0).reduce((s, t) => s + t.pnl, 0) / wins).toFixed(4) : '--';
  const avgLoss     = losses > 0 ? (sellTrades.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0) / losses).toFixed(4) : '--';
  const avgLat      = wsLatencies.length > 0 ? (wsLatencies.reduce((a, b) => a + b, 0) / wsLatencies.length).toFixed(0) + 'ms' : '--';

  console.log(`${C.grey}  ${'─'.repeat(120)}${C.reset}`);
  console.log(`\n${C.yellow}  SUMMARY${C.reset}`);
  console.log(`${C.white}  Final Balance : ${C.green}$${paperBalance.toFixed(4)}${C.reset}   (started $${config.paperBalance})`);
  console.log(`${C.white}  Total Cost    : ${C.red}-$${totalCost.toFixed(4)}${C.reset}`);
  console.log(`${C.white}  Total Proceeds: ${C.green}+$${totalProc.toFixed(4)}${C.reset}`);
  console.log(`${C.white}  Realized P&L  : ${realizedPnL >= 0 ? C.green : C.red}${realizedPnL >= 0 ? '+' : ''}$${realizedPnL.toFixed(4)}${C.reset}`);
  console.log(`${C.white}  Trades        : ${trades.length} total  (${trades.filter(t => t.type === 'BUY').length} buys / ${trades.filter(t => t.type === 'PARTIAL').length} partials / ${sellTrades.length} sells)`);
  console.log(`${C.white}  Win Rate      : ${C.yellow}${winRate}${C.reset}  (${wins}W / ${losses}L)`);
  console.log(`${C.white}  Avg Win       : ${C.green}+$${avgWin}${C.reset}`);
  console.log(`${C.white}  Avg Loss      : ${C.red}$${avgLoss}${C.reset}`);
  console.log(`${C.white}  Avg WS Lat    : ${C.grey}${avgLat}${C.reset}`);
  console.log(`${C.white}  Runtime       : ${C.grey}${mm}:${ss}${C.reset}`);
  console.log(`${C.yellow}${'═'.repeat(120)}${C.reset}\n`);
}

// ==================== MAX HOLD WATCHER ====================
function startMaxHoldWatcher() {
  if (!config.maxHoldMs || config.maxHoldMs <= 0) return;
  setInterval(() => {
    const now = Date.now();
    for (const assetId of Object.keys(positions)) {
      const pos = positions[assetId];
      if (now - pos.buyTime >= config.maxHoldMs) {
        const bid = lastBid[assetId] || 0;
        if (bid > 0) forceSell(assetId, bid, null, `MaxHold ${Math.floor((now - pos.buyTime) / 1000)}s`);
      }
    }
  }, 500);
}

// ==================== CORE SELL ====================
function forceSell(assetId, bid, latencyMs, reason, isStopLoss = false) {
  const pos = positions[assetId];
  if (!pos) return;

  const sharesToSell = pos.shares;
  const proceeds = sharesToSell * bid;
  const cost     = sharesToSell * pos.buyAsk;
  const pnl      = proceeds - cost;
  paperBalance  += proceeds;
  lastSellTime[assetId]    = Date.now();
  consecDownTicks[assetId] = 0;
  totalDipCount[assetId]   = 0;

  // If this was a stop-loss, start post-sell recovery tracking
  if (isStopLoss) {
    postSellLow[assetId] = bid;
    log(
      `POST-SELL TRACKING ${tokenToOutcome[assetId]} | sold@${(bid*100).toFixed(2)}¢ | tracking recovery from this point`,
      'warn'
    );
  } else {
    // Win or non-stop sell — clear tracking, free to rebuy normally
    postSellLow[assetId] = null;
  }

  tradeCounter++;
  trades.push({
    id:           tradeCounter,
    type:         'SELL',
    outcome:      pos.outcomeName,
    shares:       sharesToSell,
    buyAsk:       pos.buyAsk,
    sellAsk:      bid,
    cost,
    proceeds,
    pnl,
    balanceAfter: paperBalance,
    time:         new Date().toLocaleTimeString(),
    assetId,
    latencyMs,
    reason,
  });
  delete positions[assetId];

  const type = pnl >= 0 ? 'sell_win' : 'sell_loss';
  const icon = pnl >= 0 ? 'SELL WIN ' : 'SELL LOSS';
  log(
    `${icon} ${pos.outcomeName} | ${(pos.buyAsk*100).toFixed(2)}¢→${(bid*100).toFixed(2)}¢ | P&L ${pnl>=0?'+':''}$${pnl.toFixed(4)} | lat:${latencyMs!=null?latencyMs+'ms':'--'} | bal $${paperBalance.toFixed(2)} | ${reason}`,
    type
  );
  printLiveSummary();
}

// ==================== PARTIAL SELL ====================
function partialSell(assetId, bid, latencyMs, reason) {
  const pos = positions[assetId];
  if (!pos || pos.partialSold) return false;

  const sharesToSell = pos.shares * config.partialSellPct;
  if (sharesToSell <= 0) return false;

  const proceeds = sharesToSell * bid;
  const cost     = sharesToSell * pos.buyAsk;
  const pnl      = proceeds - cost;

  paperBalance += proceeds;
  pos.shares -= sharesToSell;
  pos.partialSold = true;
  pos.partialProceeds = proceeds;
  pos.partialPnl = pnl;

  tradeCounter++;
  trades.push({
    id:           tradeCounter,
    type:         'PARTIAL',
    outcome:      pos.outcomeName,
    shares:       sharesToSell,
    buyAsk:       pos.buyAsk,
    sellAsk:      bid,
    cost,
    proceeds,
    pnl,
    balanceAfter: paperBalance,
    time:         new Date().toLocaleTimeString(),
    assetId,
    latencyMs,
    reason,
  });

  log(
    `PARTIAL SELL ${pos.outcomeName} | ${(sharesToSell).toFixed(4)}sh @ ${(bid*100).toFixed(2)}¢ | P&L ${pnl>=0?'+':''}$${pnl.toFixed(4)} | lat:${latencyMs!=null?latencyMs+'ms':'--'} | bal $${paperBalance.toFixed(2)} | ${reason}`,
    'partial'
  );
  return true;
}

// ==================== TRADING LOGIC ====================
function tryBuy(assetId, outcomeName, ask, latencyMs) {
  if (positions[assetId]) return;
  if (!ask || ask <= 0) return;

  const cooldown = config.buyCooldownMs - (Date.now() - (lastSellTime[assetId] || 0));
  if (cooldown > 0) return;

  // ── Post-sell recovery tracking ─────────────────────────────────────────
  if (postSellLow[assetId] != null) {
    // Update the low watermark
    if (ask < postSellLow[assetId]) {
      postSellLow[assetId] = ask;
      log(
        `POST-SELL LOW UPDATE ${outcomeName} | new low ${(ask*100).toFixed(2)}¢ | was ${(postSellLow[assetId]*100).toFixed(2)}¢`,
        'info'
      );
      return;  // Still going down, don't buy
    }

    // Price has recovered from the low — how much?
    const recovery = (ask - postSellLow[assetId]) * 100;  // in cents

    if (recovery < config.reentryDipCents) {
      log(
        `POST-SELL WAIT ${outcomeName} | low ${(postSellLow[assetId]*100).toFixed(2)}¢ | current ${(ask*100).toFixed(2)}¢ | recovery +${recovery.toFixed(2)}¢ < need +${config.reentryDipCents}¢`,
        'info'
      );
      return;  // Not enough recovery yet
    }

    // Recovery confirmed — clear tracker and allow normal buy zone check
    log(`POST-SELL RECOVERY ${outcomeName} | +${recovery.toFixed(2)}¢ from low ${(postSellLow[assetId]*100).toFixed(2)}¢ → ${(ask*100).toFixed(2)}¢ | buy zone check enabled`, 'warn');
    postSellLow[assetId] = null;
  }

  if (ask >= config.buyZoneLow && ask <= config.buyZoneHigh) {
    const cost   = 1.00;
    const shares = cost / ask;
    if (paperBalance < cost) return;

    paperBalance -= cost;
    consecDownTicks[assetId] = 0;
    totalDipCount[assetId]   = 0;
    positions[assetId] = {
      shares,
      buyAsk:      ask,
      outcomeName,
      peakAsk:     ask,
      buyTime:     Date.now(),
      trailActive: false,
      trailStop:   null,
      partialSold: false,
      partialProceeds: 0,
      partialPnl: 0,
    };

    tradeCounter++;
    trades.push({
      id:           tradeCounter,
      type:         'BUY',
      outcome:      outcomeName,
      shares,
      buyAsk:       ask,
      sellAsk:      null,
      cost,
      proceeds:     null,
      pnl:          null,
      balanceAfter: paperBalance,
      time:         new Date().toLocaleTimeString(),
      assetId,
      latencyMs,
      reason:       'Buy zone hit',
    });
    log(
      `BUY  ${outcomeName} | Ask@${(ask*100).toFixed(2)}¢ | ${shares.toFixed(4)}sh | cost $${cost.toFixed(2)} | lat:${latencyMs!=null?latencyMs+'ms':'--'} | bal $${paperBalance.toFixed(2)}`,
      'buy'
    );
    printLiveSummary();
  }
}

// ==================== FIXED SELL (uses BID for realistic exit) ====================
function trySell(assetId, bid, latencyMs) {
  const pos = positions[assetId];
  if (!pos || !bid || bid <= 0) return;

  if (bid > pos.peakAsk) pos.peakAsk = bid;

  const hardStopPrice = pos.buyAsk - (config.hardStopCents / 100);
  const profitCents   = (bid - pos.buyAsk) * 100;

  // ── Partial profit taking ───────────────────────────────────────────────
  if (!pos.partialSold && profitCents <= config.partialSellCents) {
    partialSell(assetId, bid, latencyMs, `Partial at ${profitCents.toFixed(1)}¢`);
    // Continue checking for full sell on remaining position
  }

  // ── Trailing stop ────────────────────────────────────────────────────────
  if (!pos.trailActive && profitCents >= config.trailActivateCents) {
    pos.trailActive = true;
    pos.trailStop   = pos.peakAsk - (config.trailDropCents / 100);
    log(`TRAIL ON ${pos.outcomeName} | peak ${(pos.peakAsk*100).toFixed(2)}¢ | stop @ ${(pos.trailStop*100).toFixed(2)}¢`, 'warn');
  }
  if (pos.trailActive) {
    const newTrail = pos.peakAsk - (config.trailDropCents / 100);
    if (newTrail > pos.trailStop) pos.trailStop = newTrail;
  }

  // ── 1. Target zone (sell at BID for realistic proceeds) ─────────────────
  if (bid >= config.sellZoneLow && bid <= config.sellZoneHigh) {
    return forceSell(assetId, bid, latencyMs, `Target ${(bid*100).toFixed(2)}¢`, false);
  }

  // ── 2. Trailing stop ─────────────────────────────────────────────────────
  if (pos.trailActive && bid <= pos.trailStop) {
    return forceSell(assetId, bid, latencyMs,
      `Trail ${(pos.trailStop*100).toFixed(2)}¢ pk${(pos.peakAsk*100).toFixed(2)}¢`, false);
  }

  // ── 3. Hard stop ─────────────────────────────────────────────────────────
  if (bid <= hardStopPrice) {
    return forceSell(assetId, bid, latencyMs, `HardStop >${config.hardStopCents}¢ drop`, true);
  }

  // ── 4. Below buy — consecutive + total dip counters ─────────────────────
  if (bid < pos.buyAsk) {
    consecDownTicks[assetId] = (consecDownTicks[assetId] || 0) + 1;
    if (consecDownTicks[assetId] === 1) {
      totalDipCount[assetId] = (totalDipCount[assetId] || 0) + 1;
    }
    log(
      `DIP ${pos.outcomeName} | ${(bid*100).toFixed(2)}¢ | consec ${consecDownTicks[assetId]}/${config.stopLossConsecTicks} | dip events ${totalDipCount[assetId]}/${config.maxTotalDips}`,
      'warn'
    );
    if (consecDownTicks[assetId] >= config.stopLossConsecTicks) {
      return forceSell(assetId, bid, latencyMs, `ConsecStop ${config.stopLossConsecTicks} ticks`, true);
    }
    if (totalDipCount[assetId] >= config.maxTotalDips) {
      return forceSell(assetId, bid, latencyMs, `TotalDips ${config.maxTotalDips} episodes`, true);
    }
  } else {
    if ((consecDownTicks[assetId] || 0) > 0) {
      log(`BOUNCE ${pos.outcomeName} | ${(bid*100).toFixed(2)}¢ | consec reset | total dips: ${totalDipCount[assetId]}/${config.maxTotalDips}`, 'warn');
    }
    consecDownTicks[assetId] = 0;
  }
}

// ==================== TICK PROCESSOR ====================
function processTick(assetId, outcomeName, rawBid, rawAsk, source, latencyMs) {
  const bid = rawBid > 0 ? rawBid : (lastBid[assetId] || 0);
  const ask = rawAsk > 0 ? rawAsk : (lastAsk[assetId] || 0);
  if (bid > 0) lastBid[assetId] = bid;
  if (ask > 0) lastAsk[assetId] = ask;

  const hadPosition = !!positions[assetId];
  log(
    `[${source}]${latencyMs!=null?' lat:'+latencyMs+'ms':''} ${outcomeName} | Ask:${ask>0?(ask*100).toFixed(2)+'¢':'N/A'} | Bid:${bid>0?(bid*100).toFixed(2)+'¢':'N/A'}`,
    'info'
  );

  // Buy uses ASK (what you pay), Sell uses BID (what you receive)
  tryBuy(assetId, outcomeName, ask, latencyMs);
  if (hadPosition || positions[assetId]) trySell(assetId, bid, latencyMs);
}

// ==================== WEBSOCKET ====================
function connectWebSocket() {
  if (!running) return;
  log('Connecting to Polymarket CLOB WebSocket...', 'info');
  const ws = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/market');
  wsInstance = ws;

  ws.on('open', () => {
    log(`WebSocket connected — subscribing to ${clobTokenIds.length} assets`, 'info');
    ws.send(JSON.stringify({ assets_ids: clobTokenIds, type: 'market', custom_feature_enabled: true }));
  });

  ws.on('message', (data) => {
    const recvTime = Date.now();
    try {
      const msg = JSON.parse(data.toString());
      let latencyMs = null;
      if (msg.timestamp) {
        latencyMs = recvTime - parseInt(msg.timestamp);
        if (latencyMs >= 0 && latencyMs < 30000) wsLatencies.push(latencyMs);
      }

      // Handle both price_changes AND book updates
      const updates = msg.price_changes || msg.book_updates || [];
      for (const change of updates) {
        const assetId = change.asset_id;
        if (!assetId || !tokenToOutcome[assetId]) continue;

        // Try to get bid/ask from various message formats
        let rawBid = 0;
        let rawAsk = 0;

        if (change.best_bid !== undefined && change.best_ask !== undefined) {
          // Price change format
          rawBid = parseFloat(change.best_bid || 0);
          rawAsk = parseFloat(change.best_ask || 0);
        } else if (change.bids && change.asks) {
          // Book update format
          const bids = change.bids;
          const asks = change.asks;
          rawBid = bids.length > 0 ? parseFloat(bids[0].price || bids[0][0] || 0) : 0;
          rawAsk = asks.length > 0 ? parseFloat(asks[0].price || asks[0][0] || 0) : 0;
        } else if (change.price !== undefined) {
          // Single price format
          rawAsk = parseFloat(change.price || 0);
          rawBid = rawAsk;  // Fallback
        }

        let tickLat = latencyMs;
        if (change.timestamp) {
          const tl = recvTime - parseInt(change.timestamp);
          if (tl >= 0 && tl < 30000) { tickLat = tl; wsLatencies.push(tl); }
        }
        processTick(assetId, tokenToOutcome[assetId], rawBid, rawAsk, 'WS', tickLat);
      }
    } catch (e) {}
  });

  ws.on('close', () => {
    if (!running) return;
    log('WebSocket closed. Reconnecting in 4s...', 'info');
    setTimeout(connectWebSocket, 4000);
  });

  ws.on('error', () => { log('WebSocket error', 'info'); });
}

// ==================== FIXED POLLING (uses book endpoint) ====================
async function pollPrice(tokenId, outcomeName) {
  const t0 = Date.now();
  try {
    // FIXED: Use book endpoint to get real ask/bid, not stale mid price
    const res = await fetch(`https://clob.polymarket.com/book?token_id=${tokenId}`);
    if (!res.ok) return;
    const data = await res.json();

    const asks = data.asks || [];
    const bids = data.bids || [];
    const bestAsk = asks.length > 0 ? parseFloat(asks[0].price) : 0;
    const bestBid = bids.length > 0 ? parseFloat(bids[0].price) : 0;

    if (bestAsk <= 0 && bestBid <= 0) return;

    // FIXED: Actually use the fetched prices, not stale globals
    processTick(tokenId, outcomeName, bestBid, bestAsk, 'POLL', Date.now() - t0);
  } catch (e) {
    log(`Poll error: ${e.message}`, 'warn');
  }
}

function startPolling() {
  pollInterval = setInterval(() => {
    clobTokenIds.forEach((id, i) => pollPrice(id, tokenToOutcome[id] || `Outcome ${i + 1}`));
  }, 5000);
}

// ==================== INIT ====================
async function init() {
  log(`Fetching market data for slug: ${slug}`, 'info');
  try {
    const res = await fetch(`https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(slug)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const market = data[0];
    if (!market) throw new Error('Market not found');

    const safeParse = (val) => {
      if (Array.isArray(val)) return val;
      if (typeof val === 'string') { try { return JSON.parse(val); } catch { return []; } }
      return [];
    };

    clobTokenIds   = safeParse(market.clobTokenIds);
    const prices   = safeParse(market.outcomePrices);
    const outcomes = safeParse(market.outcomes);
    if (clobTokenIds.length === 0) throw new Error('No CLOB token IDs found');

    clobTokenIds.forEach((id, i) => {
      tokenToOutcome[id]   = outcomes[i] || `Outcome ${i + 1}`;
      lastAsk[id]          = parseFloat(prices[i] || 0);
      lastBid[id]          = 0;
      lastSellTime[id]     = 0;
      consecDownTicks[id]  = 0;
      totalDipCount[id]    = 0;
      postSellLow[id]      = null;
    });

    log(`Market: ${market.question}`, 'info');
    log(`Outcomes: ${outcomes.join(' vs ')}`, 'info');
    log(`Initial prices: ${prices.map((p, i) => `${outcomes[i]||i}: ${(parseFloat(p)*100).toFixed(2)}¢`).join(' | ')}`, 'info');
    log(
      `Strategy: BUY ${(config.buyZoneLow*100).toFixed(2)}–${(config.buyZoneHigh*100).toFixed(2)}¢` +
      ` | SELL ${(config.sellZoneLow*100).toFixed(2)}–${(config.sellZoneHigh*100).toFixed(2)}¢` +
      ` | ConsecStop ${config.stopLossConsecTicks} | MaxDips ${config.maxTotalDips}` +
      ` | HardStop -${config.hardStopCents}¢ | Trail +${config.trailActivateCents}¢ drop ${config.trailDropCents}¢` +
      ` | ReentryRecovery +${config.reentryDipCents}¢ from post-sell low` +
      ` | Partial ${(config.partialSellPct*100).toFixed(0)}% at ${config.partialSellCents}¢`,
      'info'
    );
    log(`Starting balance: $${config.paperBalance}`, 'info');

    startMaxHoldWatcher();
    connectWebSocket();
    startPolling();
  } catch (err) {
    log(`Error: ${err.message}`, 'info');
    process.exit(1);
  }
}

// ==================== GRACEFUL SHUTDOWN ====================
function stop() {
  running = false;
  if (wsInstance) wsInstance.close();
  if (pollInterval) clearInterval(pollInterval);
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
console.log(`\x1b[90m  Slug:           ${slug}\x1b[0m`);
console.log(`\x1b[90m  Buy zone:       ${(config.buyZoneLow*100).toFixed(2)}–${(config.buyZoneHigh*100).toFixed(2)}¢\x1b[0m`);
console.log(`\x1b[90m  Sell zone:      ${(config.sellZoneLow*100).toFixed(2)}–${(config.sellZoneHigh*100).toFixed(2)}¢\x1b[0m`);
console.log(`\x1b[90m  Consec stop:    ${config.stopLossConsecTicks} ticks below buy\x1b[0m`);
console.log(`\x1b[90m  Max dip events: ${config.maxTotalDips} episodes\x1b[0m`);
console.log(`\x1b[90m  Hard stop:      -${config.hardStopCents}¢ instant\x1b[0m`);
console.log(`\x1b[90m  Trail:          +${config.trailActivateCents}¢ activates, ${config.trailDropCents}¢ drop\x1b[0m`);
console.log(`\x1b[90m  Re-entry:       buy after +${config.reentryDipCents}¢ recovery from post-sell low\x1b[0m`);
console.log(`\x1b[90m  Partial sell:   ${(config.partialSellPct*100).toFixed(0)}% at ${config.partialSellCents}¢\x1b[0m`);
console.log(`\x1b[90m  Max hold:       ${config.maxHoldMs > 0 ? config.maxHoldMs + 'ms' : 'disabled'}\x1b[0m`);
console.log(`\x1b[90m  Balance:        $${config.paperBalance}\x1b[0m`);
console.log(`\x1b[90m  Cooldown:       ${config.buyCooldownMs}ms\x1b[0m\n`);

init();