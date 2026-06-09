'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

function InjectStyles() {
  useEffect(() => {
    const css = `
      @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Space+Mono:wght@400;700&family=DM+Sans:wght@300;400;500&display=swap');
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      html { scroll-behavior: smooth; }
      body { font-family: 'DM Sans', sans-serif; background: #0a0a0f; color: #f0f0f8; overflow-x: hidden; }
      ::selection { background: #e8ff47; color: #0a0a0f; }
      ::-webkit-scrollbar { width: 3px; }
      ::-webkit-scrollbar-track { background: #111118; }
      ::-webkit-scrollbar-thumb { background: #e8ff47; }
      @keyframes fadeUp { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes pulse-accent { 0%,100% { box-shadow: 0 0 0 0 rgba(232,255,71,0.3); } 50% { box-shadow: 0 0 0 8px rgba(232,255,71,0); } }
      @keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: 0; } }
      @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      @keyframes ticker { from { transform: translateX(0); } to { transform: translateX(-50%); } }
      @keyframes grain { 0%,100% { transform: translate(0,0); } 10% { transform: translate(-2%,-3%); } 30% { transform: translate(3%,2%); } 50% { transform: translate(-1%,4%); } 70% { transform: translate(2%,-2%); } 90% { transform: translate(-3%,1%); } }
      @keyframes scanSlide { 0% { transform: translateY(-100%); } 100% { transform: translateY(100vh); } }
      @keyframes logFade { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: translateX(0); } }
      .grain-overlay { position: fixed; inset: 0; pointer-events: none; z-index: 999; opacity: 0.035; background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); animation: grain 0.5s steps(1) infinite; }
      .grid-bg { background-image: linear-gradient(rgba(240,240,248,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(240,240,248,0.03) 1px, transparent 1px); background-size: 40px 40px; }
      .fade-up { animation: fadeUp 0.7s ease forwards; }
      .log-entry { animation: logFade 0.3s ease forwards; }
      .spinner { animation: spin 0.8s linear infinite; }
      .cursor-blink { animation: blink 1s step-end infinite; }
      .ticker-wrap { overflow: hidden; white-space: nowrap; background: #111118; border-top: 1px solid rgba(240,240,248,0.07); border-bottom: 1px solid rgba(240,240,248,0.07); padding: 0.9rem 0; }
      .ticker-inner { display: inline-flex; animation: ticker 30s linear infinite; gap: 4rem; }
      .ticker-item { font-family: 'Space Mono', monospace; font-size: 0.62rem; letter-spacing: 0.25em; text-transform: uppercase; color: #2a2a3a; display: flex; align-items: center; gap: 1rem; }
      .ticker-item span { color: #e8ff47; }
      .accent-btn { background: #e8ff47; color: #0a0a0f; border: none; padding: 0.85rem 2rem; font-family: 'Space Mono', monospace; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; cursor: pointer; transition: all 0.2s; display: inline-flex; align-items: center; gap: 0.5rem; }
      .accent-btn:hover:not(:disabled) { background: #f5ff7a; transform: translateY(-2px); }
      .accent-btn:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
      .danger-btn { background: transparent; border: 1px solid #ff4766; color: #ff4766; padding: 0.85rem 2rem; font-family: 'Space Mono', monospace; font-size: 0.72rem; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; cursor: pointer; transition: all 0.2s; display: inline-flex; align-items: center; gap: 0.5rem; }
      .danger-btn:hover { background: rgba(255,71,102,0.08); transform: translateY(-2px); }
      .ghost-btn { background: transparent; border: 1px solid rgba(240,240,248,0.15); color: #6b6b8a; padding: 0.85rem 2rem; font-family: 'Space Mono', monospace; font-size: 0.72rem; letter-spacing: 0.2em; text-transform: uppercase; cursor: pointer; transition: all 0.2s; display: inline-flex; align-items: center; gap: 0.5rem; }
      .ghost-btn:hover { border-color: #f0f0f8; color: #f0f0f8; }
      .mini-btn { background: transparent; border: 1px solid rgba(240,240,248,0.12); color: #6b6b8a; padding: 0.3rem 0.7rem; font-family: 'Space Mono', monospace; font-size: 0.58rem; letter-spacing: 0.1em; text-transform: uppercase; cursor: pointer; transition: all 0.2s; display: inline-flex; align-items: center; gap: 0.3rem; }
      .mini-btn:hover:not(:disabled) { border-color: #e8ff47; color: #e8ff47; }
      .mini-btn:disabled { opacity: 0.3; cursor: not-allowed; }
      .mini-btn-danger { border-color: rgba(255,71,102,0.3); color: #ff4766; }
      .mini-btn-danger:hover:not(:disabled) { border-color: #ff4766; background: rgba(255,71,102,0.06); color: #ff4766; }
      .slug-input { background: #111118; border: 1px solid rgba(240,240,248,0.12); color: #f0f0f8; padding: 0.9rem 1.2rem; font-family: 'Space Mono', monospace; font-size: 0.82rem; letter-spacing: 0.05em; width: 100%; outline: none; transition: all 0.2s; }
      .slug-input:focus { border-color: #e8ff47; box-shadow: 0 0 0 1px rgba(232,255,71,0.15); }
      .slug-input::placeholder { color: #2a2a3a; }
      .zone-input { background: #0a0a0f; border: 1px solid rgba(240,240,248,0.1); color: #f0f0f8; padding: 0.45rem 0.6rem; font-family: 'Space Mono', monospace; font-size: 0.7rem; width: 60px; outline: none; transition: all 0.2s; text-align: center; }
      .zone-input:focus { border-color: #e8ff47; }
      .zone-input::placeholder { color: #2a2a3a; }
      .card-dark { background: #111118; border: 1px solid rgba(240,240,248,0.07); }
      .stat-num { font-family: 'Bebas Neue', sans-serif; font-size: 2.2rem; line-height: 1; letter-spacing: 2px; }
      .section-label { font-family: 'Space Mono', monospace; font-size: 0.62rem; letter-spacing: 0.3em; text-transform: uppercase; color: #e8ff47; display: flex; align-items: center; gap: 0.8rem; }
      .section-label::before { content: ''; display: inline-block; width: 1.5rem; height: 1px; background: #e8ff47; }
      .scanline { position: absolute; top: 0; left: 0; right: 0; height: 2px; background: linear-gradient(90deg, transparent, rgba(232,255,71,0.08), transparent); animation: scanSlide 6s linear infinite; pointer-events: none; }
      .trade-buy { border-left: 2px solid #47d4ff; background: rgba(71,212,255,0.04); }
      .trade-sell-win { border-left: 2px solid #e8ff47; background: rgba(232,255,71,0.04); }
      .trade-sell-loss { border-left: 2px solid #ff4766; background: rgba(255,71,102,0.04); }
      .status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
      .status-live { background: #e8ff47; animation: pulse-accent 1.5s ease-in-out infinite; }
      .status-stopped { background: #ff4766; }
      .status-idle { background: #2a2a3a; }
      .outcome-card { padding: 1.5rem; transition: all 0.3s; position: relative; overflow: hidden; }
      .zone-row { display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.75rem; background: #0a0a0f; border: 1px solid rgba(240,240,248,0.06); margin-bottom: 4px; }
      .zone-row:last-child { margin-bottom: 0; }
      @media (max-width: 768px) { .dashboard-grid { grid-template-columns: 1fr !important; } .stats-row { grid-template-columns: 1fr 1fr !important; } .outcomes-row { grid-template-columns: 1fr !important; } .hero-pad { padding: 0 1.5rem !important; } }
    `
    const style = document.createElement('style')
    style.textContent = css
    document.head.appendChild(style)
    return () => document.head.removeChild(style)
  }, [])
  return null
}

