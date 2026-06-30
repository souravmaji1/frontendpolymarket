const fs = require('fs');

const VOLUME_MIN = 20000;
const VOLUME_MAX = 500000;
const VOLATILITY_MIN = 0.03;   // 3%
const VOLATILITY_MAX = 0.15;   // 15%

// Stale detection
const STALE_24H_VOL_MAX = 10000;
const STALE_DAY_CHANGE_MAX = 0.02;
const WIDE_SPREAD_THRESHOLD = 0.03;

// CLOB for price history
const CLOB_BASE = 'https://clob.polymarket.com';

const safeParse = (val) => {
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') { 
    try { return JSON.parse(val); } catch { return []; } 
  }
  return [];
};

async function fetchAllMarkets() {
  let allMarkets = [];
  let offset = 0;
  const limit = 200;

  while (true) {
    const url = `https://gamma-api.polymarket.com/markets?active=true&closed=false&limit=${limit}&offset=${offset}&order=volume24hr&ascending=false`;
    console.log(`Fetching offset ${offset}...`);
    const res = await fetch(url);
    const markets = await res.json();

    if (!markets || !Array.isArray(markets) || markets.length === 0) break;
    
    allMarkets = allMarkets.concat(markets);
    console.log(`  → Got ${markets.length} markets (total: ${allMarkets.length})`);
    
    if (markets.length < limit) break;
    offset += limit;
    await new Promise(r => setTimeout(r, 700)); // rate limit friendly
  }
  return allMarkets;
}

function isMediumVolatility(m) {
  const dayChg = Math.abs(parseFloat(m.oneDayPriceChange || 0));
  const weekChg = Math.abs(parseFloat(m.oneWeekPriceChange || 0));
  return (dayChg >= VOLATILITY_MIN && dayChg <= VOLATILITY_MAX) ||
         (weekChg >= VOLATILITY_MIN && weekChg <= VOLATILITY_MAX * 2);
}

function isStale(m) {
  const vol24 = parseFloat(m.volume24hr || 0);
  const dayChg = Math.abs(parseFloat(m.oneDayPriceChange || 0));
  const spread = (parseFloat(m.bestAsk || 1) - parseFloat(m.bestBid || 0));

  const lowVol = vol24 < STALE_24H_VOL_MAX;
  const noMove = dayChg < STALE_DAY_CHANGE_MAX;
  const wideSpread = spread > WIDE_SPREAD_THRESHOLD;

  return lowVol && (noMove || wideSpread);
}

async function analyzePriceMovement(tokenId) {
  if (!tokenId) return { style: 'NO_DATA', maxJump: 'N/A', bigJumps: 0 };

  try {
    const url = `${CLOB_BASE}/prices-history?market=${tokenId}&interval=1d&fidelity=5`;
    const res = await fetch(url);
    const data = await res.json();
    
    const history = data.history || [];
    if (history.length < 8) return { style: 'TOO_FEW_POINTS', maxJump: 'N/A', bigJumps: 0 };

    let maxJump = 0;
    let bigJumps = 0;
    const moves = [];

    for (let i = 1; i < history.length; i++) {
      const prev = parseFloat(history[i-1].p);
      const curr = parseFloat(history[i].p);
      if (prev <= 0) continue;
      
      const pctChange = Math.abs((curr - prev) / prev) * 100;
      moves.push(pctChange);
      
      if (pctChange > maxJump) maxJump = pctChange;
      if (pctChange > 3) bigJumps++;
    }

    const avgMove = moves.length ? moves.reduce((a,b)=>a+b,0) / moves.length : 0;
    const jumpRatio = maxJump / (avgMove + 0.001);

    let style = 'SMOOTH';
    if (jumpRatio > 4.5 || bigJumps >= 6) style = 'JUMPY ⚡';
    else if (jumpRatio > 2.8 || bigJumps >= 3) style = 'MIXED';

    return {
      style,
      maxJump: maxJump.toFixed(2) + '%',
      bigJumps,
      avgMove: avgMove.toFixed(2) + '%',
      points: history.length
    };
  } catch (e) {
    console.log(`  [Movement analysis failed for ${tokenId}]`);
    return { style: 'ERROR', maxJump: 'N/A', bigJumps: 0 };
  }
}

async function main() {
  const markets = await fetchAllMarkets();
  console.log(`\nTotal active markets fetched: ${markets.length}`);

  const candidates = markets.filter(m => {
    const vol = parseFloat(m.volumeNum || m.volume || 0);
    return vol >= VOLUME_MIN && vol <= VOLUME_MAX &&
           m.enableOrderBook && m.acceptingOrders &&
           isMediumVolatility(m);
  });

  console.log(`Found ${candidates.length} candidates. Analyzing price movement (this may take a minute)...\n`);

  const withStaleInfo = await Promise.all(candidates.map(async (m) => {
    const clobTokenIds = safeParse(m.clobTokenIds);
    const primaryToken = clobTokenIds[0] || clobTokenIds[1]; // usually Yes or main outcome

    const movement = await analyzePriceMovement(primaryToken);

    const stale = isStale(m);
    const spreadPct = ((parseFloat(m.bestAsk || 0) - parseFloat(m.bestBid || 0)) * 100);

    return {
      slug: m.slug,
      question: m.question,
      volume: Math.round(parseFloat(m.volumeNum || 0)),
      volume24hr: Math.round(parseFloat(m.volume24hr || 0)),
      dayChange: (parseFloat(m.oneDayPriceChange || 0) * 100).toFixed(1) + '%',
      spread: spreadPct.toFixed(2) + '%',
      movementStyle: movement.style,
      maxSingleJump: movement.maxJump,
      bigJumps: movement.bigJumps,
      stale: stale ? 'YES ⚠️' : 'no',
      clobTokenIds
    };
  }));

  // Sort by most interesting (jumpy first, then volume)
  withStaleInfo.sort((a, b) => {
    if (a.movementStyle.includes('JUMPY') && !b.movementStyle.includes('JUMPY')) return -1;
    if (!a.movementStyle.includes('JUMPY') && b.movementStyle.includes('JUMPY')) return 1;
    return b.volume - a.volume;
  });

  console.log(`\n🎯 FINAL RESULTS — $20k–$500k + Medium Volatility`);
  console.table(withStaleInfo.map(r => ({
    Slug: r.slug.slice(0, 38),
    Volume: '$' + r.volume.toLocaleString(),
    '24h Vol': '$' + r.volume24hr.toLocaleString(),
    'Day Δ': r.dayChange,
    Spread: r.spread,
    Movement: r.movementStyle,
    'Max Jump': r.maxSingleJump,
    Stale: r.stale
  })));

  fs.writeFileSync(`polymarket-candidates-full-${Date.now()}.json`, 
    JSON.stringify(withStaleInfo, null, 2));

  console.log(`\n✅ Full detailed report saved to JSON.`);
  console.log(`\nTop candidates for WS monitoring (especially the JUMPY ones):`);
  withStaleInfo.slice(0, 10).forEach(r => {
    console.log(`  node ws-script.js ${r.slug}   # ${r.movementStyle}`);
  });
}

main().catch(console.error);