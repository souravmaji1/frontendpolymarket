const WebSocket = require('ws');
const fs = require('fs');

const MAX_ASSETS_PER_WS = 350; // Safer limit
let allMarkets = new Map(); // slug -> enriched market data
let priceCache = new Map(); // asset_id -> latest price info
let arbitrageOpportunities = new Set(); // debounce

const MIN_VOLUME = 1000; // $10k minimum volume filter
const MIN_PROFIT_CENTS = 2.0;
const BEST_BID_SUM_THRESHOLD = 1.022; // ~2.2%+ for guaranteed after fees

const safeParse = (val) => {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return []; }
  }
  return [];
};

async function fetchActiveMarkets() {
  try {
    const params = new URLSearchParams({
      active: 'true',
      closed: 'false',
      limit: '500',
      order: 'volume24hr',
      ascending: 'false'
    });

    const res = await fetch(`https://gamma-api.polymarket.com/markets?${params}`);
    let markets = await res.json();

    const processed = new Map();

    for (const m of markets) {
      if (!m.enableOrderBook || !m.acceptingOrders || m.closed) continue;

      const volume = parseFloat(m.volumeNum || m.volume || 0);
      if (volume < MIN_VOLUME) continue; // Filter low-volume markets

      const clobTokenIds = safeParse(m.clobTokenIds);
      const outcomes = safeParse(m.outcomes);
      const prices = safeParse(m.outcomePrices);

      if (clobTokenIds.length < 2) continue;

      const tokenToOutcome = {};
      clobTokenIds.forEach((id, i) => {
        tokenToOutcome[id] = outcomes[i] || `Outcome ${i+1}`;
      });

      processed.set(m.slug, {
        ...m,
        clobTokenIds,
        outcomes,
        volume: volume,
        liquidity: parseFloat(m.liquidityNum || m.liquidityClob || m.liquidity || 0),
        tokenToOutcome,
        initialPrices: prices
      });
    }

    console.log(`✅ Loaded ${processed.size} high-volume active CLOB markets (>${MIN_VOLUME} volume)`);
    return processed;
  } catch (e) {
    console.error('Failed to fetch markets:', e.message);
    return allMarkets;
  }
}

function hasDecentDepth(prices) {
  if (prices.length === 0) return false;
  return prices.every(p => {
    const ask = parseFloat(p.best_ask || 0);
    const bid = parseFloat(p.best_bid || 0);
    // Require non-zero bid/ask on most outcomes and reasonable spread
    return (bid > 0.05 || ask > 0.05) && Math.abs(ask - bid) < 0.15; // spread < 15¢
  });
}

function calculateArbitrage(market, priceData) {
  if (!priceData || priceData.length !== market.clobTokenIds.length) return null;
  if (!hasDecentDepth(priceData)) return null;

  let sumBestBid = 0;
  let sumMid = 0;
  let details = [];

  for (const p of priceData) {
    const ask = parseFloat(p.best_ask || 0);
    const bid = parseFloat(p.best_bid || 0);
    const mid = (ask > 0 && bid > 0) ? (ask + bid) / 2 : Math.max(ask, bid);

    sumBestBid += bid;
    sumMid += mid;

    details.push({
      outcome: p._outcomeName || 'Unknown',
      bidCents: (bid * 100).toFixed(1),
      askCents: (ask * 100).toFixed(1),
      midCents: (mid * 100).toFixed(1)
    });
  }

  const profitCentsBid = (sumBestBid - 1) * 100;

  if (sumBestBid > BEST_BID_SUM_THRESHOLD && profitCentsBid >= MIN_PROFIT_CENTS) {
    return {
      type: 'BUY_ALL_ARBITRAGE',
      profitCentsBid: profitCentsBid.toFixed(1),
      sumBestBid: sumBestBid.toFixed(4),
      sumMid: sumMid.toFixed(4),
      details,
      marketQuestion: market.question,
      slug: market.slug,
      volume: market.volume,
      liquidity: market.liquidity,
      urgency: profitCentsBid > 5 ? 'HIGH' : 'MEDIUM'
    };
  }
  return null;
}

