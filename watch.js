const WebSocket = require('ws');
const fs = require('fs');

const slug = process.argv[2] || 'atp-montsi-donski-2026-06-06';
const allMessages = [];  // ← collect everything here

async function init() {
  console.log(`Fetching market data for slug: ${slug}\n`);
  
  const res = await fetch(`https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(slug)}`);
  const data = await res.json();
  const market = data[0];
  
  const safeParse = (val) => {
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') { try { return JSON.parse(val); } catch { return []; } }
    return [];
  };

  const clobTokenIds = safeParse(market.clobTokenIds);
  const outcomes     = safeParse(market.outcomes);
  const prices       = safeParse(market.outcomePrices);
  const tokenToOutcome = {};

  clobTokenIds.forEach((id, i) => {
    tokenToOutcome[id] = outcomes[i] || `Outcome ${i+1}`;
  });

  console.log(`Market   : ${market.question}`);
  console.log(`Outcomes : ${outcomes.join(' vs ')}`);
  console.log(`Tokens   : ${clobTokenIds.length}`);
  console.log(`Prices   : ${prices.map((p,i) => `${outcomes[i]}: ${(parseFloat(p)*100).toFixed(2)}¢`).join(' | ')}`);
  console.log(`\n${'─'.repeat(100)}`);
  console.log(`RAW WEBSOCKET MESSAGE DUMP — every field printed as-is`);
  console.log(`${'─'.repeat(100)}\n`);

  // ── Save to JSON on exit ──
  function saveAndExit() {
    const filename = `ws-data-${slug}-${Date.now()}.json`;
    const output = {
      slug,
      market: {
        question: market.question,
        outcomes,
        initialPrices: prices,
        clobTokenIds,
      },
      capturedAt: new Date().toISOString(),
      totalMessages: allMessages.length,
      totalPriceChanges: allMessages.reduce((s, m) => s + (m.price_changes?.length || 0), 0),
      messages: allMessages,
    };
    fs.writeFileSync(filename, JSON.stringify(output, null, 2));
    console.log(`\n✅ Saved ${allMessages.length} messages to ${filename}`);
    process.exit(0);
  }

  process.on('SIGINT',  saveAndExit);
  process.on('SIGTERM', saveAndExit);

  const ws = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/market');

  ws.on('open', () => {
    console.log('[WS] Connected — subscribing...\n');
    ws.send(JSON.stringify({
      assets_ids: clobTokenIds,
      type: 'market',
      custom_feature_enabled: true,
    }));
  });

  ws.on('message', (raw) => {
    const recvTime = Date.now();
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { 
      console.log('[RAW non-JSON]', raw.toString());
      return;
    }

    // ── Enrich each message with metadata before saving ──
    const enriched = {
      _recvTime: recvTime,
      _recvIso: new Date(recvTime).toISOString(),
      _msgLatencyMs: msg.timestamp ? recvTime - parseInt(msg.timestamp) : null,
      ...msg,
      price_changes: (msg.price_changes || []).map(c => {
        const ask = parseFloat(c.best_ask || 0);
        const bid = parseFloat(c.best_bid || 0);
        const tickLat = c.timestamp ? recvTime - parseInt(c.timestamp) : null;
        return {
          ...c,
          _outcomeName: tokenToOutcome[c.asset_id] || 'UNKNOWN',
          _askCents: ask > 0 ? parseFloat((ask * 100).toFixed(4)) : null,
          _bidCents: bid > 0 ? parseFloat((bid * 100).toFixed(4)) : null,
          _tickLatencyMs: tickLat,
          _askMissing: ask === 0,
          _bidMissing: bid === 0,
          _invertedSpread: ask > 0 && bid > 0 && ask < bid,
          _dangerousTick: ask === 0,  // would misfire stoploss
        };
      }),
    };

    allMessages.push(enriched);

    // ── Console output (same as before) ──
    console.log(`\n${'═'.repeat(80)}`);
    console.log(`[MSG #${allMessages.length} at ${enriched._recvIso}]`);
    console.log(`  Top-level keys: ${Object.keys(msg).join(', ')}`);

    for (const [k, v] of Object.entries(msg)) {
      if (k === 'price_changes') continue;
      console.log(`  ${k}: ${JSON.stringify(v)}`);
    }

    if (msg.timestamp) {
      console.log(`  [LATENCY from msg.timestamp]: ${enriched._msgLatencyMs}ms`);
    }

    const changes = msg.price_changes || [];
    console.log(`  price_changes count: ${changes.length}`);

    for (const [idx, c] of changes.entries()) {
      const ec = enriched.price_changes[idx];
      console.log(`\n  ── change[${idx}] — ${ec._outcomeName} ──`);
      console.log(`    All keys: ${Object.keys(c).join(', ')}`);

      for (const [k, v] of Object.entries(c)) {
        let note = '';
        if (k === 'best_ask') note = ec._askMissing ? '  ⚠️  ZERO — stoploss misfire risk!' : `  → ${ec._askCents}¢`;
        if (k === 'best_bid') note = `  → ${ec._bidCents}¢`;
        if (k === 'timestamp' || k === 'asset_timestamp') note = `  → latency: ${recvTime - parseInt(v)}ms`;
        console.log(`    ${k}: ${JSON.stringify(v)}${note}`);
      }

      if (ec._dangerousTick)    console.log(`    ❌ DANGER: ask=0 — would trigger wrong stoploss!`);
      if (ec._invertedSpread)   console.log(`    ⚠️  WARNING: inverted spread (ask < bid)`);
    }
  });

  ws.on('close', () => {
    console.log('\n[WS] Connection closed.');
    saveAndExit();
  });

  ws.on('error', (e) => console.log('[WS ERROR]', e.message));
}

init().catch(console.error);