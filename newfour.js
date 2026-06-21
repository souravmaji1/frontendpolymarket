const WebSocket = require('ws');

// ==================== ARG PARSING ====================
// Supports multiple markets: pass comma-separated slugs
// e.g. node bot.js "slug-1,slug-2,slug-3" buyLow=80 ...
const slugArg = process.argv[2] || 'atp-montsi-donski-2026-06-06';
const slugs = slugArg.split(',').map(s => s.trim()).filter(Boolean);

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
  // Optional generic cooldown after ANY sell, default OFF (0ms).
  // Leave this at 0 for high-volatility instant re-entry.
  buyCooldownMs:       getArg('cooldown',      0),
  stopLossConsecTicks: getArg('stopTicks',     3),
  maxTotalDips:        getArg('maxDips',       5),
  hardStopCents:       getArg('hardStop',      5),
  trailActivateCents:  getArg('trailActivate', 3),
  trailDropCents:      getArg('trailDrop',     1.5),
  maxHoldMs:           getArg('maxHold',       0),
};

// ==================== STATE (per-asset, shared across all markets) ====================
let running        = true;
let positions      = {};
let paperBalance   = config.paperBalance;
let lastAsk        = {};
let lastBid        = {};
let lastSellTime   = {};
let wsInstances    = [null, null]; // two redundant connections
let pollInterval   = null;
let tokenToOutcome = {};
let tokenToMarket  = {};   // assetId -> slug, for logging
let clobTokenIds   = [];
let trades         = [];
let startTime      = Date.now();
let tradeCounter   = 0;
let wsLatencies    = [];