function displayArbitrage(arb) {
  const key = `${arb.slug}-${Date.now()}`;
  if (arbitrageOpportunities.has(key)) return;
  arbitrageOpportunities.add(key);
  setTimeout(() => arbitrageOpportunities.delete(key), 0); 

  console.log(`\n🚨🚨 STRONG ARBITRAGE OPPORTUNITY 🚨🚨`);
  console.log(`Market : ${arb.marketQuestion}`);
  console.log(`Slug   : ${arb.slug}`);
  console.log(`Volume : $${arb.volume.toLocaleString()} | Liquidity: $${arb.liquidity.toLocaleString()}`);
  console.log(`Type   : ${arb.type} | Urgency: ${arb.urgency}`);
  console.log(`Sum Best Bid : ${arb.sumBestBid} (+${arb.profitCentsBid}¢ guaranteed profit)`);
  console.log(`Details:`);
  arb.details.forEach(d => {
    console.log(`   ${d.outcome.padEnd(25)} Bid ${d.bidCents}¢ | Ask ${d.askCents}¢`);
  });
  console.log(`\n🔗 https://polymarket.com/${arb.slug}`);
  console.log(`────────────────────────────────────────────────────────────\n`);
}

async function init() {
  console.log('🚀 Polymarket Real-time Arbitrage Scanner (Filtered + Robust)\n');

  allMarkets = await fetchActiveMarkets();

  // Initial price seeding
  for (const [slug, market] of allMarkets) {
    try {
      const res = await fetch(`https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(slug)}`);
      const data = await res.json();
      const m = data[0];
      if (m) {
        const clobIds = safeParse(m.clobTokenIds);
        const outcomePrices = safeParse(m.outcomePrices);
        clobIds.forEach((id, i) => {
          priceCache.set(id, {
            best_ask: parseFloat(outcomePrices[i] || 0),
            best_bid: 0,
            _outcomeName: market.tokenToOutcome[id]
          });
        });
      }
    } catch (_) {}
  }

  // Refresh markets periodically
  setInterval(async () => {
    allMarkets = await fetchActiveMarkets();
  }, 8 * 60 * 1000);

  // Build asset batches
  const allAssetIds = Array.from(allMarkets.values()).flatMap(m => m.clobTokenIds);
  const batches = [];
  for (let i = 0; i < allAssetIds.length; i += MAX_ASSETS_PER_WS) {
    batches.push(allAssetIds.slice(i, i + MAX_ASSETS_PER_WS));
  }

  console.log(`📡 Subscribing to ${allAssetIds.length} assets across ${batches.length} WS connections...`);

  batches.forEach((batch, idx) => {
    const ws = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/market');

    ws.on('open', () => {
      console.log(`[WS ${idx + 1}] Connected — ${batch.length} assets`);
      ws.send(JSON.stringify({
        assets_ids: batch,
        type: 'market',
        custom_feature_enabled: true,
      }));
    });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      const changes = msg.price_changes || [];
      if (changes.length === 0) return;

      for (const c of changes) {
        const assetId = c.asset_id;
        const market = Array.from(allMarkets.values()).find(m => m.clobTokenIds.includes(assetId));
        if (!market) continue;

        const enriched = {
          ...c,
          _outcomeName: market.tokenToOutcome[assetId],
          _askCents: parseFloat((parseFloat(c.best_ask || 0) * 100).toFixed(1)),
          _bidCents: parseFloat((parseFloat(c.best_bid || 0) * 100).toFixed(1)),
          _recvTime: Date.now()
        };

        priceCache.set(assetId, enriched);

        // Check arbitrage
        const currentPrices = market.clobTokenIds
          .map(id => priceCache.get(id))
          .filter(Boolean);

        const arb = calculateArbitrage(market, currentPrices);
        if (arb) displayArbitrage(arb);
      }
    });

    ws.on('close', () => console.log(`[WS ${idx + 1}] Closed`));
    ws.on('error', e => console.error(`[WS ${idx + 1}]`, e.message));
  });

  // Status
  setInterval(() => {
    console.log(`[STATUS] Monitoring ${allMarkets.size} qualified markets | ${priceCache.size} price points`);
  }, 45000);
}

process.on('SIGINT', () => {
  const filename = `arb-scan-${Date.now()}.json`;
  fs.writeFileSync(filename, JSON.stringify({
    capturedAt: new Date().toISOString(),
    marketsMonitored: allMarkets.size,
    message: 'Scanner stopped by user'
  }, null, 2));
  console.log(`\n✅ Saved summary to ${filename}`);
  process.exit(0);
});

init().catch(console.error);