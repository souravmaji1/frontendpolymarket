const WebSocket = require('ws');

const slug = process.argv[2] || 'atp-sonego-basilas-2026-06-14';

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

const config = {
  paperBalance:     getArg('balance',  10),
  buyZoneLow:       getArg('buyLow',   62) / 100,
  buyZoneHigh:      getArg('buyHigh',  64) / 100,
  sellZoneLow:      getArg('sellLow',  68) / 100,
  sellZoneHigh:     getArg('sellHigh', 69) / 100,
  stopLoss:         getArg('stopLoss', 80) / 100,
  stopSlippage:     getArg('slippage',  1) / 100,
  buyCooldownMs:    getArg('cooldown',  0),
};
config.stopLossFloor = config.stopLoss - config.stopSlippage;

let running        = true;
let positions      = {};
let paperBalance   = config.paperBalance;
let lastSellTime   = {};
let wsInstance     = null;
let pollInterval   = null;
let tokenToOutcome = {};
let clobTokenIds   = [];
let trades         = [];
let startTime      = Date.now();
let tradeCounter   = 0;
let wsLatencies    = [];
let lastValidAsk   = {};
let lastValidBid   = {};
let lastAskTime    = {};

const C = {
  reset:'\x1b[0m', grey:'\x1b[90m', white:'\x1b[37m', green:'\x1b[32m',
  red:'\x1b[31m', yellow:'\x1b[33m', cyan:'\x1b[36m', magenta:'\x1b[35m', bold:'\x1b[1m',
};

function log(text, type = 'info') {
  const time = new Date().toLocaleTimeString();
  const colors = { buy:C.cyan, sell_win:C.green, sell_loss:C.red, info:C.grey, warn:C.yellow };
  console.log(`${colors[type]||C.grey}[${time}] ${text}${C.reset}`);
}

function pad(str, len, right = false) {
  const s = String(str);
  return right ? s.padStart(len) : s.padEnd(len);
}

function printLiveSummary() {
  const realizedPnL = trades.filter(t=>t.type==='SELL').reduce((s,t)=>s+t.pnl,0);
  const wins   = trades.filter(t=>t.type==='SELL'&&t.pnl>=0).length;
  const losses = trades.filter(t=>t.type==='SELL'&&t.pnl<0).length;
  const winRate = (wins+losses)>0 ? ((wins/(wins+losses))*100).toFixed(0)+'%' : '--';
  const elapsed = Math.floor((Date.now()-startTime)/1000);
  const mm = String(Math.floor(elapsed/60)).padStart(2,'0');
  const ss = String(elapsed%60).padStart(2,'0');
  const avgLat = wsLatencies.length>0
    ? (wsLatencies.slice(-20).reduce((a,b)=>a+b,0)/Math.min(wsLatencies.length,20)).toFixed(0)+'ms' : '--';

  console.log(`\n${C.grey}─────────────────────────────────────────${C.reset}`);
  console.log(`${C.white} Balance:  ${C.green}$${paperBalance.toFixed(2)}${C.reset}  (started $${config.paperBalance})`);
  console.log(`${C.white} Realized: ${realizedPnL>=0?C.cyan:C.red}${realizedPnL>=0?'+':''}$${realizedPnL.toFixed(4)}${C.reset}`);
  console.log(`${C.white} Win Rate: ${C.yellow}${winRate}${C.reset}  (${wins}W / ${losses}L)`);
  console.log(`${C.white} Open Pos: ${C.magenta}${Object.keys(positions).length}${C.reset}`);
  console.log(`${C.white} Runtime:  ${C.grey}${mm}:${ss}${C.reset}`);
  console.log(`${C.white} Trades:   ${C.grey}${trades.length}${C.reset}`);
  console.log(`${C.white} Avg Lat:  ${C.grey}${avgLat}${C.reset}`);
  console.log(`${C.grey}─────────────────────────────────────────${C.reset}\n`);
}

