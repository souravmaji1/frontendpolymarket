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
  paperBalance:  getArg('balance',  10),
  buyZoneLow:    getArg('buyLow',   0.62) / 100,
  buyZoneHigh:   getArg('buyHigh',  0.64) / 100,
  sellZoneLow:   getArg('sellLow',  0.68) / 100,
  sellZoneHigh:  getArg('sellHigh', 0.69) / 100,
  buyCooldownMs: getArg('cooldown', 0),
};

// ==================== STATE ====================
let running = true;
let positions = {};
let paperBalance = config.paperBalance;
let lastAsk = {};
let lastBid = {};
let lastSellTime = {};
let wsInstance = null;
let pollInterval = null;
let tokenToOutcome = {};
let clobTokenIds = [];
let trades = [];
let startTime = Date.now();
let tradeCounter = 0;
let wsLatencies = [];

// last trade snapshot for inline display
let lastTradeSnap = null;

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

// ==================== LIVE SUMMARY WITH LAST TRADE PANEL ====================
function printLiveSummary() {
  const realizedPnL = trades
    .filter(t => t.type === 'SELL')
    .reduce((s, t) => s + t.pnl, 0);
  const wins   = trades.filter(t => t.type === 'SELL' && t.pnl >= 0).length;
  const losses = trades.filter(t => t.type === 'SELL' && t.pnl < 0).length;
  const winRate = (wins + losses) > 0 ? ((wins / (wins + losses)) * 100).toFixed(0) + '%' : '--';
  const openCount = Object.keys(positions).length;
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  const avgLatency = wsLatencies.length > 0
    ? (wsLatencies.slice(-20).reduce((a, b) => a + b, 0) / Math.min(wsLatencies.length, 20)).toFixed(0) + 'ms'
    : '--';

  // ── left column: session stats ──
  const left = [
    `${C.white} Balance  : ${C.green}$${paperBalance.toFixed(4)}${C.reset}  (started $${config.paperBalance})`,
    `${C.white} Realized : ${realizedPnL >= 0 ? C.cyan : C.red}${realizedPnL >= 0 ? '+' : ''}$${realizedPnL.toFixed(4)}${C.reset}`,
    `${C.white} Win Rate : ${C.yellow}${winRate}${C.reset}  (${wins}W / ${losses}L)`,
    `${C.white} Open Pos : ${C.magenta}${openCount}${C.reset}`,
    `${C.white} Runtime  : ${C.grey}${mm}:${ss}${C.reset}`,
    `${C.white} Trades   : ${C.grey}${trades.length}${C.reset}`,
    `${C.white} Avg Lat  : ${C.grey}${avgLatency}${C.reset}`,
  ];

  // ── right column: last trade panel ──
  let right = [];
  if (lastTradeSnap) {
    const t = lastTradeSnap;
    const isBuy  = t.type === 'BUY';
    const isWin  = !isBuy && t.pnl >= 0;
    const typeColor = isBuy ? C.cyan : (isWin ? C.green : C.red);
    const typeLabel = isBuy ? '  BUY  ' : (isWin ? 'SELL WIN' : 'SELL LOSS');
    const latStr = t.latencyMs != null ? `${t.latencyMs}ms` : '--';
    const pnlStr = isBuy
      ? `${C.grey}—${C.reset}`
      : `${isWin ? C.green : C.red}${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(4)}${C.reset}`;

    right = [
      `${C.grey}┌─── LAST TRADE ──────────────────────┐${C.reset}`,
      `${C.grey}│${C.reset} Type     : ${typeColor}${typeLabel}${C.reset}`,
      `${C.grey}│${C.reset} Outcome  : ${C.white}${t.outcome.substring(0, 22)}${C.reset}`,
      `${C.grey}│${C.reset} Shares   : ${C.white}${t.shares.toFixed(6)}${C.reset}`,
      `${C.grey}│${C.reset} Buy @    : ${C.white}${(t.buyAsk * 100).toFixed(2)}¢${C.reset}`,
      `${C.grey}│${C.reset} Sell @   : ${isBuy ? `${C.grey}—${C.reset}` : `${C.white}${(t.sellAsk * 100).toFixed(2)}¢${C.reset}`}`,
      `${C.grey}│${C.reset} P&L      : ${pnlStr}`,
      `${C.grey}│${C.reset} Latency  : ${C.yellow}${latStr}${C.reset}`,
      `${C.grey}│${C.reset} Time     : ${C.grey}${t.time}${C.reset}`,
      `${C.grey}│${C.reset} Balance  : ${C.green}$${t.balanceAfter.toFixed(4)}${C.reset}`,
      `${C.grey}└─────────────────────────────────────┘${C.reset}`,
    ];
  } else {
    right = [
      `${C.grey}┌─── LAST TRADE ──────────────────────┐${C.reset}`,
      `${C.grey}│${C.reset}  No trades yet...                   ${C.grey}│${C.reset}`,
      `${C.grey}└─────────────────────────────────────┘${C.reset}`,
    ];
  }

  // ── render side by side ──
  console.log(`\n${C.grey}─────────────────────────────────────────────────────────────────────────${C.reset}`);
  const maxRows = Math.max(left.length, right.length);
  for (let i = 0; i < maxRows; i++) {
    const l = left[i]  || '';
    const r = right[i] || '';
    // strip ansi for padding calculation
    const lClean = l.replace(/\x1b\[[0-9;]*m/g, '');
    const pad = 42 - lClean.length;
    console.log(`${l}${' '.repeat(Math.max(pad, 2))}${r}`);
  }
  console.log(`${C.grey}─────────────────────────────────────────────────────────────────────────${C.reset}\n`);
}

// ==================== FINAL REPORT ====================
function printFinalReport() {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  console.log(`\n${C.yellow}${'═'.repeat(110)}${C.reset}`);
  console.log(`${C.bold}${C.yellow}  FINAL TRADE REPORT${C.reset}`);
  console.log(`${C.yellow}${'═'.repeat(110)}${C.reset}`);

  const hdr = [
    pad('#',        4),
    pad('Time',    10),
    pad('Type',    10),
    pad('Outcome', 18),
    pad('Shares',  10, true),
    pad('Buy¢',     8, true),
    pad('Sell¢',    8, true),
    pad('Cost($)',  9, true),
    pad('Proceeds', 10, true),
    pad('P&L($)',   10, true),
    pad('Balance',  10, true),
    pad('Latency',  9, true),
    pad('Reason',  22),
  ].join('  ');
  console.log(`${C.grey}  ${hdr}${C.reset}`);
  console.log(`${C.grey}  ${'─'.repeat(108)}${C.reset}`);

  let runningBal = config.paperBalance;
  for (const t of trades) {
    const isBuy = t.type === 'BUY';
    const isWin = !isBuy && t.pnl >= 0;
    const color = isBuy ? C.cyan : (isWin ? C.green : C.red);
    const typeLabel = isBuy ? 'BUY' : (isWin ? 'SELL WIN' : 'SELL LOSS');

    if (isBuy) runningBal -= t.cost;
    else        runningBal += t.proceeds;

    const row = [
      pad(t.id,                                                          4),
      pad(t.time,                                                       10),
      pad(typeLabel,                                                    10),
      pad(t.outcome.substring(0, 17),                                  18),
      pad(t.shares.toFixed(6),                                         10, true),
      pad((t.buyAsk * 100).toFixed(2),                                  8, true),
      pad(isBuy ? '—' : (t.sellAsk * 100).toFixed(2),                  8, true),
      pad(isBuy ? t.cost.toFixed(4) : '—',                             9, true),
      pad(isBuy ? '—' : t.proceeds.toFixed(4),                        10, true),
      pad(isBuy ? '—' : (t.pnl >= 0 ? '+' : '') + t.pnl.toFixed(4),  10, true),
      pad('$' + runningBal.toFixed(4),                                 10, true),
      pad(t.latencyMs != null ? t.latencyMs + 'ms' : '--',             9, true),
      pad((t.reason || '').substring(0, 22),                          22),
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
  const avgWin      = wins   > 0 ? (sellTrades.filter(t => t.pnl >= 0).reduce((s, t) => s + t.pnl, 0) / wins).toFixed(4)  : '--';
  const avgLoss     = losses > 0 ? (sellTrades.filter(t => t.pnl < 0).reduce((s, t) => s + t.pnl, 0) / losses).toFixed(4) : '--';
  const avgLat      = wsLatencies.length > 0
    ? (wsLatencies.reduce((a, b) => a + b, 0) / wsLatencies.length).toFixed(0) + 'ms' : '--';

  console.log(`${C.grey}  ${'─'.repeat(108)}${C.reset}`);
  console.log(`\n${C.yellow}  SUMMARY${C.reset}`);
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
  console.log(`${C.yellow}${'═'.repeat(110)}${C.reset}\n`);
}

// ==================== TRADING LOGIC ====================
function tryBuy(assetId, outcomeName, ask, latencyMs) {
  if (positions[assetId]) return;
  if (!ask || ask <= 0) return;
  const cooldown = config.buyCooldownMs - (Date.now() - (lastSellTime[assetId] || 0));
  if (cooldown > 0) return;

  if (ask >= config.buyZoneLow && ask <= config.buyZoneHigh) {
    const cost   = 1.00;
    const shares = cost / ask;
    if (paperBalance < cost) return;

    paperBalance -= cost;
    positions[assetId] = { shares, buyAsk: ask, outcomeName, peakAsk: ask };

    tradeCounter++;
    const entry = {
      id:          tradeCounter,
      type:        'BUY',
      outcome:     outcomeName,
      shares,
      buyAsk:      ask,
      sellAsk:     null,
      cost,
      proceeds:    null,
      pnl:         null,
      balanceAfter: paperBalance,
      time:        new Date().toLocaleTimeString(),
      assetId,
      latencyMs:   latencyMs ?? null,
      reason:      'Buy zone hit',
    };
    trades.push(entry);
    lastTradeSnap = entry;

    log(
      `BUY  ${outcomeName} | Ask@${(ask*100).toFixed(2)}¢ | ${shares.toFixed(6)}sh | cost $${cost.toFixed(2)} | lat:${latencyMs != null ? latencyMs+'ms' : '--'} | bal $${paperBalance.toFixed(4)}`,
      'buy'
    );
    printLiveSummary();
  }
}

function trySell(assetId, ask, latencyMs) {
  const pos = positions[assetId];
  if (!pos || !ask || ask <= 0) return;
  if (ask > pos.peakAsk) pos.peakAsk = ask;

  let shouldSell = false;
  let sellReason = '';

  if (ask < pos.buyAsk) {
    shouldSell = true;
    sellReason = `StopLoss ${(pos.buyAsk*100).toFixed(2)}→${(ask*100).toFixed(2)}¢`;
  }
  if (!shouldSell && ask >= config.sellZoneLow && ask <= config.sellZoneHigh) {
    shouldSell = true;
    sellReason = `Target ${(ask*100).toFixed(2)}¢`;
  }
  if (!shouldSell) return;

  const proceeds = pos.shares * ask;
  const cost     = pos.shares * pos.buyAsk;
  const pnl      = proceeds - cost;
  paperBalance  += proceeds;
  lastSellTime[assetId] = Date.now();

  tradeCounter++;
  const entry = {
    id:          tradeCounter,
    type:        'SELL',
    outcome:     pos.outcomeName,
    shares:      pos.shares,
    buyAsk:      pos.buyAsk,
    sellAsk:     ask,
    cost,
    proceeds,
    pnl,
    balanceAfter: paperBalance,
    time:        new Date().toLocaleTimeString(),
    assetId,
    latencyMs:   latencyMs ?? null,
    reason:      sellReason,
  };
  trades.push(entry);
  lastTradeSnap = entry;
  delete positions[assetId];

  const type = pnl >= 0 ? 'sell_win' : 'sell_loss';
  const icon = pnl >= 0 ? 'SELL WIN ' : 'SELL LOSS';
  log(
    `${icon} ${pos.outcomeName} | ${(pos.buyAsk*100).toFixed(2)}¢→${(ask*100).toFixed(2)}¢ | P&L ${pnl>=0?'+':''}$${pnl.toFixed(4)} | lat:${latencyMs != null ? latencyMs+'ms' : '--'} | bal $${paperBalance.toFixed(4)} | ${sellReason}`,
    type
  );
  printLiveSummary();
}

// ==================== TICK ====================
function processTick(assetId, outcomeName, rawBid, rawAsk, source, latencyMs) {
  const bid = rawBid > 0 ? rawBid : (lastBid[assetId] || 0);
  const ask = rawAsk > 0 ? rawAsk : (lastAsk[assetId] || 0);
  if (bid > 0) lastBid[assetId] = bid;
  if (ask > 0) lastAsk[assetId] = ask;

  const hadPosition = !!positions[assetId];

  log(
    `[${source}]${latencyMs != null ? ' lat:' + latencyMs + 'ms' : ''} ${outcomeName} | Ask:${ask > 0 ? (ask*100).toFixed(2)+'¢' : 'N/A'} | Bid:${bid > 0 ? (bid*100).toFixed(2)+'¢' : 'N/A'}`,
    'info'
  );

  tryBuy(assetId, outcomeName, ask, latencyMs);
  if (hadPosition) trySell(assetId, ask, latencyMs);
}

// ==================== WEBSOCKET ====================
function connectWebSocket() {
  if (!running) return;
  log('Connecting to Polymarket CLOB WebSocket...', 'info');
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
    try {
      const msg = JSON.parse(data.toString());
      let latencyMs = null;
      if (msg.timestamp) {
        const tl = recvTime - parseInt(msg.timestamp);
        if (tl >= 0 && tl < 30000) { latencyMs = tl; wsLatencies.push(tl); }
      }
      const priceChanges = msg.price_changes || [];
      for (const change of priceChanges) {
        const assetId = change.asset_id;
        if (!assetId || !tokenToOutcome[assetId]) continue;
        const outcomeName = tokenToOutcome[assetId];
        const rawBid = parseFloat(change.best_bid || 0);
        const rawAsk = parseFloat(change.best_ask || 0);
        let tickLat = latencyMs;
        if (change.timestamp) {
          const tl = recvTime - parseInt(change.timestamp);
          if (tl >= 0 && tl < 30000) { tickLat = tl; wsLatencies.push(tl); }
        }
        processTick(assetId, outcomeName, rawBid, rawAsk, 'WS', tickLat);
      }
    } catch (e) {}
  });

  ws.on('close', () => {
    if (!running) return;
    log('WebSocket closed. Reconnecting in 4s...', 'info');
    setTimeout(connectWebSocket, 4000);
  });

  ws.on('error', () => {
    log('WebSocket error — falling back to polling', 'info');
  });
}

// ==================== POLLING ====================
async function pollPrice(tokenId, outcomeName) {
  const t0 = Date.now();
  try {
    const res = await fetch(`https://clob.polymarket.com/price?token_id=${tokenId}`);
    if (!res.ok) return;
    const data = await res.json();
    const latencyMs = Date.now() - t0;
    const rawMid = parseFloat(data.price || 0);
    if (rawMid <= 0) return;
    processTick(tokenId, outcomeName, lastBid[tokenId] || 0, lastAsk[tokenId] || 0, 'POLL', latencyMs);
  } catch (e) {}
}

function startPolling() {
  pollInterval = setInterval(() => {
    clobTokenIds.forEach((id, i) => {
      pollPrice(id, tokenToOutcome[id] || `Outcome ${i + 1}`);
    });
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
    if (!market) throw new Error('Market not found for that slug');

    const safeParse = (val) => {
      if (Array.isArray(val)) return val;
      if (typeof val === 'string') { try { return JSON.parse(val); } catch { return []; } }
      return [];
    };

    clobTokenIds        = safeParse(market.clobTokenIds);
    const prices        = safeParse(market.outcomePrices);
    const outcomes      = safeParse(market.outcomes);

    if (clobTokenIds.length === 0) throw new Error('No CLOB token IDs found');

    clobTokenIds.forEach((id, i) => {
      tokenToOutcome[id] = outcomes[i] || `Outcome ${i + 1}`;
      lastAsk[id]        = parseFloat(prices[i] || 0);
      lastBid[id]        = 0;
      lastSellTime[id]   = 0;
    });

    log(`Market: ${market.question}`, 'info');
    log(`Outcomes: ${outcomes.join(' vs ')}`, 'info');
    log(`Assets: ${clobTokenIds.length} token(s)`, 'info');
    log(`Initial prices: ${prices.map((p, i) => `${outcomes[i]||i}: ${(parseFloat(p)*100).toFixed(2)}¢`).join(' | ')}`, 'info');
    log(`Strategy: BUY ${(config.buyZoneLow*100).toFixed(2)}–${(config.buyZoneHigh*100).toFixed(2)}¢ | SELL ${(config.sellZoneLow*100).toFixed(2)}–${(config.sellZoneHigh*100).toFixed(2)}¢`, 'info');
    log(`Starting balance: $${config.paperBalance}`, 'info');

    connectWebSocket();
    startPolling();
  } catch (err) {
    log(`Error: ${err.message}`, 'info');
    process.exit(1);
  }
}

// ==================== SHUTDOWN ====================
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
console.log(`\x1b[90m  Slug:      ${slug}\x1b[0m`);
console.log(`\x1b[90m  Buy zone:  ${(config.buyZoneLow*100).toFixed(2)}–${(config.buyZoneHigh*100).toFixed(2)}¢\x1b[0m`);
console.log(`\x1b[90m  Sell zone: ${(config.sellZoneLow*100).toFixed(2)}–${(config.sellZoneHigh*100).toFixed(2)}¢\x1b[0m`);
console.log(`\x1b[90m  Balance:   $${config.paperBalance}\x1b[0m`);
console.log(`\x1b[90m  Cooldown:  ${config.buyCooldownMs}ms\x1b[0m\n`);

init();