let consecDownTicks = {};
let totalDipCount   = {};

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
  const realizedPnL = trades.filter(t => t.type === 'SELL').reduce((s, t) => s + t.pnl, 0);
  const wins   = trades.filter(t => t.type === 'SELL' && t.pnl >= 0).length;
  const losses = trades.filter(t => t.type === 'SELL' && t.pnl < 0).length;
  const winRate = (wins + losses) > 0 ? ((wins / (wins + losses)) * 100).toFixed(0) + '%' : '--';
  const openCount = Object.keys(positions).length;
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  const avgLatency = wsLatencies.length > 0
    ? (wsLatencies.slice(-20).reduce((a, b) => a + b, 0) / Math.min(wsLatencies.length, 20)).toFixed(0) + 'ms' : '--';
  const openSockets = wsInstances.filter(ws => ws && ws.readyState === WebSocket.OPEN).length;

  console.log(`\n${C.grey}─────────────────────────────────────────${C.reset}`);
  console.log(`${C.white} Markets:    ${C.magenta}${slugs.length}${C.reset}  (${clobTokenIds.length} assets monitored)`);
  console.log(`${C.white} WS Conns:   ${C.magenta}${openSockets}/2 open${C.reset}`);
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

  console.log(`\n${C.yellow}${'═'.repeat(130)}${C.reset}`);
  console.log(`${C.bold}${C.yellow}  FINAL TRADE REPORT${C.reset}`);
  console.log(`${C.yellow}${'═'.repeat(130)}${C.reset}`);

  const hdr = [
    pad('#',        4),
    pad('Time',    12),
    pad('Type',    10),
    pad('Market',  16),
    pad('Outcome', 18),
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
  console.log(`${C.grey}  ${'─'.repeat(130)}${C.reset}`);

  let runningBalance = config.paperBalance;
  for (const t of trades) {
    let color = C.grey;
    let typeLabel = t.type;
    if (t.type === 'BUY') {
      color = C.cyan;
      runningBalance -= t.cost;
    } else {
      color = t.pnl >= 0 ? C.green : C.red;
      typeLabel = t.pnl >= 0 ? 'SELL WIN' : 'SELL LOSS';
      runningBalance += t.proceeds;
    }
    const row = [
      pad(t.id,           4),
      pad(t.time,        12),
      pad(typeLabel,     10),
      pad((t.marketSlug || '').substring(0, 16), 16),
      pad(t.outcome.substring(0, 17), 18),
      pad(t.shares.toFixed(4),        10, true),
      pad((t.buyAsk * 100).toFixed(2), 7, true),
      pad(t.type === 'SELL' ? (t.sellAsk * 100).toFixed(2) : '—', 7, true),
      pad(t.type === 'BUY'  ? t.cost.toFixed(4) : '—',            9, true),
      pad(t.type === 'SELL' ? t.proceeds.toFixed(4) : '—',       10, true),
      pad(t.type === 'SELL' ? (t.pnl >= 0 ? '+' : '') + t.pnl.toFixed(4) : '—', 9, true),
      pad('$' + runningBalance.toFixed(4), 9, true),
      pad(t.latencyMs != null ? t.latencyMs + 'ms' : '--', 9, true),
      pad((t.reason || '').substring(0, 28), 28),
    ].join('  ');
    console.log(`${color}  ${row}${C.reset}`);
  }

  const sellTrades  = trades.filter(t => t.type === 'SELL');
  const realizedPnL = sellTrades.reduce((s, t) => s + t.pnl, 0);
  const totalCost   = trades.filter(t => t.type === 'BUY').reduce((s, t) => s + t.cost, 0);
  const totalProc   = sellTrades.reduce((s, t) => s + t.proceeds, 0);
  const wins        = sellTrades.filter(t => t.pnl >= 0).length;
  const losses      = sellTrades.filter(t => t.pnl < 0).length;
  const winRate     = (wins + losses) > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) + '%' : '--';
  const avgWin      = wins > 0 ? (sellTrades.filter(t => t.pnl >= 0).reduce((s, t) => s + t.pnl, 0) / wins).toFixed(4) : '--';
  const avgLoss     = losses > 0 ? (sellTrades.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0) / losses).toFixed(4) : '--';
  const avgLat      = wsLatencies.length > 0 ? (wsLatencies.reduce((a, b) => a + b, 0) / wsLatencies.length).toFixed(0) + 'ms' : '--';

  console.log(`${C.grey}  ${'─'.repeat(130)}${C.reset}`);
  console.log(`\n${C.yellow}  SUMMARY${C.reset}`);
  console.log(`${C.white}  Markets       : ${slugs.length}  (${clobTokenIds.length} assets)`);
  console.log(`${C.white}  Final Balance : ${C.green}$${paperBalance.toFixed(4)}${C.reset}   (started $${config.paperBalance})`);
  console.log(`${C.white}  Total Cost    : ${C.red}-$${totalCost.toFixed(4)}${C.reset}`);
  console.log(`${C.white}  Total Proceeds: ${C.green}+$${totalProc.toFixed(4)}${C.reset}`);
  console.log(`${C.white}  Realized P&L  : ${realizedPnL >= 0 ? C.green : C.red}${realizedPnL >= 0 ? '+' : ''}$${realizedPnL.toFixed(4)}${C.reset}`);
  console.log(`${C.white}  Trades        : ${trades.length} total  (${trades.filter(t => t.type === 'BUY').length} buys / ${sellTrades.length} sells)`);
  console.log(`${C.white}  Win Rate      : ${C.yellow}${winRate}${C.reset}  (${wins}W / ${losses}L)`);
  console.log(`${C.white}  Avg Win       : ${C.green}+$${avgWin}${C.reset}`);
  console.log(`${C.white}  Avg Loss      : ${C.red}$${avgLoss}${C.reset}`);
  console.log(`${C.white}  Avg WS Lat    : ${C.grey}${avgLat}${C.reset}`);
  console.log(`${C.white}  Runtime       : ${C.grey}${mm}:${ss}${C.reset}`);
  console.log(`${C.yellow}${'═'.repeat(130)}${C.reset}\n`);
}

// ==================== MAX HOLD WATCHER ====================
function startMaxHoldWatcher() {
  if (!config.maxHoldMs || config.maxHoldMs <= 0) return;
  setInterval(() => {
    const now = Date.now();
    for (const assetId of Object.keys(positions)) {
      const pos = positions[assetId];
      if (now - pos.buyTime >= config.maxHoldMs) {
        const ask = lastAsk[assetId] || 0;
        if (ask > 0) forceSell(assetId, ask, null, `MaxHold ${Math.floor((now - pos.buyTime) / 1000)}s`);
      }
    }
  }, 500);
}