function printFinalReport() {
  const elapsed = Math.floor((Date.now()-startTime)/1000);
  const mm = String(Math.floor(elapsed/60)).padStart(2,'0');
  const ss = String(elapsed%60).padStart(2,'0');
  const sellTrades   = trades.filter(t=>t.type==='SELL');
  const realizedPnL  = sellTrades.reduce((s,t)=>s+t.pnl,0);
  const totalCost    = trades.filter(t=>t.type==='BUY').reduce((s,t)=>s+t.cost,0);
  const totalProc    = sellTrades.reduce((s,t)=>s+t.proceeds,0);
  const wins         = sellTrades.filter(t=>t.pnl>=0).length;
  const losses       = sellTrades.filter(t=>t.pnl<0).length;
  const winRate      = (wins+losses)>0 ? ((wins/(wins+losses))*100).toFixed(1)+'%' : '--';
  const avgWin       = wins>0   ? (sellTrades.filter(t=>t.pnl>=0).reduce((s,t)=>s+t.pnl,0)/wins).toFixed(4)   : '--';
  const avgLoss      = losses>0 ? (sellTrades.filter(t=>t.pnl<0).reduce((s,t)=>s+t.pnl,0)/losses).toFixed(4)  : '--';
  const avgLat       = wsLatencies.length>0 ? (wsLatencies.reduce((a,b)=>a+b,0)/wsLatencies.length).toFixed(0)+'ms' : '--';

  console.log(`\n${C.yellow}${'═'.repeat(110)}${C.reset}`);
  console.log(`${C.bold}${C.yellow}  FINAL TRADE REPORT${C.reset}`);
  console.log(`${C.yellow}${'═'.repeat(110)}${C.reset}`);

  const hdr = [
    pad('#',4), pad('Time',10), pad('Type',10), pad('Outcome',18),
    pad('Shares',10,true), pad('Buy¢',7,true), pad('Sell¢',7,true),
    pad('Cost($)',9,true), pad('Proceeds',10,true), pad('P&L($)',9,true),
    pad('Balance',9,true), pad('Latency',9,true), pad('Reason',20),
  ].join('  ');
  console.log(`${C.grey}  ${hdr}${C.reset}`);
  console.log(`${C.grey}  ${'─'.repeat(108)}${C.reset}`);

  let runningBal = config.paperBalance;
  for (const t of trades) {
    let color = C.grey;
    let typeLabel = t.type;
    if (t.type==='BUY') { color=C.cyan; runningBal -= t.cost; }
    else { color = t.pnl>=0?C.green:C.red; typeLabel=t.pnl>=0?'SELL WIN':'SELL LOSS'; runningBal+=t.proceeds; }

    const row = [
      pad(t.id,4),
      pad(t.time,10),
      pad(typeLabel,10),
      pad(t.outcome.substring(0,17),18),
      pad(t.shares.toFixed(4),10,true),
      pad((t.buyAsk*100).toFixed(2),7,true),
      pad(t.type==='SELL'?(t.sellAsk*100).toFixed(2):'—',7,true),
      pad(t.type==='BUY'?t.cost.toFixed(4):'—',9,true),
      pad(t.type==='SELL'?t.proceeds.toFixed(4):'—',10,true),
      pad(t.type==='SELL'?(t.pnl>=0?'+':'')+t.pnl.toFixed(4):'—',9,true),
      pad('$'+runningBal.toFixed(4),9,true),
      pad(t.latencyMs!=null?t.latencyMs+'ms':'--',9,true),
      pad((t.reason||'').substring(0,20),20),
    ].join('  ');
    console.log(`${color}  ${row}${C.reset}`);
  }

  console.log(`${C.grey}  ${'─'.repeat(108)}${C.reset}`);
  console.log(`\n${C.yellow}  SUMMARY${C.reset}`);
  console.log(`${C.white}  Final Balance : ${C.green}$${paperBalance.toFixed(4)}${C.reset}   (started $${config.paperBalance})`);
  console.log(`${C.white}  Total Cost    : ${C.red}-$${totalCost.toFixed(4)}${C.reset}`);
  console.log(`${C.white}  Total Proceeds: ${C.green}+$${totalProc.toFixed(4)}${C.reset}`);
  console.log(`${C.white}  Realized P&L  : ${realizedPnL>=0?C.green:C.red}${realizedPnL>=0?'+':''}$${realizedPnL.toFixed(4)}${C.reset}`);
  console.log(`${C.white}  Trades        : ${trades.length} total  (${trades.filter(t=>t.type==='BUY').length} buys / ${sellTrades.length} sells)`);
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
    positions[assetId] = {
      shares, buyAsk: ask, outcomeName, peakAsk: ask,
      stopLossPrice: config.stopLoss,
      stopLossFloor: config.stopLossFloor,
    };

    tradeCounter++;
    trades.push({
      id:tradeCounter, type:'BUY', outcome:outcomeName,
      shares, buyAsk:ask, sellAsk:null, cost, proceeds:null, pnl:null,
      time:new Date().toLocaleTimeString(), assetId, latencyMs,
      reason:'Buy zone hit',
    });
    log(`BUY  ${outcomeName} | Ask@${(ask*100).toFixed(2)}¢ | ${shares.toFixed(4)}sh | SL@${(config.stopLoss*100).toFixed(2)}¢ floor@${(config.stopLossFloor*100).toFixed(2)}¢ | lat:${latencyMs??'--'}ms | bal $${paperBalance.toFixed(2)}`, 'buy');
    printLiveSummary();
  }
}

