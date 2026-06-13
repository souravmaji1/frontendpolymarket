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
  buyZoneLow:    getArg('buyLow',   0.62),
  buyZoneHigh:   getArg('buyHigh',  0.64),
  sellZoneLow:   getArg('sellLow',  0.68),
  sellZoneHigh:  getArg('sellHigh', 0.69),
  buyCooldownMs: getArg('cooldown', 0),
};

// ==================== STATE ====================
let running = true;
let positions = {};
let tradeLog = [];
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

// ==================== LOGGING ====================
function log(text, type = 'info') {
  const time = new Date().toLocaleTimeString();
  const colors = {
    buy: '\x1b[36m',
    sell_win: '\x1b[33m',
    sell_loss: '\x1b[31m',
    info: '\x1b[90m',
  };
  const reset = '\x1b[0m';
  const color = colors[type] || colors.info;
  console.log(`${color}[${time}] ${text}${reset}`);
}

function printStats() {
  const realizedPnL = trades
    .filter(t => t.type === 'SELL')
    .reduce((s, t) => s + parseFloat(t.pnl), 0);
  const wins = trades.filter(t => t.type === 'SELL' && parseFloat(t.pnl) >= 0).length;
  const losses = trades.filter(t => t.type === 'SELL' && parseFloat(t.pnl) < 0).length;
  const winRate = (wins + losses) > 0 ? ((wins / (wins + losses)) * 100).toFixed(0) + '%' : '--';
  const openCount = Object.keys(positions).length;
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  console.log('\n\x1b[90m─────────────────────────────────────────\x1b[0m');
  console.log(`\x1b[37m Balance:    \x1b[32m$${paperBalance.toFixed(2)}\x1b[0m  (started $${config.paperBalance})`);
  console.log(`\x1b[37m Realized:   \x1b[${realizedPnL >= 0 ? '36' : '31'}m${realizedPnL >= 0 ? '+' : ''}$${realizedPnL.toFixed(2)}\x1b[0m`);
  console.log(`\x1b[37m Win Rate:   \x1b[33m${winRate}\x1b[0m  (${wins}W / ${losses}L)`);
  console.log(`\x1b[37m Open Pos:   \x1b[35m${openCount}\x1b[0m`);
  console.log(`\x1b[37m Runtime:    \x1b[90m${mm}:${ss}\x1b[0m`);
  console.log(`\x1b[37m Trades:     \x1b[90m${trades.length}\x1b[0m`);
  console.log('\x1b[90m─────────────────────────────────────────\x1b[0m\n');
}

// ==================== TRADING LOGIC ====================
function tryBuy(assetId, outcomeName, ask) {
  if (positions[assetId]) return;
  if (!ask || ask <= 0) return;
  const cooldown = config.buyCooldownMs - (Date.now() - (lastSellTime[assetId] || 0));
  if (cooldown > 0) return;
  if (ask >= config.buyZoneLow && ask <= config.buyZoneHigh) {
    const shares = 1 / ask;
    const cost = 1;
    if (paperBalance < cost) return;
    paperBalance -= cost;
    positions[assetId] = { shares, buyAsk: ask, outcomeName, peakAsk: ask };
    const entry = {
      type: 'BUY',
      outcome: outcomeName,
      shares: shares.toFixed(4),
      askPrice: (ask * 100).toFixed(1),
      cost: cost.toFixed(2),
      balanceAfter: paperBalance.toFixed(2),
      time: new Date().toLocaleTimeString(),
      assetId,
    };
    trades.push(entry);
    tradeLog.push(entry);
    log(`BUY ${outcomeName} | Ask@${(ask * 100).toFixed(1)}¢ | ${shares.toFixed(4)}sh | $${cost.toFixed(2)}`, 'buy');
    printStats();
  }
}

function trySell(assetId, ask) {
  const pos = positions[assetId];
  if (!pos || !ask || ask <= 0) return;
  if (ask > pos.peakAsk) pos.peakAsk = ask;

  let shouldSell = false;
  let sellReason = '';

  if (ask < pos.buyAsk) {
    shouldSell = true;
    sellReason = `Stop-loss: bought@${(pos.buyAsk * 100).toFixed(1)}¢ now@${(ask * 100).toFixed(1)}¢`;
  }

  if (!shouldSell && ask >= config.sellZoneLow && ask <= config.sellZoneHigh) {
    shouldSell = true;
    sellReason = `Target zone: ask@${(ask * 100).toFixed(1)}¢`;
  }

  if (!shouldSell) return;

  const proceeds = pos.shares * ask;
  const cost = pos.shares * pos.buyAsk;
  const pnl = proceeds - cost;
  paperBalance += proceeds;
  lastSellTime[assetId] = Date.now();

  const entry = {
    type: 'SELL',
    outcome: pos.outcomeName,
    shares: pos.shares,
    buyAsk: (pos.buyAsk * 100).toFixed(1),
    sellAsk: (ask * 100).toFixed(1),
    peakAsk: (pos.peakAsk * 100).toFixed(1),
    pnl: pnl.toFixed(2),
    reason: sellReason,
    balanceAfter: paperBalance.toFixed(2),
    time: new Date().toLocaleTimeString(),
    assetId,
  };
  trades.push(entry);
  tradeLog.push(entry);
  delete positions[assetId];

  const type = pnl >= 0 ? 'sell_win' : 'sell_loss';
  const icon = pnl >= 0 ? 'SELL WIN' : 'SELL LOSS';
  log(
    `${icon} ${pos.outcomeName} | ${(pos.buyAsk * 100).toFixed(1)}¢→${(ask * 100).toFixed(1)}¢ | P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} | ${sellReason}`,
    type
  );
  printStats();
}