// ==================== CORE SELL ====================
function forceSell(assetId, ask, latencyMs, reason, isStopLoss = false) {
  const pos = positions[assetId];
  if (!pos) return;

  const proceeds = pos.shares * ask;
  const cost     = pos.shares * pos.buyAsk;
  const pnl      = proceeds - cost;
  paperBalance  += proceeds;
  lastSellTime[assetId]    = Date.now();
  consecDownTicks[assetId] = 0;
  totalDipCount[assetId]   = 0;

  // No gate, no cooldown — asset becomes instantly tradeable again.

  tradeCounter++;
  trades.push({
    id:           tradeCounter,
    type:         'SELL',
    outcome:      pos.outcomeName,
    marketSlug:   pos.marketSlug,
    shares:       pos.shares,
    buyAsk:       pos.buyAsk,
    sellAsk:      ask,
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
    `${icon} [${pos.marketSlug}] ${pos.outcomeName} | ${(pos.buyAsk*100).toFixed(2)}¢→${(ask*100).toFixed(2)}¢ | P&L ${pnl>=0?'+':''}$${pnl.toFixed(4)} | lat:${latencyMs!=null?latencyMs+'ms':'--'} | bal $${paperBalance.toFixed(2)} | ${reason} | INSTANT REBUY ARMED`,
    type
  );
  printLiveSummary();
}

// ==================== TRADING LOGIC ====================
function tryBuy(assetId, outcomeName, ask, latencyMs) {
  if (positions[assetId]) return;
  if (!ask || ask <= 0) return;

  if (config.buyCooldownMs > 0) {
    const cooldown = config.buyCooldownMs - (Date.now() - (lastSellTime[assetId] || 0));
    if (cooldown > 0) return;
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
      marketSlug:  tokenToMarket[assetId] || '',
      peakAsk:     ask,
      buyTime:     Date.now(),
      trailActive: false,
      trailStop:   null,
    };

    tradeCounter++;
    trades.push({
      id:           tradeCounter,
      type:         'BUY',
      outcome:      outcomeName,
      marketSlug:   tokenToMarket[assetId] || '',
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
      `BUY  [${tokenToMarket[assetId] || ''}] ${outcomeName} | Ask@${(ask*100).toFixed(2)}¢ | ${shares.toFixed(4)}sh | cost $${cost.toFixed(2)} | lat:${latencyMs!=null?latencyMs+'ms':'--'} | bal $${paperBalance.toFixed(2)}`,
      'buy'
    );
    printLiveSummary();
  }
}

function trySell(assetId, ask, latencyMs) {
  const pos = positions[assetId];
  if (!pos || !ask || ask <= 0) return;

  if (ask > pos.peakAsk) pos.peakAsk = ask;

  const hardStopPrice = pos.buyAsk - (config.hardStopCents / 100);
  const profitCents   = (ask - pos.buyAsk) * 100;

  if (!pos.trailActive && profitCents >= config.trailActivateCents) {
    pos.trailActive = true;
    pos.trailStop   = pos.peakAsk - (config.trailDropCents / 100);
    log(`TRAIL ON [${pos.marketSlug}] ${pos.outcomeName} | peak ${(pos.peakAsk*100).toFixed(2)}¢ | stop @ ${(pos.trailStop*100).toFixed(2)}¢`, 'warn');
  }
  if (pos.trailActive) {
    const newTrail = pos.peakAsk - (config.trailDropCents / 100);
    if (newTrail > pos.trailStop) pos.trailStop = newTrail;
  }

  if (ask >= config.sellZoneLow && ask <= config.sellZoneHigh) {
    return forceSell(assetId, ask, latencyMs, `Target ${(ask*100).toFixed(2)}¢`, false);
  }

  if (pos.trailActive && ask <= pos.trailStop) {
    return forceSell(assetId, ask, latencyMs,
      `Trail ${(pos.trailStop*100).toFixed(2)}¢ pk${(pos.peakAsk*100).toFixed(2)}¢`, false);
  }

  if (ask <= hardStopPrice) {
    return forceSell(assetId, ask, latencyMs, `HardStop >${config.hardStopCents}¢ drop`, true);
  }

  if (ask < pos.buyAsk) {
    consecDownTicks[assetId] = (consecDownTicks[assetId] || 0) + 1;
    if (consecDownTicks[assetId] === 1) {
      totalDipCount[assetId] = (totalDipCount[assetId] || 0) + 1;
    }
    log(
      `DIP [${pos.marketSlug}] ${pos.outcomeName} | ${(ask*100).toFixed(2)}¢ | consec ${consecDownTicks[assetId]}/${config.stopLossConsecTicks} | dip events ${totalDipCount[assetId]}/${config.maxTotalDips}`,
      'warn'
    );
    if (consecDownTicks[assetId] >= config.stopLossConsecTicks) {
      return forceSell(assetId, ask, latencyMs, `ConsecStop ${config.stopLossConsecTicks} ticks`, true);
    }
    if (totalDipCount[assetId] >= config.maxTotalDips) {
      return forceSell(assetId, ask, latencyMs, `TotalDips ${config.maxTotalDips} episodes`, true);
    }
  } else {
    if ((consecDownTicks[assetId] || 0) > 0) {
      log(`BOUNCE [${pos.marketSlug}] ${pos.outcomeName} | ${(ask*100).toFixed(2)}¢ | consec reset | total dips: ${totalDipCount[assetId]}/${config.maxTotalDips}`, 'warn');
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

  // Never trade on a zero/invalid effective ask — wait for next valid tick.
  if (ask <= 0) return;

  const hadPosition = !!positions[assetId];
  log(
    `[${source}]${latencyMs!=null?' lat:'+latencyMs+'ms':''} [${tokenToMarket[assetId]||''}] ${outcomeName} | Ask:${(ask*100).toFixed(2)}¢ | Bid:${bid>0?(bid*100).toFixed(2)+'¢':'N/A'}`,
    'info'
  );

  tryBuy(assetId, outcomeName, ask, latencyMs);
  if (hadPosition || positions[assetId]) trySell(assetId, ask, latencyMs);
}

// ==================== WEBSOCKET (redundant dual connections, zero-delay reconnect) ====================
// Two independent sockets subscribed to the same assets. If one drops a
// packet, glitches, or momentarily disconnects, the other keeps feeding
// live data. Zero/garbage prices are dropped before they ever reach state,
// so lastAsk/lastBid never gets zeroed out and the bot never trades on $0.
// Reconnects fire immediately on close — no fixed delay — since every
// millisecond matters in a fast-moving tennis market.
function connectWebSocket(connId) {
  if (!running) return;
  log(`Connecting WS#${connId} to Polymarket CLOB...`, 'info');
  const ws = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/market');
  wsInstances[connId] = ws;

  ws.on('open', () => {
    log(`WS#${connId} connected — subscribing to ${clobTokenIds.length} assets across ${slugs.length} market(s)`, 'info');
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
      for (const change of (msg.price_changes || [])) {
        const assetId = change.asset_id;
        if (!assetId || !tokenToOutcome[assetId]) continue;
        const rawBid = parseFloat(change.best_bid || 0);
        const rawAsk = parseFloat(change.best_ask || 0);

        // Drop fully-empty ticks immediately — never let a $0/$0 tick
        // reach processTick or pollute state.
        if (rawBid <= 0 && rawAsk <= 0) continue;

        let tickLat = latencyMs;
        if (change.timestamp) {
          const tl = recvTime - parseInt(change.timestamp);
          if (tl >= 0 && tl < 30000) { tickLat = tl; wsLatencies.push(tl); }
        }
        processTick(assetId, tokenToOutcome[assetId], rawBid, rawAsk, `WS${connId}`, tickLat);
      }
    } catch (e) {}
  });

  ws.on('close', () => {
    if (!running) return;
    log(`WS#${connId} closed. Reconnecting immediately...`, 'info');
    // Zero-delay reconnect — fires on next event loop tick, no setTimeout wait.
    setImmediate(() => connectWebSocket(connId));
  });

  ws.on('error', () => { log(`WS#${connId} error`, 'info'); });
}

function connectAllWebSockets() {
  connectWebSocket(0);
  connectWebSocket(1);
}

// ==================== POLLING (fallback safety net) ====================
async function pollPrice(tokenId, outcomeName) {
  const t0 = Date.now();
  try {
    const res = await fetch(`https://clob.polymarket.com/price?token_id=${tokenId}`);
    if (!res.ok) return;
    const data = await res.json();
    const rawMid = parseFloat(data.price || 0);
    if (rawMid <= 0) return;
    processTick(tokenId, outcomeName, lastBid[tokenId] || 0, lastAsk[tokenId] || 0, 'POLL', Date.now() - t0);
  } catch (e) {}
}

function startPolling() {
  pollInterval = setInterval(() => {
    clobTokenIds.forEach((id, i) => pollPrice(id, tokenToOutcome[id] || `Outcome ${i + 1}`));
  }, 5000);
}

// ==================== INIT (fetches all markets, merges into one subscription list) ====================
async function fetchMarket(slug) {
  const res = await fetch(`https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(slug)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for slug ${slug}`);
  const data = await res.json();
  const market = data[0];
  if (!market) throw new Error(`Market not found for slug ${slug}`);
  return market;
}

async function init() {
  log(`Fetching market data for ${slugs.length} market(s): ${slugs.join(', ')}`, 'info');

  const safeParse = (val) => {
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') { try { return JSON.parse(val); } catch { return []; } }
    return [];
  };

  let anyLoaded = false;

  for (const slug of slugs) {
    try {
      const market = await fetchMarket(slug);

      const ids       = safeParse(market.clobTokenIds);
      const prices     = safeParse(market.outcomePrices);
      const outcomes   = safeParse(market.outcomes);
      if (ids.length === 0) {
        log(`Skipping ${slug}: no CLOB token IDs found`, 'warn');
        continue;
      }

      ids.forEach((id, i) => {
        clobTokenIds.push(id);
        tokenToOutcome[id]  = outcomes[i] || `Outcome ${i + 1}`;
        tokenToMarket[id]   = slug;
        lastAsk[id]         = parseFloat(prices[i] || 0);
        lastBid[id]         = 0;
        lastSellTime[id]    = 0;
        consecDownTicks[id] = 0;
        totalDipCount[id]   = 0;
      });

      log(`Loaded market [${slug}]: ${market.question}`, 'info');
      log(`  Outcomes: ${outcomes.join(' vs ')}`, 'info');
      log(`  Initial prices: ${prices.map((p, i) => `${outcomes[i]||i}: ${(parseFloat(p)*100).toFixed(2)}¢`).join(' | ')}`, 'info');
      anyLoaded = true;
    } catch (err) {
      log(`Error loading market [${slug}]: ${err.message}`, 'warn');
    }
  }

  if (!anyLoaded) {
    log('No markets could be loaded. Exiting.', 'info');
    process.exit(1);
  }

  log(
    `Strategy: BUY ${(config.buyZoneLow*100).toFixed(2)}–${(config.buyZoneHigh*100).toFixed(2)}¢` +
    ` | SELL ${(config.sellZoneLow*100).toFixed(2)}–${(config.sellZoneHigh*100).toFixed(2)}¢` +
    ` | ConsecStop ${config.stopLossConsecTicks} | MaxDips ${config.maxTotalDips}` +
    ` | HardStop -${config.hardStopCents}¢ | Trail +${config.trailActivateCents}¢ drop ${config.trailDropCents}¢` +
    ` | ZERO-DELAY rebuy + ZERO-DELAY reconnect`,
    'info'
  );
  log(`Starting balance: $${config.paperBalance}`, 'info');
  log(`Total assets monitored across all markets: ${clobTokenIds.length}`, 'info');

  startMaxHoldWatcher();
  connectAllWebSockets();
  startPolling();
}

// ==================== GRACEFUL SHUTDOWN ====================
function stop() {
  running = false;
  wsInstances.forEach(ws => { if (ws) ws.close(); });
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
console.log(`\x1b[90m  Markets:        ${slugs.join(', ')}\x1b[0m`);
console.log(`\x1b[90m  WS Conns:       2 redundant connections, zero-delay reconnect\x1b[0m`);
console.log(`\x1b[90m  Buy zone:       ${(config.buyZoneLow*100).toFixed(2)}–${(config.buyZoneHigh*100).toFixed(2)}¢\x1b[0m`);
console.log(`\x1b[90m  Sell zone:      ${(config.sellZoneLow*100).toFixed(2)}–${(config.sellZoneHigh*100).toFixed(2)}¢\x1b[0m`);
console.log(`\x1b[90m  Consec stop:    ${config.stopLossConsecTicks} ticks below buy\x1b[0m`);
console.log(`\x1b[90m  Max dip events: ${config.maxTotalDips} episodes\x1b[0m`);
console.log(`\x1b[90m  Hard stop:      -${config.hardStopCents}¢ instant\x1b[0m`);
console.log(`\x1b[90m  Trail:          +${config.trailActivateCents}¢ activates, ${config.trailDropCents}¢ drop\x1b[0m`);
console.log(`\x1b[90m  Rebuy:          INSTANT, no cooldown, no dip gate\x1b[0m`);
console.log(`\x1b[90m  Max hold:       ${config.maxHoldMs > 0 ? config.maxHoldMs + 'ms' : 'disabled'}\x1b[0m`);
console.log(`\x1b[90m  Balance:        $${config.paperBalance}\x1b[0m`);
console.log(`\x1b[90m  Cooldown:       ${config.buyCooldownMs}ms (0 = off)\x1b[0m\n`);

init();