// ==================== REAL BOT INSTANCE ====================
function createBotInstance({ slug, config, onTick, onTrade, onLog, onMarketLoaded }) {
  let running = true
  let positions = {}
  let tradeLog = []
  let paperBalance = config.paperBalance
  let lastAsk = {}
  let lastBid = {}

  // ── RE-BUY FIX ─────────────────────────────────────────────────────────────
  // Instead of a time-based cooldown (which breaks instant rebounds), we use a
  // per-asset "sold on this tick" flag.  trySell sets it; processTick clears it
  // BEFORE calling tryBuy so that re-entry is allowed on the NEXT tick but NOT
  // on the exact same tick that triggered the stop-loss (avoids instant churn).
  let soldThisTick = {}        // assetId → true if sold on current tick
  let justSoldAssets = {}      // assetId → true: skip ONE tryBuy call after sell
  // ───────────────────────────────────────────────────────────────────────────

  let wsInstance = null
  let pollInterval = null
  let tokenToOutcome = {}
  let clobTokenIds = []

  // Latency tracking
  let wsLatency = 0
  let lastPingTime = 0
  let tickCount = 0
  let tickTimes = []

  function matchBuyZone(ask) {
    for (const zone of config.buyZones) {
      const lo = zone.low / 100, hi = zone.high / 100
      if (ask >= lo && ask <= hi) return zone
    }
    return null
  }

  function matchSellZone(ask) {
    for (const zone of config.sellZones) {
      const lo = zone.low / 100, hi = zone.high / 100
      if (ask >= lo && ask <= hi) return zone
    }
    return null
  }

  function tryBuy(assetId, outcomeName, ask) {
    if (positions[assetId]) return           // already holding
    if (!ask || ask <= 0) return

    // ── FIX: skip buy on the tick immediately after a stop-loss sell ──────────
    // This prevents buying back at 59¢ the instant we sold at 59¢ (churn),
    // but allows buying again on the very next tick if price is in zone.
    if (justSoldAssets[assetId]) {
      justSoldAssets[assetId] = false        // clear flag → allowed next tick
      return
    }
    // ─────────────────────────────────────────────────────────────────────────

    const zone = matchBuyZone(ask)
    if (!zone) return
    const cost = 1
    if (paperBalance < cost) return
    const shares = 1 / ask
    paperBalance -= cost
    positions[assetId] = { shares, buyAsk: ask, outcomeName, peakAsk: ask, buyZone: zone }
    const entry = {
      type: 'BUY', outcome: outcomeName, shares: shares.toFixed(4),
      askPrice: (ask * 100).toFixed(1), cost: cost.toFixed(2),
      balanceAfter: paperBalance.toFixed(2), time: new Date().toLocaleTimeString(), assetId
    }
    tradeLog.push(entry)
    onTrade(entry, paperBalance, positions)
    onLog(`BUY ${outcomeName} | Ask@${(ask*100).toFixed(1)}¢ [zone ${zone.low}–${zone.high}¢] | ${shares.toFixed(4)}sh | $${cost.toFixed(2)}`, 'buy')
  }

  function trySell(assetId, bid, ask) {
    const pos = positions[assetId]
    if (!pos) return
    const exitPrice = bid > 0 ? bid : ask
    if (!exitPrice || exitPrice <= 0) return
    if (exitPrice > pos.peakAsk) pos.peakAsk = exitPrice

    let shouldSell = false, sellReason = ''

    if (exitPrice < pos.buyAsk) {
      shouldSell = true
      sellReason = `Stop-loss: bought@${(pos.buyAsk*100).toFixed(1)}¢ bid@${(exitPrice*100).toFixed(1)}¢`
    }

    if (!shouldSell && ask > 0) {
      const zone = matchSellZone(ask)
      if (zone) {
        shouldSell = true
        sellReason = `Target zone ${zone.low}–${zone.high}¢: ask@${(ask*100).toFixed(1)}¢`
      }
    }

    if (!shouldSell) return

    const proceeds = pos.shares * exitPrice
    const cost = pos.shares * pos.buyAsk
    const pnl = proceeds - cost
    paperBalance += proceeds

    // ── FIX: mark that this asset was just sold so tryBuy skips ONE tick ──────
    justSoldAssets[assetId] = true
    // ─────────────────────────────────────────────────────────────────────────

    const entry = {
      type: 'SELL', outcome: pos.outcomeName, shares: pos.shares,
      buyAsk: (pos.buyAsk*100).toFixed(1), sellAsk: (exitPrice*100).toFixed(1),
      peakAsk: (pos.peakAsk*100).toFixed(1), pnl: pnl.toFixed(2),
      reason: sellReason, balanceAfter: paperBalance.toFixed(2),
      time: new Date().toLocaleTimeString(), assetId
    }
    tradeLog.push(entry)
    delete positions[assetId]
    onTrade(entry, paperBalance, positions)
    const icon = pnl >= 0 ? 'SELL WIN' : 'SELL LOSS'
    onLog(`${icon} ${pos.outcomeName} | ${(pos.buyAsk*100).toFixed(1)}¢→${(exitPrice*100).toFixed(1)}¢ | P&L: ${pnl>=0?'+':''}$${pnl.toFixed(2)} | ${sellReason}`, pnl >= 0 ? 'sell_win' : 'sell_loss')
  }

  function processTick(assetId, outcomeName, rawMid, rawBid, rawAsk, source) {
    const t0 = performance.now()
    const prevAsk = lastAsk[assetId] || rawAsk
    const bid = rawBid > 0 ? rawBid : (lastBid[assetId] || 0)
    const ask = rawAsk > 0 ? rawAsk : (lastAsk[assetId] || 0)
    const mid = rawMid > 0 ? rawMid : (bid + ask) / 2
    if (bid > 0) lastBid[assetId] = bid
    if (ask > 0) lastAsk[assetId] = ask

    // ── FIX: clear soldThisTick flag at the START of each new tick ───────────
    // justSoldAssets is cleared inside tryBuy (one-shot skip), so we only need
    // to reset soldThisTick here as a guard against same-tick double-sell.
    soldThisTick[assetId] = false
    // ─────────────────────────────────────────────────────────────────────────

    onTick({ assetId, outcomeName, ask, bid, mid, prevAsk, source, positions: { ...positions }, balance: paperBalance, wsLatency })

    // Sell first, then buy — justSoldAssets blocks same-tick re-buy
    trySell(assetId, bid, ask)
    tryBuy(assetId, outcomeName, ask)

    // Latency tracking
    const elapsed = performance.now() - t0
    tickTimes.push(elapsed)
    if (tickTimes.length > 100) tickTimes.shift()
    tickCount++
  }

  function connectWebSocket() {
    if (!running) return
    onLog(`Connecting to Polymarket CLOB WebSocket...`, 'info')
    const ws = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/market')
    wsInstance = ws
    let pingInterval = null

    ws.onopen = () => {
      onLog(`WebSocket connected — subscribing to ${clobTokenIds.length} assets`, 'info')
      ws.send(JSON.stringify({ assets_ids: clobTokenIds, type: 'market', custom_feature_enabled: true }))

      // Heartbeat + RTT measurement
      pingInterval = setInterval(() => {
        if (ws.readyState === 1) {
          lastPingTime = performance.now()
          ws.send('PING')
        }
      }, 9000)
    }

    ws.onmessage = (event) => {
      try {
        if (event.data === 'PONG') {
          if (lastPingTime > 0) {
            wsLatency = Math.round(performance.now() - lastPingTime)
            onLog(`WS RTT: ${wsLatency}ms`, 'info')
          }
          return
        }

        const msg = JSON.parse(event.data)

        if (msg.event_type === 'best_bid_ask') {
          const assetId = msg.asset_id
          if (!assetId || !tokenToOutcome[assetId]) return
          const bid = parseFloat(msg.best_bid || 0)
          const ask = parseFloat(msg.best_ask || 0)
          processTick(assetId, tokenToOutcome[assetId], 0, bid, ask, 'WS-BBA')
          return
        }

        if (msg.event_type === 'price_change') {
          const priceChanges = msg.price_changes || []
          for (const change of priceChanges) {
            const assetId = change.asset_id
            if (!assetId || !tokenToOutcome[assetId]) continue
            const rawMid = parseFloat(change.price || 0)
            const rawBid = parseFloat(change.best_bid || 0)
            const rawAsk = parseFloat(change.best_ask || 0)
            processTick(assetId, tokenToOutcome[assetId], rawMid, rawBid, rawAsk, 'WS-PC')
          }
          return
        }

        if (msg.event_type === 'book') {
          const assetId = msg.asset_id
          if (!assetId || !tokenToOutcome[assetId]) return
          const topBid = msg.bids?.[0] ? parseFloat(msg.bids[0].price) : 0
          const topAsk = msg.asks?.[0] ? parseFloat(msg.asks[0].price) : 0
          processTick(assetId, tokenToOutcome[assetId], 0, topBid, topAsk, 'WS-BOOK')
          return
        }

      } catch (e) {}
    }

    ws.onclose = () => {
      clearInterval(pingInterval)
      if (!running) return
      onLog(`WebSocket closed. Reconnecting in 4s...`, 'info')
      setTimeout(connectWebSocket, 4000)
    }

    ws.onerror = () => { onLog(`WebSocket error — polling active as fallback`, 'info') }
  }

  async function pollPrice(tokenId, outcomeName) {
    try {
      const t0 = performance.now()
      const res = await fetch(`https://clob.polymarket.com/book?token_id=${tokenId}`)
      if (!res.ok) return
      const data = await res.json()
      const pollRtt = Math.round(performance.now() - t0)
      const topBid = data.bids?.[0] ? parseFloat(data.bids[0].price) : 0
      const topAsk = data.asks?.[0] ? parseFloat(data.asks[0].price) : 0
      processTick(tokenId, outcomeName, 0, topBid, topAsk, `POLL(${pollRtt}ms)`)
    } catch (e) {}
  }

  async function startPolling() {
    pollInterval = setInterval(() => {
      clobTokenIds.forEach((id, i) => {
        pollPrice(id, tokenToOutcome[id] || `Outcome ${i+1}`)
      })
    }, 2000)
  }

  async function init() {
    onLog(`Fetching market data for slug: ${slug}`, 'info')
    try {
      const res = await fetch(`https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(slug)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const market = data[0]
      if (!market) throw new Error('Market not found for that slug')

      const safeParse = (val) => {
        if (Array.isArray(val)) return val
        if (typeof val === 'string') { try { return JSON.parse(val) } catch { return [] } }
        return []
      }

      clobTokenIds = safeParse(market.clobTokenIds)
      const prices = safeParse(market.outcomePrices)
      const outcomes = safeParse(market.outcomes)

      if (clobTokenIds.length === 0) throw new Error('No CLOB token IDs found for this market')

      clobTokenIds.forEach((id, i) => {
        tokenToOutcome[id] = outcomes[i] || `Outcome ${i + 1}`
        lastAsk[id] = parseFloat(prices[i] || 0)
        lastBid[id] = 0
        justSoldAssets[id] = false
        soldThisTick[id] = false
      })

      onMarketLoaded({ question: market.question, outcomes, slug, clobTokenIds })
      onLog(`Market: ${market.question}`, 'info')
      onLog(`Outcomes: ${outcomes.join(' vs ')}`, 'info')
      onLog(`Assets: ${clobTokenIds.length} token(s) found`, 'info')
      onLog(`Initial prices: ${prices.map((p, i) => `${outcomes[i] || i}: ${(parseFloat(p)*100).toFixed(1)}¢`).join(' | ')}`, 'info')
      onLog(`Buy zones: ${config.buyZones.map(z => `${z.low}–${z.high}¢`).join(', ')}`, 'info')
      onLog(`Sell zones: ${config.sellZones.map(z => `${z.low}–${z.high}¢`).join(', ')}`, 'info')
      onLog(`Starting balance: $${config.paperBalance}`, 'info')
      onLog(`Re-buy logic: enabled (skips 1 tick after stop-loss, then re-enters freely)`, 'info')
      onLog(`PING heartbeat: active (9s interval)`, 'info')

      connectWebSocket()
      startPolling()
    } catch (err) {
      onLog(`Error: ${err.message}`, 'info')
    }
  }

  init()

  return {
    stop: () => {
      running = false
      if (wsInstance) wsInstance.close()
      if (pollInterval) clearInterval(pollInterval)
      const avgTick = tickTimes.length > 0 ? (tickTimes.reduce((a, b) => a + b, 0) / tickTimes.length).toFixed(2) : 'N/A'
      onLog(`Bot stopped. Final balance: $${paperBalance.toFixed(2)} | Ticks: ${tickCount} | Avg tick: ${avgTick}ms | WS RTT: ${wsLatency}ms`, 'info')
    },
    getAssets: () => ({ clobTokenIds, tokenToOutcome }),
    getStats: () => ({ wsLatency, tickCount, avgTickMs: tickTimes.length > 0 ? tickTimes.reduce((a,b)=>a+b,0)/tickTimes.length : 0 })
  }
}

// ==================== ZONE MANAGER ====================
function ZoneManager({ zones, setZones, disabled, accentColor, label, placeholder }) {
  const addZone = () => {
    setZones(prev => [...prev, { id: Date.now(), low: placeholder.low, high: placeholder.high }])
  }
  const removeZone = (id) => {
    setZones(prev => prev.filter(z => z.id !== id))
  }
  const updateZone = (id, field, val) => {
    const n = parseInt(val, 10)
    if (isNaN(n)) return
    setZones(prev => prev.map(z => z.id === id ? { ...z, [field]: Math.min(99, Math.max(1, n)) } : z))
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
        <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.6rem', color: accentColor, letterSpacing: '0.12em', textTransform: 'uppercase' }}>{label}</span>
        <button className="mini-btn" onClick={addZone} disabled={disabled} style={{ borderColor: `${accentColor}55`, color: accentColor }}>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Add Zone
        </button>
      </div>
      {zones.length === 0 && (
        <div style={{ padding: '0.6rem', background: '#0a0a0f', border: '1px dashed rgba(240,240,248,0.08)', fontFamily: "'Space Mono', monospace", fontSize: '0.58rem', color: '#2a2a3a', textAlign: 'center', letterSpacing: '0.08em' }}>
          No zones — add one
        </div>
      )}
      {zones.map((zone, idx) => (
        <div className="zone-row" key={zone.id}>
          <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.52rem', color: '#2a2a3a', letterSpacing: '0.08em', minWidth: '16px' }}>#{idx + 1}</span>
          <input
            className="zone-input"
            type="number"
            min={1} max={99}
            value={zone.low}
            disabled={disabled}
            onChange={e => updateZone(zone.id, 'low', e.target.value)}
            style={{ borderColor: disabled ? 'rgba(240,240,248,0.06)' : `${accentColor}33` }}
          />
          <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.55rem', color: '#2a2a3a' }}>–</span>
          <input
            className="zone-input"
            type="number"
            min={1} max={99}
            value={zone.high}
            disabled={disabled}
            onChange={e => updateZone(zone.id, 'high', e.target.value)}
            style={{ borderColor: disabled ? 'rgba(240,240,248,0.06)' : `${accentColor}33` }}
          />
          <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.55rem', color: '#2a2a3a', flex: 1 }}>¢</span>
          <button
            className="mini-btn mini-btn-danger"
            onClick={() => removeZone(zone.id)}
            disabled={disabled || zones.length <= 1}
            title="Remove zone"
          >
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
        </div>
      ))}
    </div>
  )
}

// ==================== CONFIG PANEL ====================
function ConfigPanel({ config, setConfig, disabled }) {
  const balanceMin = 1, balanceMax = 1000
  const balancePct = ((config.paperBalance - balanceMin) / (balanceMax - balanceMin)) * 100

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.4rem' }}>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
          <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.65rem', color: '#6b6b8a', letterSpacing: '0.05em' }}>Starting Balance ($)</span>
          <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.65rem', color: '#e8ff47', fontWeight: 700 }}>${config.paperBalance}</span>
        </div>
        <div style={{ position: 'relative', height: '3px', background: 'rgba(240,240,248,0.07)' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${balancePct}%`, background: disabled ? '#2a2a3a' : '#e8ff47', transition: 'width 0.15s' }} />
          <input type="range" min={balanceMin} max={balanceMax} step={1} value={config.paperBalance} disabled={disabled}
            onChange={e => setConfig(c => ({ ...c, paperBalance: Number(e.target.value) }))}
            style={{ position: 'absolute', top: '50%', left: 0, transform: 'translateY(-50%)', width: '100%', height: '20px', opacity: 0, cursor: disabled ? 'not-allowed' : 'pointer', margin: 0 }}
          />
          <div style={{ position: 'absolute', top: '50%', left: `${balancePct}%`, transform: 'translate(-50%, -50%)', width: '12px', height: '12px', borderRadius: '50%', background: disabled ? '#2a2a3a' : '#e8ff47', border: '2px solid #0a0a0f', pointerEvents: 'none', transition: 'left 0.15s' }} />
        </div>
      </div>

      <ZoneManager
        zones={config.buyZones}
        setZones={zones => setConfig(c => ({ ...c, buyZones: typeof zones === 'function' ? zones(c.buyZones) : zones }))}
        disabled={disabled}
        accentColor="#47d4ff"
        label="Buy Zones (¢)"
        placeholder={{ low: 40, high: 50 }}
      />

      <ZoneManager
        zones={config.sellZones}
        setZones={zones => setConfig(c => ({ ...c, sellZones: typeof zones === 'function' ? zones(c.sellZones) : zones }))}
        disabled={disabled}
        accentColor="#e8ff47"
        label="Sell Zones (¢)"
        placeholder={{ low: 60, high: 70 }}
      />

      <div style={{ padding: '0.75rem', background: 'rgba(71,212,255,0.04)', border: '1px solid rgba(71,212,255,0.12)' }}>
        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.55rem', color: '#47d4ff', letterSpacing: '0.1em', marginBottom: '0.3rem' }}>RE-BUY LOGIC</div>
        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.58rem', color: '#6b6b8a', lineHeight: 1.6 }}>
          After a stop-loss sell, skips exactly 1 tick then re-enters freely when price returns to any buy zone. No time-based cooldown.
        </div>
      </div>

      <div style={{ padding: '0.75rem', background: 'rgba(232,255,71,0.04)', border: '1px solid rgba(232,255,71,0.1)' }}>
        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.55rem', color: '#e8ff47', letterSpacing: '0.1em', marginBottom: '0.3rem' }}>HOLD LOGIC</div>
        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.58rem', color: '#6b6b8a', lineHeight: 1.6 }}>
          Holds through all dips above buy price. Sell triggers at any sell zone or if bid falls below buy price (stop-loss).
        </div>
      </div>
    </div>
  )
}