function trySell(assetId, ask, latencyMs) {
  const pos = positions[assetId];
  if (!pos) return;

  // Never sell on a missing or zero ask
  if (!ask || ask <= 0) {
    log(`[SKIP] ${pos.outcomeName} — ask missing, holding`, 'warn');
    return;
  }

  // Never sell on a tick older than 5 seconds
  const askAge = Date.now() - (lastAskTime[assetId] || 0);
  if (askAge > 5000) {
    log(`[SKIP] ${pos.outcomeName} — ask is ${askAge}ms stale, holding`, 'warn');
    return;
  }

  if (ask > pos.peakAsk) pos.peakAsk = ask;

  let shouldSell = false;
  let sellReason = '';

  // Stop-loss — but respect the floor
  if (ask <= pos.stopLossPrice) {
    if (ask < pos.stopLossFloor) {
      log(`[SL SKIP] ${pos.outcomeName} | ${(ask*100).toFixed(2)}¢ below floor ${(pos.stopLossFloor*100).toFixed(2)}¢ — holding`, 'warn');
      return;
    }
    shouldSell = true;
    sellReason = `StopLoss @ ${(ask*100).toFixed(2)}¢`;
  }

  // Take profit
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
  trades.push({
    id:tradeCounter, type:'SELL', outcome:pos.outcomeName,
    shares:pos.shares, buyAsk:pos.buyAsk, sellAsk:ask, cost, proceeds, pnl,
    time:new Date().toLocaleTimeString(), assetId, latencyMs, reason:sellReason,
  });
  delete positions[assetId];

  const type = pnl>=0 ? 'sell_win' : 'sell_loss';
  log(`${pnl>=0?'SELL WIN ':'SELL LOSS'} ${pos.outcomeName} | ${(pos.buyAsk*100).toFixed(2)}¢→${(ask*100).toFixed(2)}¢ | P&L ${pnl>=0?'+':''}$${pnl.toFixed(4)} | ${sellReason}`, type);
  printLiveSummary();
}

// ==================== PROCESS TICK ====================

function processPriceChangeTick(change, recvTime) {
  const assetId     = change.asset_id;
  const outcomeName = tokenToOutcome[assetId];
  if (!outcomeName) return;

  const rawAsk = parseFloat(change.best_ask || 0);
  const rawBid = parseFloat(change.best_bid || 0);

  if (rawAsk > 0) { lastValidAsk[assetId] = rawAsk; lastAskTime[assetId] = recvTime; }
  if (rawBid > 0) { lastValidBid[assetId] = rawBid; }

  const ask = rawAsk > 0 ? rawAsk : 0;
  const bid = rawBid > 0 ? rawBid : 0;

  let latencyMs = null;
  if (change.timestamp) {
    const lat = recvTime - parseInt(change.timestamp);
    if (lat >= 0 && lat < 30000) { latencyMs = lat; wsLatencies.push(lat); }
  }

  log(
    `[PC] ${outcomeName} | side:${change.side||'?'} trade:${(parseFloat(change.price||0)*100).toFixed(2)}¢ | Ask:${ask>0?(ask*100).toFixed(2)+'¢':'MISSING'} Bid:${bid>0?(bid*100).toFixed(2)+'¢':'MISSING'} | lat:${latencyMs??'--'}ms`,
    'info'
  );

  const hadPosition = !!positions[assetId];
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
      const raw = data.toString();
      const parsed = JSON.parse(raw);

      // The feed sends an array of book snapshots first
      if (Array.isArray(parsed)) {
        for (const book of parsed) {
          const assetId = book.asset_id;
          if (!assetId || !tokenToOutcome[assetId]) continue;
          if (book.asks && book.asks.length > 0) {
            const bestAsk = Math.min(...book.asks.map(a => parseFloat(a.price)));
            if (bestAsk > 0) { lastValidAsk[assetId] = bestAsk; lastAskTime[assetId] = recvTime; }
            log(`[BOOK] ${tokenToOutcome[assetId]} best ask from snapshot: ${(bestAsk*100).toFixed(2)}¢`, 'info');
          }
          if (book.bids && book.bids.length > 0) {
            const bestBid = Math.max(...book.bids.map(b => parseFloat(b.price)));
            if (bestBid > 0) lastValidBid[assetId] = bestBid;
          }
        }
        return; // never trade on book snapshots
      }

      // Single object — check event_type
      if (parsed.event_type === 'book') {
        const assetId = parsed.asset_id;
        if (assetId && tokenToOutcome[assetId]) {
          if (parsed.asks && parsed.asks.length > 0) {
            const bestAsk = Math.min(...parsed.asks.map(a => parseFloat(a.price)));
            if (bestAsk > 0) { lastValidAsk[assetId] = bestAsk; lastAskTime[assetId] = recvTime; }
            log(`[BOOK] ${tokenToOutcome[assetId]} best ask: ${(bestAsk*100).toFixed(2)}¢`, 'info');
          }
          if (parsed.bids && parsed.bids.length > 0) {
            const bestBid = Math.max(...parsed.bids.map(b => parseFloat(b.price)));
            if (bestBid > 0) lastValidBid[assetId] = bestBid;
          }
        }
        return;
      }

      if (parsed.event_type === 'price_change') {
        if (parsed.timestamp) {
          const lat = recvTime - parseInt(parsed.timestamp);
          if (lat >= 0 && lat < 30000) wsLatencies.push(lat);
        }
        for (const change of (parsed.price_changes || [])) {
          processPriceChangeTick(change, recvTime);
        }
        return;
      }

      log(`[UNKNOWN] event_type:${parsed.event_type} keys:${Object.keys(parsed).join(',')}`, 'warn');

    } catch (e) {
      log(`WS parse error: ${e.message}`, 'warn');
    }
  });

  ws.on('close', () => {
    if (!running) return;
    log('WebSocket closed. Reconnecting in 4s...', 'info');
    setTimeout(connectWebSocket, 4000);
  });

  ws.on('error', (e) => log(`WebSocket error: ${e.message}`, 'warn'));
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
    if (!lastValidAsk[tokenId] || lastValidAsk[tokenId] <= 0) {
      lastValidAsk[tokenId] = rawMid;
      lastAskTime[tokenId]  = Date.now();
    }
    log(`[POLL] ${outcomeName} mid:${(rawMid*100).toFixed(2)}¢ lat:${latencyMs}ms`, 'info');
  } catch (e) {}
}