function processTick(assetId, outcomeName, rawMid, rawBid, rawAsk, source) {
  const bid = rawBid > 0 ? rawBid : (lastBid[assetId] || 0);
  const ask = rawAsk > 0 ? rawAsk : (lastAsk[assetId] || 0);
  if (bid > 0) lastBid[assetId] = bid;
  if (ask > 0) lastAsk[assetId] = ask;

  const hadPositionBefore = !!positions[assetId];

  log(
    `[${source}] ${outcomeName} | Ask: ${ask > 0 ? (ask * 100).toFixed(1) + '¢' : 'N/A'} | Bid: ${bid > 0 ? (bid * 100).toFixed(1) + '¢' : 'N/A'}`,
    'info'
  );

  tryBuy(assetId, outcomeName, ask);

  if (hadPositionBefore) {
    trySell(assetId, ask);
  }
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
    try {
      const msg = JSON.parse(data.toString());
      const priceChanges = msg.price_changes || [];
      for (const change of priceChanges) {
        const assetId = change.asset_id;
        if (!assetId || !tokenToOutcome[assetId]) continue;
        const outcomeName = tokenToOutcome[assetId];
        const rawMid = parseFloat(change.price || 0);
        const rawBid = parseFloat(change.best_bid || 0);
        const rawAsk = parseFloat(change.best_ask || 0);
        processTick(assetId, outcomeName, rawMid, rawBid, rawAsk, 'WS');
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
  try {
    const res = await fetch(`https://clob.polymarket.com/price?token_id=${tokenId}`);
    if (!res.ok) return;
    const data = await res.json();
    const rawMid = parseFloat(data.price || 0);
    if (rawMid <= 0) return;
    const rawBid = lastBid[tokenId] || 0;
    const rawAsk = lastAsk[tokenId] || 0;
    processTick(tokenId, outcomeName, rawMid, rawBid, rawAsk, 'POLL');
  } catch (e) {}
}

function startPolling() {
  pollInterval = setInterval(() => {
    clobTokenIds.forEach((id, i) => {
      const outcomeName = tokenToOutcome[id] || `Outcome ${i + 1}`;
      pollPrice(id, outcomeName);
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
      if (typeof val === 'string') {
        try { return JSON.parse(val); } catch { return []; }
      }
      return [];
    };

    clobTokenIds = safeParse(market.clobTokenIds);
    const prices = safeParse(market.outcomePrices);
    const outcomes = safeParse(market.outcomes);

    if (clobTokenIds.length === 0) throw new Error('No CLOB token IDs found for this market');

    clobTokenIds.forEach((id, i) => {
      tokenToOutcome[id] = outcomes[i] || `Outcome ${i + 1}`;
      lastAsk[id] = parseFloat(prices[i] || 0);
      lastBid[id] = 0;
      lastSellTime[id] = 0;
    });

    log(`Market: ${market.question}`, 'info');
    log(`Outcomes: ${outcomes.join(' vs ')}`, 'info');
    log(`Assets: ${clobTokenIds.length} token(s) found`, 'info');
    log(
      `Initial prices: ${prices.map((p, i) => `${outcomes[i] || i}: ${(parseFloat(p) * 100).toFixed(1)}¢`).join(' | ')}`,
      'info'
    );
    log(
      `Strategy: BUY ${(config.buyZoneLow * 100)}–${(config.buyZoneHigh * 100)}¢ | SELL ${(config.sellZoneLow * 100)}–${(config.sellZoneHigh * 100)}¢`,
      'info'
    );
    log(`Starting balance: $${config.paperBalance}`, 'info');

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
  log(`Bot stopped. Final balance: $${paperBalance.toFixed(2)}`, 'info');
  printStats();
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
console.log(`\x1b[90m  Buy zone:  ${config.buyZoneLow * 100}–${config.buyZoneHigh * 100}¢\x1b[0m`);
console.log(`\x1b[90m  Sell zone: ${config.sellZoneLow * 100}–${config.sellZoneHigh * 100}¢\x1b[0m`);
console.log(`\x1b[90m  Balance:   $${config.paperBalance}\x1b[0m`);
console.log(`\x1b[90m  Cooldown:  ${config.buyCooldownMs}ms\x1b[0m\n`);

init();