// ==================== OUTCOME CARD ====================
function OutcomeCard({ assetId, outcomeName, ask, bid, mid, prevAsk, position, color, buyZones, sellZones, wsLatency }) {
  const askDelta = ask - prevAsk
  const inBuyZone = buyZones.some(z => ask >= z.low / 100 && ask <= z.high / 100)
  const inSellZone = sellZones.some(z => ask >= z.low / 100 && ask <= z.high / 100)
  const uPnL = position ? (ask - position.buyAsk) * position.shares : 0

  return (
    <div className="card-dark outcome-card" style={{ flex: 1 }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '2px', background: color }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
        <div>
          <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.6rem', color: '#2a2a3a', letterSpacing: '0.1em', marginBottom: '0.3rem' }}>{assetId.slice(0, 12)}…</div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.1rem', letterSpacing: '2px', color: '#f0f0f8' }}>{outcomeName}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.3rem' }}>
          {position && (
            <div style={{ background: 'rgba(232,255,71,0.08)', border: '1px solid rgba(232,255,71,0.2)', padding: '0.2rem 0.6rem' }}>
              <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.55rem', color: '#e8ff47', letterSpacing: '0.1em' }}>HOLDING</span>
            </div>
          )}
          {wsLatency > 0 && (
            <div style={{ background: 'rgba(71,212,255,0.06)', border: '1px solid rgba(71,212,255,0.15)', padding: '0.15rem 0.5rem' }}>
              <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.5rem', color: wsLatency < 100 ? '#47d4ff' : wsLatency < 300 ? '#e8ff47' : '#ff4766' }}>RTT {wsLatency}ms</span>
            </div>
          )}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', marginBottom: '1rem' }}>
        {[
          { label: 'ASK', value: ask > 0 ? `${(ask * 100).toFixed(1)}¢` : 'N/A', highlight: inSellZone ? '#e8ff47' : inBuyZone ? '#47d4ff' : '#f0f0f8' },
          { label: 'BID', value: bid > 0 ? `${(bid * 100).toFixed(1)}¢` : 'N/A', highlight: '#f0f0f8' },
          { label: 'MID', value: mid > 0 ? `${(mid * 100).toFixed(1)}¢` : 'N/A', highlight: '#f0f0f8' },
        ].map(m => (
          <div key={m.label} style={{ background: '#0a0a0f', padding: '0.6rem 0.5rem', textAlign: 'center' }}>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.5rem', color: '#2a2a3a', letterSpacing: '0.1em', marginBottom: '0.25rem' }}>{m.label}</div>
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.2rem', color: m.highlight, letterSpacing: '1px' }}>{m.value}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.6rem', color: askDelta >= 0 ? '#47d4ff' : '#ff4766', letterSpacing: '0.08em' }}>
          Ask Δ {askDelta >= 0 ? '+' : ''}{(askDelta * 100).toFixed(2)}¢
        </span>
        <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
          {inBuyZone && <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.5rem', background: 'rgba(71,212,255,0.12)', color: '#47d4ff', padding: '0.15rem 0.4rem', border: '1px solid rgba(71,212,255,0.2)' }}>BUY ZONE</span>}
          {inSellZone && <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.5rem', background: 'rgba(232,255,71,0.12)', color: '#e8ff47', padding: '0.15rem 0.4rem', border: '1px solid rgba(232,255,71,0.2)' }}>SELL ZONE</span>}
        </div>
      </div>

      <div style={{ position: 'relative', height: '6px', background: 'rgba(240,240,248,0.07)', marginBottom: '0.4rem', borderRadius: '2px' }}>
        {buyZones.map((z, i) => (
          <div key={`b${i}`} style={{ position: 'absolute', left: `${z.low}%`, width: `${z.high - z.low}%`, height: '100%', background: 'rgba(71,212,255,0.35)', borderRadius: '1px' }} />
        ))}
        {sellZones.map((z, i) => (
          <div key={`s${i}`} style={{ position: 'absolute', left: `${z.low}%`, width: `${z.high - z.low}%`, height: '100%', background: 'rgba(232,255,71,0.35)', borderRadius: '1px' }} />
        ))}
        {ask > 0 && <div style={{ position: 'absolute', top: '-2px', left: `${Math.min(97, Math.max(3, ask * 100))}%`, width: '2px', height: '10px', background: color, borderRadius: '1px', transition: 'left 0.5s ease' }} />}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.48rem', color: '#2a2a3a' }}>0¢</span>
        <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.48rem', color: '#47d4ff' }}>Buy zones ↑</span>
        <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.48rem', color: '#e8ff47' }}>Sell zones ↑</span>
        <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.48rem', color: '#2a2a3a' }}>100¢</span>
      </div>

      {position && (
        <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: '#0a0a0f', border: '1px solid rgba(232,255,71,0.1)' }}>
          {[
            { label: 'Bought Ask', value: `${(position.buyAsk * 100).toFixed(1)}¢`, color: '#f0f0f8' },
            { label: 'Peak Ask', value: `${(position.peakAsk * 100).toFixed(1)}¢`, color: '#a78bfa' },
            { label: 'Shares', value: typeof position.shares === 'number' ? position.shares.toFixed(4) : position.shares, color: '#f0f0f8' },
            { label: 'Unrealized P&L', value: `${uPnL >= 0 ? '+' : ''}$${uPnL.toFixed(2)}`, color: uPnL >= 0 ? '#47d4ff' : '#ff4766' },
          ].map(r => (
            <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
              <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.58rem', color: '#6b6b8a' }}>{r.label}</span>
              <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.58rem', fontWeight: 700, color: r.color }}>{r.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ==================== NAVBAR ====================
function Navbar({ botRunning }) {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 40)
    window.addEventListener('scroll', fn)
    return () => window.removeEventListener('scroll', fn)
  }, [])
  return (
    <nav style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 4rem', background: scrolled ? 'rgba(10,10,15,0.95)' : 'rgba(10,10,15,0.7)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(240,240,248,0.07)', transition: 'all 0.4s' }}>
      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.5rem', letterSpacing: '4px', color: '#e8ff47' }}>POLY<span style={{ color: '#ff4766' }}>BOT</span></div>
      <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.6rem', letterSpacing: '0.2em', color: '#2a2a3a', textTransform: 'uppercase' }}>Live Trading Monitor · Real CLOB Data</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <div className={`status-dot ${botRunning ? 'status-live' : 'status-idle'}`} />
        <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.6rem', color: '#6b6b8a', letterSpacing: '0.15em', textTransform: 'uppercase' }}>{botRunning ? 'Live' : 'Idle'}</span>
      </div>
    </nav>
  )
}

function Ticker() {
  const items = ['Live CLOB WebSocket', 'Real Ask Prices', 'Polymarket Feed', 'Multi-Zone Strategy', 'Take Profit Zones', 'Re-Buy on Rebound', 'Paper Trading', 'Gamma API', 'Real-time Monitor']
  return (
    <div className="ticker-wrap">
      <div className="ticker-inner">
        {[...items, ...items].map((it, i) => <div className="ticker-item" key={i}><span>◆</span>{it}</div>)}
      </div>
    </div>
  )
}

function TradeEntry({ trade }) {
  const isB = trade.type === 'BUY'
  const isSellWin = trade.type === 'SELL' && parseFloat(trade.pnl) >= 0
  const cls = isB ? 'trade-buy' : isSellWin ? 'trade-sell-win' : 'trade-sell-loss'
  return (
    <div className={`log-entry ${cls}`} style={{ padding: '0.75rem 1rem', marginBottom: '1px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.6rem', fontWeight: 700, color: isB ? '#47d4ff' : isSellWin ? '#e8ff47' : '#ff4766', letterSpacing: '0.12em' }}>{trade.type}</span>
          <span style={{ fontSize: '0.78rem', color: '#f0f0f8' }}>{trade.outcome}</span>
        </div>
        <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.55rem', color: '#2a2a3a' }}>{trade.time}</span>
      </div>
      {isB ? (
        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.6rem', color: '#6b6b8a' }}>
          Ask@{trade.askPrice}¢ · {trade.shares}sh · Cost ${trade.cost} · Bal ${trade.balanceAfter}
        </div>
      ) : (
        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.6rem', color: '#6b6b8a' }}>
          {trade.buyAsk}¢→{trade.sellAsk}¢ · Peak {trade.peakAsk}¢ ·
          <span style={{ color: parseFloat(trade.pnl) >= 0 ? '#47d4ff' : '#ff4766', fontWeight: 700 }}> {parseFloat(trade.pnl) >= 0 ? '+' : ''}${trade.pnl} </span>
          · {trade.reason}
        </div>
      )}
    </div>
  )
}

function LogLine({ entry }) {
  const colors = { buy: '#47d4ff', sell_win: '#e8ff47', sell_loss: '#ff4766', info: '#6b6b8a' }
  return (
    <div className="log-entry" style={{ display: 'flex', gap: '0.75rem', padding: '0.3rem 0', borderBottom: '1px solid rgba(240,240,248,0.04)' }}>
      <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.55rem', color: '#2a2a3a', flexShrink: 0, paddingTop: '1px' }}>{entry.time}</span>
      <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.65rem', color: colors[entry.type] || '#6b6b8a', lineHeight: 1.5 }}>{entry.text}</span>
    </div>
  )
}

function Sparkline({ data, color = '#e8ff47', height = 40 }) {
  if (!data || data.length < 2) return <div style={{ height }} />
  const min = Math.min(...data), max = Math.max(...data)
  const range = max - min || 0.01
  const w = 200, h = height
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * (h - 4) - 2}`)
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height, display: 'block' }}>
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length-1].split(',')[0]} cy={pts[pts.length-1].split(',')[1]} r="3" fill={color} />
    </svg>
  )
}

// ==================== LATENCY PANEL ====================
function LatencyPanel({ wsLatency, tickCount, logs }) {
  const recentLogs = logs.slice(0, 50)
  const pollLogs = recentLogs.filter(l => l.text.includes('POLL('))
  const pollTimes = pollLogs.map(l => {
    const m = l.text.match(/POLL\((\d+)ms\)/)
    return m ? parseInt(m[1]) : null
  }).filter(Boolean)
  const avgPoll = pollTimes.length > 0 ? Math.round(pollTimes.reduce((a,b)=>a+b,0)/pollTimes.length) : null

  const latencyColor = (ms) => {
    if (!ms || ms === 0) return '#2a2a3a'
    if (ms < 80) return '#47d4ff'
    if (ms < 200) return '#e8ff47'
    return '#ff4766'
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1px', background: 'rgba(240,240,248,0.07)', marginBottom: '1.5rem' }}>
      {[
        { label: 'WS RTT', value: wsLatency > 0 ? `${wsLatency}ms` : '—', color: latencyColor(wsLatency), sub: wsLatency > 0 ? (wsLatency < 80 ? 'Excellent' : wsLatency < 200 ? 'Good' : 'Slow') : 'Pending ping' },
        { label: 'HTTP Poll RTT', value: avgPoll ? `${avgPoll}ms` : '—', color: latencyColor(avgPoll), sub: avgPoll ? `${pollTimes.length} samples` : 'No polls yet' },
        { label: 'Total Ticks', value: tickCount > 0 ? tickCount.toLocaleString() : '0', color: '#a78bfa', sub: 'WS + poll combined' },
        { label: 'Feed Priority', value: 'WS-BBA', color: '#e8ff47', sub: 'best_bid_ask first' },
      ].map((s, i) => (
        <div key={i} style={{ background: '#0a0a0f', padding: '1rem 1.25rem' }}>
          <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.5rem', color: '#2a2a3a', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '0.3rem' }}>{s.label}</div>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.6rem', color: s.color, letterSpacing: '2px', lineHeight: 1 }}>{s.value}</div>
          <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.5rem', color: '#6b6b8a', marginTop: '0.25rem' }}>{s.sub}</div>
        </div>
      ))}
    </div>
  )
}

// ==================== MAIN PAGE ====================
export default function Page() {
  const [slug, setSlug] = useState('atp-montsi-donski-2026-06-06')
  const [botRunning, setBotRunning] = useState(false)
  const [botInstance, setBotInstance] = useState(null)
  const [config, setConfig] = useState({
    paperBalance: 10,
    buyZones: [
      { id: 1, low: 62, high: 64 },
    ],
    sellZones: [
      { id: 2, low: 68, high: 69 },
    ],
  })

  const [balance, setBalance] = useState(10)
  const [positions, setPositions] = useState({})
  const [trades, setTrades] = useState([])
  const [logs, setLogs] = useState([])
  const [ticks, setTicks] = useState({})
  const [balanceHistory, setBalanceHistory] = useState([])
  const [askHistory, setAskHistory] = useState({})
  const [marketInfo, setMarketInfo] = useState(null)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [wsSources, setWsSources] = useState({})
  const [wsLatency, setWsLatency] = useState(0)
  const [tickCount, setTickCount] = useState(0)

  const startTimeRef = useRef(null)
  const timerRef = useRef(null)

  const addLog = useCallback((text, type = 'info') => {
    const entry = { text, type, time: new Date().toLocaleTimeString(), id: Date.now() + Math.random() }
    setLogs(prev => [entry, ...prev].slice(0, 300))
    // Extract WS latency from log
    if (text.startsWith('WS RTT:')) {
      const m = text.match(/(\d+)ms/)
      if (m) setWsLatency(parseInt(m[1]))
    }
  }, [])

  const onTick = useCallback((data) => {
    setTicks(prev => ({ ...prev, [data.assetId]: data }))
    setAskHistory(prev => {
      const hist = prev[data.assetId] || []
      return { ...prev, [data.assetId]: [...hist.slice(-80), data.ask] }
    })
    if (data.source) setWsSources(prev => ({ ...prev, [data.assetId]: data.source }))
    if (data.wsLatency !== undefined && data.wsLatency > 0) setWsLatency(data.wsLatency)
    setTickCount(prev => prev + 1)
  }, [])

  const onTrade = useCallback((entry, newBalance, newPositions) => {
    setTrades(prev => [entry, ...prev])
    setBalance(newBalance)
    setPositions({ ...newPositions })
    setBalanceHistory(prev => [...prev.slice(-80), newBalance])
  }, [])

  const onMarketLoaded = useCallback((info) => {
    setMarketInfo(info)
  }, [])

  const startBot = useCallback(() => {
    if (!slug.trim()) return
    setTrades([])
    setLogs([])
    setTicks({})
    setAskHistory({})
    setBalance(config.paperBalance)
    setBalanceHistory([config.paperBalance])
    setPositions({})
    setElapsedSeconds(0)
    setMarketInfo(null)
    setWsSources({})
    setWsLatency(0)
    setTickCount(0)

    startTimeRef.current = Date.now()
    timerRef.current = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 1000)

    const instance = createBotInstance({ slug, config, onTick, onTrade, onLog: addLog, onMarketLoaded })
    setBotInstance(instance)
    setBotRunning(true)
  }, [slug, config, onTick, onTrade, addLog, onMarketLoaded])

  const stopBot = useCallback(() => {
    if (botInstance) botInstance.stop()
    setBotRunning(false)
    setBotInstance(null)
    clearInterval(timerRef.current)
  }, [botInstance])

  useEffect(() => () => {
    clearInterval(timerRef.current)
    if (botInstance) botInstance.stop()
  }, [])

  const realizedPnL = trades.filter(t => t.type === 'SELL').reduce((s, t) => s + parseFloat(t.pnl), 0)
  const wins = trades.filter(t => t.type === 'SELL' && parseFloat(t.pnl) >= 0).length
  const losses = trades.filter(t => t.type === 'SELL' && parseFloat(t.pnl) < 0).length
  const winRate = (wins + losses) > 0 ? ((wins / (wins + losses)) * 100).toFixed(0) : '--'
  const openCount = Object.keys(positions).length
  const formatTime = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  const assetIds = marketInfo?.clobTokenIds || []
  const outcomes = marketInfo?.outcomes || []
  const activeSource = Object.values(wsSources)[0] || '—'

  return (
    <>
      <div className="grain-overlay" />
      <InjectStyles />
      <Navbar botRunning={botRunning} />

      <main style={{ paddingTop: '5rem', minHeight: '100vh', background: '#0a0a0f' }}>

        {/* HERO */}
        <section style={{ padding: '3rem 4rem 2rem', position: 'relative', overflow: 'hidden' }} className="grid-bg">
          <div style={{ position: 'absolute', top: '20%', right: '10%', width: '300px', height: '300px', borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(232,255,71,0.04) 0%, transparent 70%)', pointerEvents: 'none' }} />
          <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
            <div style={{ display: 'flex', gap: '3rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>

              <div style={{ flex: '1 1 400px' }} className="fade-up">
                <div className="section-label" style={{ marginBottom: '1rem' }}>Polymarket Paper Bot</div>
                <h1 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 'clamp(2.5rem, 6vw, 5rem)', lineHeight: 0.95, letterSpacing: '3px', marginBottom: '1.5rem' }}>
                  LIVE MARKET<br /><span style={{ color: '#e8ff47' }}>MONITOR</span>
                </h1>
                <p style={{ color: '#6b6b8a', fontSize: '0.85rem', lineHeight: 1.8, letterSpacing: '0.02em', marginBottom: '2rem', maxWidth: '420px' }}>
                  Enter a Polymarket event slug. The bot connects directly to the <strong style={{ color: '#f0f0f8' }}>Polymarket CLOB WebSocket</strong> and polls the Gamma API for real live ask/bid prices — no simulation.
                </p>

                <div style={{ marginBottom: '1.5rem' }}>
                  <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.62rem', color: '#6b6b8a', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Event Slug</div>
                  <div style={{ display: 'flex' }}>
                    <input className="slug-input" value={slug} onChange={e => setSlug(e.target.value)} placeholder="e.g. atp-montsi-donski-2026-06-06" disabled={botRunning} style={{ flex: 1 }} />
                    <div style={{ background: '#111118', border: '1px solid rgba(240,240,248,0.12)', borderLeft: 'none', padding: '0.9rem 0.8rem', display: 'flex', alignItems: 'center' }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2a2a3a" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    </div>
                  </div>
                  <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.55rem', color: '#2a2a3a', letterSpacing: '0.08em', marginTop: '0.4rem' }}>
                    From gamma-api.polymarket.com/markets?slug=…
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                  {!botRunning ? (
                    <button className="accent-btn" onClick={startBot} disabled={!slug.trim()}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                      Launch Bot
                    </button>
                  ) : (
                    <button className="danger-btn" onClick={stopBot}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12"/></svg>
                      Stop Bot
                    </button>
                  )}
                  {!botRunning && (
                    <button className="ghost-btn" onClick={() => { setTrades([]); setLogs([]); setBalance(config.paperBalance); setPositions({}); setBalanceHistory([]); setElapsedSeconds(0); setMarketInfo(null); setTicks({}); setAskHistory({}); setWsSources({}); setWsLatency(0); setTickCount(0) }}>
                      Reset
                    </button>
                  )}
                </div>
              </div>

              <div style={{ flex: '1 1 360px' }}>
                <div className="card-dark" style={{ padding: '1.5rem', position: 'relative', overflow: 'hidden' }}>
                  <div className="scanline" />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
                    <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.62rem', color: '#e8ff47', letterSpacing: '0.18em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <div className={`status-dot ${botRunning ? 'status-live' : 'status-idle'}`} />
                      Strategy Config
                    </div>
                    {botRunning && <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.55rem', color: '#ff4766', letterSpacing: '0.1em' }}>LOCKED — BOT RUNNING</span>}
                  </div>
                  <ConfigPanel config={config} setConfig={setConfig} disabled={botRunning} />
                </div>
              </div>
            </div>
          </div>
        </section>

        <Ticker />

        {/* DASHBOARD */}
        {(botRunning || trades.length > 0 || logs.length > 0) && (
          <section style={{ padding: '2rem 4rem 4rem' }}>
            <div style={{ maxWidth: '1400px', margin: '0 auto' }}>

              {marketInfo && (
                <div style={{ marginBottom: '1.5rem', padding: '1rem 1.5rem', background: '#111118', border: '1px solid rgba(232,255,71,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div className={`status-dot ${botRunning ? 'status-live' : 'status-stopped'}`} />
                    <div>
                      <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1rem', letterSpacing: '2px', color: '#f0f0f8' }}>{marketInfo.question}</div>
                      <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.55rem', color: '#2a2a3a', letterSpacing: '0.08em', marginTop: '0.2rem' }}>slug: {marketInfo.slug}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                    {[
                      { label: 'Status', value: botRunning ? 'LIVE' : 'STOPPED', color: botRunning ? '#e8ff47' : '#ff4766' },
                      { label: 'Elapsed', value: formatTime(elapsedSeconds), color: '#f0f0f8' },
                      { label: 'Feed', value: botRunning ? activeSource : '—', color: activeSource.startsWith('WS') ? '#e8ff47' : '#47d4ff' },
                      { label: 'Open', value: openCount, color: openCount > 0 ? '#a78bfa' : '#6b6b8a' },
                    ].map(m => (
                      <div key={m.label} style={{ textAlign: 'right' }}>
                        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.5rem', color: '#2a2a3a', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{m.label}</div>
                        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.75rem', color: m.color, fontWeight: 700, marginTop: '0.15rem' }}>{m.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Latency Panel */}
              {(botRunning || tickCount > 0) && (
                <LatencyPanel wsLatency={wsLatency} tickCount={tickCount} logs={logs} />
              )}

              <div className="stats-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1px', background: 'rgba(240,240,248,0.07)', marginBottom: '1.5rem' }}>
                {[
                  { label: 'Cash Balance', value: `$${balance.toFixed(2)}`, color: '#f0f0f8', sub: `Started $${config.paperBalance}` },
                  { label: 'Realized P&L', value: `${realizedPnL >= 0 ? '+' : ''}$${realizedPnL.toFixed(2)}`, color: realizedPnL > 0 ? '#47d4ff' : realizedPnL < 0 ? '#ff4766' : '#6b6b8a', sub: `${wins}W / ${losses}L` },
                  { label: 'Win Rate', value: winRate === '--' ? '—' : `${winRate}%`, color: '#e8ff47', sub: `${trades.length} total trades` },
                  { label: 'Open Positions', value: openCount, color: openCount > 0 ? '#a78bfa' : '#6b6b8a', sub: openCount > 0 ? 'Actively holding' : 'No positions' },
                  { label: 'Runtime', value: formatTime(elapsedSeconds), color: '#47d4ff', sub: botRunning ? 'Bot active' : 'Bot stopped' },
                ].map((s, i) => (
                  <div key={i} style={{ background: '#0a0a0f', padding: '1.5rem', position: 'relative', overflow: 'hidden' }}>
                    <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)', width: '1px', height: '1.5rem', background: `linear-gradient(180deg, ${s.color}, transparent)` }} />
                    <div className="stat-num" style={{ color: s.color, marginBottom: '0.2rem' }}>{s.value}</div>
                    <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.52rem', color: '#2a2a3a', letterSpacing: '0.12em', textTransform: 'uppercase' }}>{s.label}</div>
                    <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.52rem', color: '#6b6b8a', marginTop: '0.25rem' }}>{s.sub}</div>
                  </div>
                ))}
              </div>

              {assetIds.length > 0 && (
                <div className="outcomes-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1px', background: 'rgba(240,240,248,0.07)', marginBottom: '1.5rem' }}>
                  {assetIds.map((id, i) => {
                    const tick = ticks[id]
                    return (
                      <OutcomeCard
                        key={id}
                        assetId={id}
                        outcomeName={outcomes[i] || `Outcome ${i + 1}`}
                        ask={tick?.ask ?? 0}
                        bid={tick?.bid ?? 0}
                        mid={tick?.mid ?? 0}
                        prevAsk={tick?.prevAsk ?? 0}
                        position={positions[id] || null}
                        color={i === 0 ? '#e8ff47' : '#47d4ff'}
                        buyZones={config.buyZones}
                        sellZones={config.sellZones}
                        wsLatency={wsLatency}
                      />
                    )
                  })}
                </div>
              )}

              {assetIds.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1px', background: 'rgba(240,240,248,0.07)', marginBottom: '1.5rem' }}>
                  {[
                    { label: `${outcomes[0] || 'Outcome 1'} Ask`, data: askHistory[assetIds[0]] || [], color: '#e8ff47' },
                    { label: `${outcomes[1] || 'Outcome 2'} Ask`, data: askHistory[assetIds[1]] || [], color: '#47d4ff' },
                    { label: 'Balance History', data: balanceHistory, color: '#a78bfa' },
                  ].map((sp, i) => (
                    <div key={i} style={{ background: '#0a0a0f', padding: '1rem 1.25rem' }}>
                      <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.55rem', color: '#2a2a3a', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>{sp.label}</div>
                      <Sparkline data={sp.data} color={sp.color} height={48} />
                      {sp.data.length > 0 && (
                        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1rem', color: sp.color, letterSpacing: '1px', marginTop: '0.25rem' }}>
                          {i < 2 ? `${(sp.data[sp.data.length - 1] * 100).toFixed(1)}¢` : `$${sp.data[sp.data.length - 1].toFixed(2)}`}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="dashboard-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                <div className="card-dark" style={{ overflow: 'hidden' }}>
                  <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(240,240,248,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#111118' }}>
                    <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.62rem', color: '#e8ff47', letterSpacing: '0.18em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
                      Trade History
                    </div>
                    <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.55rem', color: '#2a2a3a', letterSpacing: '0.08em' }}>{trades.length} entries</span>
                  </div>
                  <div style={{ height: '380px', overflowY: 'auto', background: '#0a0a0f' }}>
                    {trades.length === 0 ? (
                      <div style={{ padding: '2rem', textAlign: 'center', fontFamily: "'Space Mono', monospace", fontSize: '0.65rem', color: '#2a2a3a', letterSpacing: '0.1em' }}>
                        {botRunning ? 'Waiting for prices in zone...' : 'No trades yet'}
                      </div>
                    ) : trades.map((t, i) => <TradeEntry key={i} trade={t} />)}
                  </div>
                  <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid rgba(240,240,248,0.07)', background: '#111118', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
                    {[
                      { label: 'Buys', value: trades.filter(t => t.type === 'BUY').length, color: '#47d4ff' },
                      { label: 'Sells Win', value: wins, color: '#e8ff47' },
                      { label: 'Sells Loss', value: losses, color: '#ff4766' },
                    ].map(m => (
                      <div key={m.label} style={{ textAlign: 'center' }}>
                        <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.2rem', color: m.color, letterSpacing: '1px' }}>{m.value}</div>
                        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.5rem', color: '#2a2a3a', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{m.label}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="card-dark" style={{ overflow: 'hidden' }}>
                  <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(240,240,248,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#111118' }}>
                    <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.62rem', color: '#e8ff47', letterSpacing: '0.18em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <div className={`status-dot ${botRunning ? 'status-live' : 'status-idle'}`} />
                      Bot Console
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      {['#ff4766', '#e8ff47', '#47d4ff'].map((c, i) => (
                        <div key={i} style={{ width: '8px', height: '8px', borderRadius: '50%', background: c, opacity: 0.6 }} />
                      ))}
                    </div>
                  </div>
                  <div style={{ height: '380px', overflowY: 'auto', background: '#050509', padding: '0.75rem 1.25rem' }}>
                    {logs.length === 0 ? (
                      <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.65rem', color: '#2a2a3a', letterSpacing: '0.1em' }}>
                        {botRunning ? '$ Initializing...' : '$ Ready'}
                        {botRunning && <span className="cursor-blink">_</span>}
                      </div>
                    ) : logs.map((l, i) => <LogLine key={l.id || i} entry={l} />)}
                  </div>
                  <div style={{ padding: '0.6rem 1.25rem', borderTop: '1px solid rgba(240,240,248,0.07)', background: '#111118', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.55rem', color: '#2a2a3a', letterSpacing: '0.1em' }}>polybot.{botRunning ? 'running' : 'idle'}</span>
                    {botRunning && <svg className="spinner" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#e8ff47" strokeWidth="2"><path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48 2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48 2.83-2.83"/></svg>}
                    <span style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.55rem', color: '#2a2a3a', letterSpacing: '0.1em', marginLeft: 'auto' }}>{logs.length} lines</span>
                  </div>
                </div>
              </div>

              {/* Active Strategy summary */}
              <div style={{ marginTop: '1.5rem', padding: '1.25rem 1.5rem', background: '#111118', border: '1px solid rgba(240,240,248,0.07)' }}>
                <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.6rem', color: '#e8ff47', letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: '0.75rem' }}>Active Strategy</div>
                <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.8rem', marginTop: '2px' }}>🟢</span>
                    <div>
                      <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.5rem', color: '#2a2a3a', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Buy Zones</div>
                      {config.buyZones.map((z, i) => (
                        <div key={i} style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.62rem', color: '#47d4ff', fontWeight: 700, marginTop: '0.15rem' }}>{z.low}–{z.high}¢</div>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.8rem', marginTop: '2px' }}>✅</span>
                    <div>
                      <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.5rem', color: '#2a2a3a', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Sell Zones</div>
                      {config.sellZones.map((z, i) => (
                        <div key={i} style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.62rem', color: '#e8ff47', fontWeight: 700, marginTop: '0.15rem' }}>{z.low}–{z.high}¢</div>
                      ))}
                    </div>
                  </div>
                  {[
                    { icon: '🔴', label: 'Stop-Loss', value: 'Below buy price (bid)', color: '#ff4766' },
                    { icon: '🔄', label: 'Re-Buy', value: 'Next tick after stop-loss', color: '#47d4ff' },
                    { icon: '📌', label: 'Hold Logic', value: 'Holds through all dips above buy price', color: '#a78bfa' },
                    { icon: '💰', label: 'Starting Balance', value: `$${config.paperBalance}`, color: '#f0f0f8' },
                  ].map(s => (
                    <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.8rem' }}>{s.icon}</span>
                      <div>
                        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.5rem', color: '#2a2a3a', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{s.label}</div>
                        <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.65rem', color: s.color, fontWeight: 700, marginTop: '0.15rem' }}>{s.value}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </section>
        )}

        {!botRunning && trades.length === 0 && logs.length === 0 && (
          <section style={{ padding: '4rem 4rem 6rem', textAlign: 'center' }}>
            <div style={{ maxWidth: '600px', margin: '0 auto' }}>
              <div style={{ width: '80px', height: '80px', border: '1px solid rgba(232,255,71,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 2rem', position: 'relative' }}>
                <div style={{ position: 'absolute', top: '-6px', left: '-6px', width: '10px', height: '10px', borderTop: '2px solid #e8ff47', borderLeft: '2px solid #e8ff47' }} />
                <div style={{ position: 'absolute', top: '-6px', right: '-6px', width: '10px', height: '10px', borderTop: '2px solid #e8ff47', borderRight: '2px solid #e8ff47' }} />
                <div style={{ position: 'absolute', bottom: '-6px', left: '-6px', width: '10px', height: '10px', borderBottom: '2px solid #e8ff47', borderLeft: '2px solid #e8ff47' }} />
                <div style={{ position: 'absolute', bottom: '-6px', right: '-6px', width: '10px', height: '10px', borderBottom: '2px solid #e8ff47', borderRight: '2px solid #e8ff47' }} />
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#e8ff47" strokeWidth="1.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              </div>
              <h2 style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '2.5rem', letterSpacing: '3px', marginBottom: '1rem', color: '#f0f0f8' }}>
                READY TO <span style={{ color: '#e8ff47' }}>LAUNCH</span>
              </h2>
              <p style={{ color: '#6b6b8a', fontSize: '0.85rem', lineHeight: 1.8, marginBottom: '2rem' }}>
                Enter a Polymarket event slug above, configure your zones, and hit <strong style={{ color: '#e8ff47' }}>Launch Bot</strong> to connect to live market data.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'center' }}>
                {[
                  'Fetches market from gamma-api.polymarket.com',
                  'Connects to wss://ws-subscriptions-clob.polymarket.com',
                  'Polls clob.polymarket.com/book every 2s as backup',
                  'Buys when ask enters any configured buy zone',
                  'Holds through all price swings above buy price',
                  'Sells at any sell zone or below buy price (stop-loss)',
                  'Re-buys on next tick if price returns to buy zone',
                ].map(item => (
                  <div key={item} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontFamily: "'Space Mono', monospace", fontSize: '0.65rem', color: '#6b6b8a', letterSpacing: '0.05em' }}>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#e8ff47" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>

      <footer style={{ background: '#050509', borderTop: '1px solid rgba(240,240,248,0.06)', padding: '2rem 4rem' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
          <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: '1.4rem', letterSpacing: '4px', color: '#e8ff47' }}>POLY<span style={{ color: '#ff4766' }}>BOT</span></div>
          <div style={{ fontFamily: "'Space Mono', monospace", fontSize: '0.58rem', color: '#1a1a24', letterSpacing: '0.08em' }}>
            Paper trading only · Not financial advice · Real CLOB bid/ask prices
          </div>
        </div>
      </footer>
    </>
  )
}