function startPolling() {
  pollInterval = setInterval(() => {
    clobTokenIds.forEach((id, i) => pollPrice(id, tokenToOutcome[id] || `Outcome ${i+1}`));
  }, 5000);
}

// ==================== GRACEFUL SHUTDOWN ====================

function stop() {
  running = false;
  if (wsInstance)   wsInstance.close();
  if (pollInterval) clearInterval(pollInterval);
  log('Bot stopped.', 'info');
  printFinalReport();
  process.exit(0);
}

process.on('SIGINT',  stop);
process.on('SIGTERM', stop);

// ==================== INIT ====================

async function init() {
  log(`Fetching market for slug: ${slug}`, 'info');
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

    clobTokenIds       = safeParse(market.clobTokenIds);
    const prices       = safeParse(market.outcomePrices);
    const outcomes     = safeParse(market.outcomes);
    if (clobTokenIds.length === 0) throw new Error('No CLOB token IDs found');

    clobTokenIds.forEach((id, i) => {
      tokenToOutcome[id] = outcomes[i] || `Outcome ${i+1}`;
      lastValidAsk[id]   = parseFloat(prices[i] || 0);
      lastValidBid[id]   = 0;
      lastAskTime[id]    = Date.now();
      lastSellTime[id]   = 0;
    });

    console.log('\x1b[33m');
    console.log('  ██████╗  ██████╗ ██╗  ██╗   ██╗██████╗  ██████╗ ████████╗');
    console.log('  ██╔══██╗██╔═══██╗██║  ╚██╗ ██╔╝██╔══██╗██╔═══██╗╚══██╔══╝');
    console.log('  ██████╔╝██║   ██║██║   ╚████╔╝ ██████╔╝██║   ██║   ██║   ');
    console.log('  ██╔═══╝ ██║   ██║██║    ╚██╔╝  ██╔══██╗██║   ██║   ██║   ');
    console.log('  ██║     ╚██████╔╝███████╗██║   ██████╔╝╚██████╔╝   ██║   ');
    console.log('  ╚═╝      ╚═════╝ ╚══════╝╚═╝   ╚═════╝  ╚═════╝    ╚═╝   ');
    console.log('\x1b[0m');
    console.log(`\x1b[90m  Market:   ${market.question}\x1b[0m`);
    console.log(`\x1b[90m  Outcomes: ${outcomes.join(' vs ')}\x1b[0m`);
    console.log(`\x1b[90m  Buy:      ${(config.buyZoneLow*100).toFixed(2)}–${(config.buyZoneHigh*100).toFixed(2)}¢\x1b[0m`);
    console.log(`\x1b[90m  Sell:     ${(config.sellZoneLow*100).toFixed(2)}–${(config.sellZoneHigh*100).toFixed(2)}¢\x1b[0m`);
    console.log(`\x1b[90m  StopLoss: ${(config.stopLoss*100).toFixed(2)}¢  floor: ${(config.stopLossFloor*100).toFixed(2)}¢\x1b[0m`);
    console.log(`\x1b[90m  Balance:  $${config.paperBalance}\x1b[0m`);
    console.log(`\x1b[90m  Cooldown: ${config.buyCooldownMs}ms\x1b[0m\n`);

    connectWebSocket();
    startPolling();
  } catch (err) {
    console.error('Init error:', err.message);
    process.exit(1);
  }
}

init();