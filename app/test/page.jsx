'use client'

import { useState, useEffect, useRef, useCallback } from 'react'



// ==================== REAL BOT INSTANCE ====================
function createBotInstance({ slug, config, onTick, onTrade, onLog, onMarketLoaded }) {
  let running = true
  let positions = {}
  let tradeLog = []
  let paperBalance = config.paperBalance
  let lastAsk = {}
  let lastBid = {}
  let lastSellTime = {}
  let wsInstance = null
  let pollInterval = null
  let tokenToOutcome = {}
  let clobTokenIds = []

  function tryBuy(assetId, outcomeName, ask) {
    if (positions[assetId]) return
    if (!ask || ask <= 0) return
    const cooldown = config.buyCooldownMs - (Date.now() - (lastSellTime[assetId] || 0))
    if (cooldown > 0) return
    if (ask >= config.buyZoneLow && ask <= config.buyZoneHigh) {
      const shares = 1 / ask
      const cost = 1
      if (paperBalance < cost) return
      paperBalance -= cost
      positions[assetId] = { shares, buyAsk: ask, outcomeName, peakAsk: ask }
      const entry = { type: 'BUY', outcome: outcomeName, shares: shares.toFixed(4), askPrice: (ask * 100).toFixed(1), cost: cost.toFixed(2), balanceAfter: paperBalance.toFixed(2), time: new Date().toLocaleTimeString(), assetId }
      tradeLog.push(entry)
      onTrade(entry, paperBalance, positions)
      onLog(`BUY ${outcomeName} | Ask@${(ask*100).toFixed(1)}¢ | ${shares.toFixed(4)}sh | $${cost.toFixed(2)}`, 'buy')
    }
  }

  function trySell(assetId, ask) {
    const pos = positions[assetId]
    if (!pos || !ask || ask <= 0) return
    if (ask > pos.peakAsk) pos.peakAsk = ask

    let shouldSell = false, sellReason = ''

    if (ask < pos.buyAsk) {
      shouldSell = true
      sellReason = `Stop-loss: bought@${(pos.buyAsk*100).toFixed(1)}¢ now@${(ask*100).toFixed(1)}¢`
    }

    if (!shouldSell && ask >= config.sellZoneLow && ask <= config.sellZoneHigh) {
      shouldSell = true
      sellReason = `Target zone: ask@${(ask*100).toFixed(1)}¢`
    }

    if (!shouldSell) return

    const proceeds = pos.shares * ask
    const cost = pos.shares * pos.buyAsk
    const pnl = proceeds - cost
    paperBalance += proceeds
    lastSellTime[assetId] = Date.now()
    const entry = { type: 'SELL', outcome: pos.outcomeName, shares: pos.shares, buyAsk: (pos.buyAsk*100).toFixed(1), sellAsk: (ask*100).toFixed(1), peakAsk: (pos.peakAsk*100).toFixed(1), pnl: pnl.toFixed(2), reason: sellReason, balanceAfter: paperBalance.toFixed(2), time: new Date().toLocaleTimeString(), assetId }
    tradeLog.push(entry)
    delete positions[assetId]
    onTrade(entry, paperBalance, positions)
    const icon = pnl >= 0 ? 'SELL WIN' : 'SELL LOSS'
    onLog(`${icon} ${pos.outcomeName} | ${(pos.buyAsk*100).toFixed(1)}¢→${(ask*100).toFixed(1)}¢ | P&L: ${pnl>=0?'+':''}$${pnl.toFixed(2)} | ${sellReason}`, pnl >= 0 ? 'sell_win' : 'sell_loss')
  }

  function processTick(assetId, outcomeName, rawMid, rawBid, rawAsk, source) {
    const prevAsk = lastAsk[assetId] || rawAsk
    const bid = rawBid > 0 ? rawBid : (lastBid[assetId] || 0)
    const ask = rawAsk > 0 ? rawAsk : (lastAsk[assetId] || 0)
    const mid = rawMid > 0 ? rawMid : (bid + ask) / 2
    if (bid > 0) lastBid[assetId] = bid
    if (ask > 0) lastAsk[assetId] = ask

    const hadPositionBefore = !!positions[assetId]

    onTick({ assetId, outcomeName, ask, bid, mid, prevAsk, source, positions: { ...positions }, balance: paperBalance })
    tryBuy(assetId, outcomeName, ask)

    if (hadPositionBefore) {
      trySell(assetId, ask)
    }
  }

  function connectWebSocket() {
    if (!running) return
    onLog(`Connecting to Polymarket CLOB WebSocket...`, 'info')
    const ws = new WebSocket('wss://ws-subscriptions-clob.polymarket.com/ws/market')
    wsInstance = ws

    ws.onopen = () => {
      onLog(`WebSocket connected — subscribing to ${clobTokenIds.length} assets`, 'info')
      ws.send(JSON.stringify({
        assets_ids: clobTokenIds,
        type: 'market',
        custom_feature_enabled: true
      }))
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        const priceChanges = msg.price_changes || []
        for (const change of priceChanges) {
          const assetId = change.asset_id
          if (!assetId || !tokenToOutcome[assetId]) continue
          const outcomeName = tokenToOutcome[assetId]
          const rawMid = parseFloat(change.price || 0)
          const rawBid = parseFloat(change.best_bid || 0)
          const rawAsk = parseFloat(change.best_ask || 0)
          processTick(assetId, outcomeName, rawMid, rawBid, rawAsk, 'WS')
        }
      } catch (e) {}
    }

    ws.onclose = () => {
      if (!running) return
      onLog(`WebSocket closed. Reconnecting in 4s...`, 'info')
      setTimeout(connectWebSocket, 4000)
    }

    ws.onerror = () => {
      onLog(`WebSocket error — falling back to polling`, 'info')
    }
  }

  async function pollPrice(tokenId, outcomeName) {
    try {
      const res = await fetch(`https://clob.polymarket.com/price?token_id=${tokenId}`)
      if (!res.ok) return
      const data = await res.json()
      const rawMid = parseFloat(data.price || 0)
      if (rawMid <= 0) return
      const rawBid = lastBid[tokenId] || 0
      const rawAsk = lastAsk[tokenId] || 0
      processTick(tokenId, outcomeName, rawMid, rawBid, rawAsk, 'POLL')
    } catch (e) {}
  }

  async function startPolling() {
    pollInterval = setInterval(() => {
      clobTokenIds.forEach((id, i) => {
        pollPrice(id, Object.values(tokenToOutcome)[i] || `Outcome ${i+1}`)
      })
    }, 5000)
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
        if (typeof val === 'string') {
          try { return JSON.parse(val) } catch { return [] }
        }
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
        lastSellTime[id] = 0
      })

      onMarketLoaded({ question: market.question, outcomes, slug, clobTokenIds })

      onLog(`Market: ${market.question}`, 'info')
      onLog(`Outcomes: ${outcomes.join(' vs ')}`, 'info')
      onLog(`Assets: ${clobTokenIds.length} token(s) found`, 'info')
      onLog(`Initial prices: ${prices.map((p, i) => `${outcomes[i] || i}: ${(parseFloat(p)*100).toFixed(1)}¢`).join(' | ')}`, 'info')
      onLog(`Strategy: BUY ${(config.buyZoneLow*100)}–${(config.buyZoneHigh*100)}¢ | SELL ${(config.sellZoneLow*100)}–${(config.sellZoneHigh*100)}¢`, 'info')
      onLog(`Starting balance: $${config.paperBalance}`, 'info')

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
      onLog(`Bot stopped. Final balance: $${paperBalance.toFixed(2)}`, 'info')
    },
    getAssets: () => ({ clobTokenIds, tokenToOutcome }),
  }
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
    <nav className={`fixed top-0 left-0 right-0 z-[100] flex items-center justify-between gap-4 px-6 md:px-16 py-4 border-b border-white/[0.07] backdrop-blur-xl transition-all duration-400 ${scrolled ? 'bg-[#0a0a0f]/95' : 'bg-[#0a0a0f]/70'}`}>
      <div className="font-['Bebas_Neue'] text-2xl tracking-[4px] text-[#e8ff47]">
        POLY<span className="text-[#ff4766]">BOT</span>
      </div>
      <div className="hidden md:block font-['Space_Mono'] text-[0.6rem] tracking-[0.2em] text-[#2a2a3a] uppercase">
        Live Trading Monitor · Real CLOB Data
      </div>
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${botRunning ? 'bg-[#e8ff47] animate-pulseAccent' : 'bg-[#2a2a3a]'}`} />
        <span className="font-['Space_Mono'] text-[0.6rem] text-[#6b6b8a] tracking-[0.15em] uppercase">{botRunning ? 'Live' : 'Idle'}</span>
      </div>
    </nav>
  )
}

// ==================== TICKER ====================
function Ticker() {
  const items = ['Live CLOB WebSocket', 'Real Ask Prices', 'Polymarket Feed', 'Stop Loss Only', 'Take Profit Zone', 'Hold Through Dips', 'Paper Trading', 'Gamma API', 'Real-time Monitor']
  return (
    <div className="overflow-hidden whitespace-nowrap bg-[#111118] border-t border-b border-white/[0.07] py-3.5">
      <div className="inline-flex gap-16 animate-tickerScroll">
        {[...items, ...items].map((it, i) => (
          <div key={i} className="font-['Space_Mono'] text-[0.62rem] tracking-[0.25em] uppercase text-[#2a2a3a] flex items-center gap-4">
            <span className="text-[#e8ff47]">◆</span>{it}
          </div>
        ))}
      </div>
    </div>
  )
}

// ==================== CONFIG PANEL ====================
function ConfigPanel({ config, setConfig, disabled }) {
  const fields = [
    { key: 'paperBalance', label: 'Starting Balance ($)', min: 1, max: 1000, step: 1, format: v => `$${v}`, display: v => v, parse: v => v },
    { key: 'buyZoneLow', label: 'Buy Zone Low (¢)', min: 1, max: 99, step: 1, display: v => Math.round(v * 100), parse: v => v / 100, format: v => `${Math.round(v*100)}¢` },
    { key: 'buyZoneHigh', label: 'Buy Zone High (¢)', min: 1, max: 99, step: 1, display: v => Math.round(v * 100), parse: v => v / 100, format: v => `${Math.round(v*100)}¢` },
    { key: 'sellZoneLow', label: 'Sell Zone Low (¢)', min: 1, max: 99, step: 1, display: v => Math.round(v * 100), parse: v => v / 100, format: v => `${Math.round(v*100)}¢` },
    { key: 'sellZoneHigh', label: 'Sell Zone High (¢)', min: 1, max: 99, step: 1, display: v => Math.round(v * 100), parse: v => v / 100, format: v => `${Math.round(v*100)}¢` },
  ]
  return (
    <div className="flex flex-col gap-5">
      {fields.map(f => {
        const displayVal = f.display(config[f.key])
        const minD = f.key === 'paperBalance' ? f.min : 1
        const maxD = f.key === 'paperBalance' ? f.max : 99
        const pct = ((displayVal - minD) / (maxD - minD)) * 100
        return (
          <div key={f.key}>
            <div className="flex justify-between mb-2">
              <span className="font-['Space_Mono'] text-[0.65rem] text-[#6b6b8a] tracking-wide">{f.label}</span>
              <span className="font-['Space_Mono'] text-[0.65rem] text-[#e8ff47] font-bold">{f.format(config[f.key])}</span>
            </div>
            <div className="relative h-[3px] bg-white/[0.07]">
              <div
                className={`absolute left-0 top-0 h-full transition-all duration-150 ${disabled ? 'bg-[#2a2a3a]' : 'bg-[#e8ff47]'}`}
                style={{ width: `${pct}%` }}
              />
              <input
                type="range"
                min={minD}
                max={maxD}
                step={f.step}
                value={displayVal}
                disabled={disabled}
                onChange={e => setConfig(c => ({ ...c, [f.key]: f.parse(Number(e.target.value)) }))}
                className={`absolute top-1/2 left-0 -translate-y-1/2 w-full h-5 opacity-0 m-0 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
              />
              <div
                className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-[#0a0a0f] pointer-events-none transition-all duration-150 ${disabled ? 'bg-[#2a2a3a]' : 'bg-[#e8ff47]'}`}
                style={{ left: `${pct}%` }}
              />
            </div>
          </div>
        )
      })}
      <div className="p-3 bg-[#e8ff47]/[0.04] border border-[#e8ff47]/10">
        <div className="font-['Space_Mono'] text-[0.55rem] text-[#e8ff47] tracking-wide mb-1">HOLD LOGIC</div>
        <div className="font-['Space_Mono'] text-[0.58rem] text-[#6b6b8a] leading-relaxed">
          Holds through all dips above buy price. Sell only triggers at target zone or if price falls below buy price.
        </div>
      </div>
    </div>
  )
}

// ==================== OUTCOME CARD ====================
function OutcomeCard({ assetId, outcomeName, ask, bid, mid, prevAsk, position, color, buyZoneLow, buyZoneHigh, sellZoneLow, sellZoneHigh }) {
  const askDelta = ask - prevAsk
  const inBuyZone = ask >= buyZoneLow && ask <= buyZoneHigh
  const inSellZone = ask >= sellZoneLow && ask <= sellZoneHigh
  const uPnL = position ? (ask - position.buyAsk) * position.shares : 0
  return (
    <div className="relative overflow-hidden bg-[#111118] border border-white/[0.07] p-6 flex-1">
      <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: color }} />

      <div className="flex justify-between items-start mb-4">
        <div>
          <div className="font-['Space_Mono'] text-[0.6rem] text-[#2a2a3a] tracking-wide mb-1">{assetId.slice(0, 12)}…</div>
          <div className="font-['Bebas_Neue'] text-[1.1rem] tracking-[2px] text-[#f0f0f8]">{outcomeName}</div>
        </div>
        {position && (
          <div className="bg-[#e8ff47]/[0.08] border border-[#e8ff47]/20 px-2.5 py-1">
            <span className="font-['Space_Mono'] text-[0.55rem] text-[#e8ff47] tracking-wide">HOLDING</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 mb-4">
        {[
          { label: 'ASK', value: ask > 0 ? `${(ask * 100).toFixed(1)}¢` : 'N/A', highlight: inSellZone ? '#e8ff47' : inBuyZone ? '#47d4ff' : '#f0f0f8' },
          { label: 'BID', value: bid > 0 ? `${(bid * 100).toFixed(1)}¢` : 'N/A', highlight: '#f0f0f8' },
          { label: 'MID', value: mid > 0 ? `${(mid * 100).toFixed(1)}¢` : 'N/A', highlight: '#f0f0f8' },
        ].map(m => (
          <div key={m.label} className="bg-[#0a0a0f] py-2.5 px-2 text-center">
            <div className="font-['Space_Mono'] text-[0.5rem] text-[#2a2a3a] tracking-wide mb-1">{m.label}</div>
            <div className="font-['Bebas_Neue'] text-[1.2rem] tracking-wide" style={{ color: m.highlight }}>{m.value}</div>
          </div>
        ))}
      </div>

      <div className="flex justify-between items-center mb-3">
        <span className={`font-['Space_Mono'] text-[0.6rem] tracking-wide ${askDelta >= 0 ? 'text-[#47d4ff]' : 'text-[#ff4766]'}`}>
          Ask Δ {askDelta >= 0 ? '+' : ''}{(askDelta * 100).toFixed(2)}¢
        </span>
        <div className="flex gap-1">
          {inBuyZone && <span className="font-['Space_Mono'] text-[0.5rem] bg-[#47d4ff]/[0.12] text-[#47d4ff] px-1.5 py-0.5 border border-[#47d4ff]/20">BUY ZONE</span>}
          {inSellZone && <span className="font-['Space_Mono'] text-[0.5rem] bg-[#e8ff47]/[0.12] text-[#e8ff47] px-1.5 py-0.5 border border-[#e8ff47]/20">SELL ZONE</span>}
        </div>
      </div>

      <div className="relative h-[3px] bg-white/[0.07] mb-1.5">
        <div className="absolute h-full bg-[#47d4ff]/30" style={{ left: `${buyZoneLow*100}%`, width: `${(buyZoneHigh-buyZoneLow)*100}%` }} />
        <div className="absolute h-full bg-[#e8ff47]/30" style={{ left: `${sellZoneLow*100}%`, width: `${(sellZoneHigh-sellZoneLow)*100}%` }} />
        {ask > 0 && (
          <div
            className="absolute -top-[3px] w-[2px] h-[9px] transition-all duration-500 ease-in-out"
            style={{ left: `${Math.min(95, Math.max(5, ask * 100))}%`, background: color }}
          />
        )}
      </div>

      <div className="flex justify-between">
        <span className="font-['Space_Mono'] text-[0.48rem] text-[#2a2a3a]">0¢</span>
        <span className="font-['Space_Mono'] text-[0.48rem] text-[#47d4ff]">{Math.round(buyZoneLow*100)}¢↑buy</span>
        <span className="font-['Space_Mono'] text-[0.48rem] text-[#e8ff47]">{Math.round(sellZoneLow*100)}¢↑sell</span>
        <span className="font-['Space_Mono'] text-[0.48rem] text-[#2a2a3a]">100¢</span>
      </div>

      {position && (
        <div className="mt-3 p-3 bg-[#0a0a0f] border border-[#e8ff47]/10">
          {[
            { label: 'Bought Ask', value: `${(position.buyAsk * 100).toFixed(1)}¢`, color: '#f0f0f8' },
            { label: 'Peak Ask', value: `${(position.peakAsk * 100).toFixed(1)}¢`, color: '#a78bfa' },
            { label: 'Shares', value: position.shares, color: '#f0f0f8' },
            { label: 'Unrealized P&L', value: `${uPnL >= 0 ? '+' : ''}$${uPnL.toFixed(2)}`, color: uPnL >= 0 ? '#47d4ff' : '#ff4766' },
          ].map(r => (
            <div key={r.label} className="flex justify-between mb-1">
              <span className="font-['Space_Mono'] text-[0.58rem] text-[#6b6b8a]">{r.label}</span>
              <span className="font-['Space_Mono'] text-[0.58rem] font-bold" style={{ color: r.color }}>{r.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ==================== TRADE ENTRY ====================
function TradeEntry({ trade }) {
  const isB = trade.type === 'BUY'
  const isSellWin = trade.type === 'SELL' && parseFloat(trade.pnl) >= 0
  const cls = isB
    ? 'border-l-2 border-[#47d4ff] bg-[#47d4ff]/[0.04]'
    : isSellWin
      ? 'border-l-2 border-[#e8ff47] bg-[#e8ff47]/[0.04]'
      : 'border-l-2 border-[#ff4766] bg-[#ff4766]/[0.04]'
  return (
    <div className={`animate-logFade ${cls} px-4 py-3 mb-px`}>
      <div className="flex justify-between items-start mb-1">
        <div className="flex items-center gap-2">
          <span className={`font-['Space_Mono'] text-[0.6rem] font-bold tracking-wide ${isB ? 'text-[#47d4ff]' : isSellWin ? 'text-[#e8ff47]' : 'text-[#ff4766]'}`}>{trade.type}</span>
          <span className="text-[0.78rem] text-[#f0f0f8]">{trade.outcome}</span>
        </div>
        <span className="font-['Space_Mono'] text-[0.55rem] text-[#2a2a3a]">{trade.time}</span>
      </div>
      {isB ? (
        <div className="font-['Space_Mono'] text-[0.6rem] text-[#6b6b8a]">
          Ask@{trade.askPrice}¢ · {trade.shares}sh · Cost ${trade.cost} · Bal ${trade.balanceAfter}
        </div>
      ) : (
        <div className="font-['Space_Mono'] text-[0.6rem] text-[#6b6b8a]">
          {trade.buyAsk}¢→{trade.sellAsk}¢ · Peak {trade.peakAsk}¢ ·
          <span className={`font-bold ${parseFloat(trade.pnl) >= 0 ? 'text-[#47d4ff]' : 'text-[#ff4766]'}`}> {parseFloat(trade.pnl) >= 0 ? '+' : ''}${trade.pnl} </span>
          · {trade.reason}
        </div>
      )}
    </div>
  )
}

// ==================== LOG LINE ====================
function LogLine({ entry }) {
  const colors = { buy: 'text-[#47d4ff]', sell_win: 'text-[#e8ff47]', sell_loss: 'text-[#ff4766]', info: 'text-[#6b6b8a]' }
  return (
    <div className="animate-logFade flex gap-3 py-1.5 border-b border-white/[0.04]">
      <span className="font-['Space_Mono'] text-[0.55rem] text-[#2a2a3a] flex-shrink-0 pt-px">{entry.time}</span>
      <span className={`font-['Space_Mono'] text-[0.65rem] leading-relaxed ${colors[entry.type] || 'text-[#6b6b8a]'}`}>{entry.text}</span>
    </div>
  )
}

// ==================== SPARKLINE ====================
function Sparkline({ data, color = '#e8ff47', height = 40 }) {
  if (!data || data.length < 2) return <div style={{ height }} />
  const min = Math.min(...data), max = Math.max(...data)
  const range = max - min || 0.01
  const w = 200, h = height
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * (h - 4) - 2}`)
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full block" style={{ height }}>
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length-1].split(',')[0]} cy={pts[pts.length-1].split(',')[1]} r="3" fill={color} />
    </svg>
  )
}

// ==================== MAIN PAGE ====================
export default function Page() {
  const [slug, setSlug] = useState('atp-montsi-donski-2026-06-06')
  const [botRunning, setBotRunning] = useState(false)
  const [botInstance, setBotInstance] = useState(null)
  const [config, setConfig] = useState({
    paperBalance: 10,
    buyZoneLow: 0.62,
    buyZoneHigh: 0.64,
    sellZoneLow: 0.68,
    sellZoneHigh: 0.69,
    peakDropCents: 0.01,
    buyCooldownMs: 0,
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

  const startTimeRef = useRef(null)
  const timerRef = useRef(null)

  const addLog = useCallback((text, type = 'info') => {
    const entry = { text, type, time: new Date().toLocaleTimeString(), id: Date.now() + Math.random() }
    setLogs(prev => [entry, ...prev].slice(0, 300))
  }, [])

  const onTick = useCallback((data) => {
    setTicks(prev => ({ ...prev, [data.assetId]: data }))
    setAskHistory(prev => {
      const hist = prev[data.assetId] || []
      return { ...prev, [data.assetId]: [...hist.slice(-80), data.ask] }
    })
    if (data.source) setWsSources(prev => ({ ...prev, [data.assetId]: data.source }))
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
    

      {/* Grain overlay */}
      <div
        className="grain-overlay fixed inset-0 pointer-events-none z-[999] opacity-[0.035]"
        style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")" }}
      />

      <Navbar botRunning={botRunning} />

      <main className="pt-20 min-h-screen bg-[#0a0a0f]">

        {/* HERO */}
        <section
          className="relative overflow-hidden px-6 md:px-16 pt-12 pb-8"
          style={{
            backgroundImage:
              'linear-gradient(rgba(240,240,248,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(240,240,248,0.03) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        >
          <div className="absolute top-[20%] right-[10%] w-[300px] h-[300px] rounded-full pointer-events-none"
               style={{ background: 'radial-gradient(ellipse, rgba(232,255,71,0.04) 0%, transparent 70%)' }} />

          <div className="max-w-[1400px] mx-auto">
            <div className="flex gap-12 items-start flex-wrap">

              <div className="flex-1 min-w-[320px] animate-fadeUp">
                <div className="font-['Space_Mono'] text-[0.62rem] tracking-[0.3em] uppercase text-[#e8ff47] flex items-center gap-3 mb-4 before:content-[''] before:inline-block before:w-6 before:h-px before:bg-[#e8ff47]">
                  Polymarket Paper Bot
                </div>
                <h1 className="font-['Bebas_Neue'] leading-[0.95] tracking-[3px] mb-6 text-[clamp(2.5rem,6vw,5rem)]">
                  LIVE MARKET<br /><span className="text-[#e8ff47]">MONITOR</span>
                </h1>
                <p className="text-[#6b6b8a] text-[0.85rem] leading-loose tracking-wide mb-8 max-w-[420px]">
                  Enter a Polymarket event slug. The bot connects directly to the <strong className="text-[#f0f0f8]">Polymarket CLOB WebSocket</strong> and polls the Gamma API for real live ask/bid prices — no simulation.
                </p>

                <div className="mb-6">
                  <div className="font-['Space_Mono'] text-[0.62rem] text-[#6b6b8a] tracking-[0.15em] uppercase mb-2">Event Slug</div>
                  <div className="flex">
                    <input
                      value={slug}
                      onChange={e => setSlug(e.target.value)}
                      placeholder="e.g. atp-montsi-donski-2026-06-06"
                      disabled={botRunning}
                      className="flex-1 bg-[#111118] border border-white/[0.12] text-[#f0f0f8] px-5 py-3.5 font-['Space_Mono'] text-[0.82rem] tracking-wide w-full outline-none transition-all focus:border-[#e8ff47] focus:ring-1 focus:ring-[#e8ff47]/[0.15] placeholder:text-[#2a2a3a] disabled:opacity-60"
                    />
                    <div className="bg-[#111118] border border-white/[0.12] border-l-0 px-3 flex items-center">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2a2a3a" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    </div>
                  </div>
                  <div className="font-['Space_Mono'] text-[0.55rem] text-[#2a2a3a] tracking-wide mt-1.5">
                    From gamma-api.polymarket.com/markets?slug=…
                  </div>
                </div>

                <div className="flex gap-3 flex-wrap">
                  {!botRunning ? (
                    <button
                      onClick={startBot}
                      disabled={!slug.trim()}
                      className="bg-[#e8ff47] text-[#0a0a0f] border-none px-8 py-3.5 font-['Space_Mono'] text-[0.72rem] font-bold tracking-[0.2em] uppercase cursor-pointer transition-all inline-flex items-center gap-2 hover:not-disabled:bg-[#f5ff7a] hover:not-disabled:-translate-y-0.5 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                      Launch Bot
                    </button>
                  ) : (
                    <button
                      onClick={stopBot}
                      className="bg-transparent border border-[#ff4766] text-[#ff4766] px-8 py-3.5 font-['Space_Mono'] text-[0.72rem] font-bold tracking-[0.2em] uppercase cursor-pointer transition-all inline-flex items-center gap-2 hover:bg-[#ff4766]/[0.08] hover:-translate-y-0.5"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12"/></svg>
                      Stop Bot
                    </button>
                  )}
                  {!botRunning && (
                    <button
                      onClick={() => { setTrades([]); setLogs([]); setBalance(config.paperBalance); setPositions({}); setBalanceHistory([]); setElapsedSeconds(0); setMarketInfo(null); setTicks({}); setAskHistory({}); setWsSources({}) }}
                      className="bg-transparent border border-white/[0.15] text-[#6b6b8a] px-8 py-3.5 font-['Space_Mono'] text-[0.72rem] tracking-[0.2em] uppercase cursor-pointer transition-all inline-flex items-center gap-2 hover:border-[#f0f0f8] hover:text-[#f0f0f8]"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>

              <div className="flex-1 min-w-[300px]">
                <div className="relative overflow-hidden bg-[#111118] border border-white/[0.07] p-6">
                  <div className="absolute top-0 left-0 right-0 h-[2px] animate-scanSlide"
                       style={{ background: 'linear-gradient(90deg, transparent, rgba(232,255,71,0.08), transparent)' }} />
                  <div className="flex items-center justify-between mb-5">
                    <div className="font-['Space_Mono'] text-[0.62rem] text-[#e8ff47] tracking-[0.18em] uppercase flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${botRunning ? 'bg-[#e8ff47] animate-pulseAccent' : 'bg-[#2a2a3a]'}`} />
                      Strategy Config
                    </div>
                    {botRunning && <span className="font-['Space_Mono'] text-[0.55rem] text-[#ff4766] tracking-wide">LOCKED — BOT RUNNING</span>}
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
          <section className="px-6 md:px-16 pt-8 pb-16">
            <div className="max-w-[1400px] mx-auto">

              {marketInfo && (
                <div className="mb-6 px-6 py-4 bg-[#111118] border border-[#e8ff47]/[0.12] flex items-center justify-between flex-wrap gap-4">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${botRunning ? 'bg-[#e8ff47] animate-pulseAccent' : 'bg-[#ff4766]'}`} />
                    <div>
                      <div className="font-['Bebas_Neue'] text-base tracking-[2px] text-[#f0f0f8]">{marketInfo.question}</div>
                      <div className="font-['Space_Mono'] text-[0.55rem] text-[#2a2a3a] tracking-wide mt-0.5">slug: {marketInfo.slug}</div>
                    </div>
                  </div>
                  <div className="flex gap-8 flex-wrap">
                    {[
                      { label: 'Status', value: botRunning ? 'LIVE' : 'STOPPED', color: botRunning ? '#e8ff47' : '#ff4766' },
                      { label: 'Elapsed', value: formatTime(elapsedSeconds), color: '#f0f0f8' },
                      { label: 'Feed', value: botRunning ? activeSource : '—', color: activeSource === 'WS' ? '#e8ff47' : '#47d4ff' },
                      { label: 'Open', value: openCount, color: openCount > 0 ? '#a78bfa' : '#6b6b8a' },
                    ].map(m => (
                      <div key={m.label} className="text-right">
                        <div className="font-['Space_Mono'] text-[0.5rem] text-[#2a2a3a] tracking-wide uppercase">{m.label}</div>
                        <div className="font-['Space_Mono'] text-[0.75rem] font-bold mt-0.5" style={{ color: m.color }}>{m.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-white/[0.07] mb-6">
                {[
                  { label: 'Cash Balance', value: `$${balance.toFixed(2)}`, color: '#f0f0f8', sub: `Started $${config.paperBalance}` },
                  { label: 'Realized P&L', value: `${realizedPnL >= 0 ? '+' : ''}$${realizedPnL.toFixed(2)}`, color: realizedPnL > 0 ? '#47d4ff' : realizedPnL < 0 ? '#ff4766' : '#6b6b8a', sub: `${wins}W / ${losses}L` },
                  { label: 'Win Rate', value: winRate === '--' ? '—' : `${winRate}%`, color: '#e8ff47', sub: `${trades.length} total trades` },
                  { label: 'Open Positions', value: openCount, color: openCount > 0 ? '#a78bfa' : '#6b6b8a', sub: openCount > 0 ? 'Actively holding' : 'No positions' },
                  { label: 'Runtime', value: formatTime(elapsedSeconds), color: '#47d4ff', sub: botRunning ? 'Bot active' : 'Bot stopped' },
                ].map((s, i) => (
                  <div key={i} className="relative overflow-hidden bg-[#0a0a0f] p-6">
                    <div className="absolute top-0 left-1/2 -translate-x-1/2 w-px h-6"
                         style={{ background: `linear-gradient(180deg, ${s.color}, transparent)` }} />
                    <div className="font-['Bebas_Neue'] text-[2.2rem] leading-none tracking-wider mb-1" style={{ color: s.color }}>{s.value}</div>
                    <div className="font-['Space_Mono'] text-[0.52rem] text-[#2a2a3a] tracking-wide uppercase">{s.label}</div>
                    <div className="font-['Space_Mono'] text-[0.52rem] text-[#6b6b8a] mt-1">{s.sub}</div>
                  </div>
                ))}
              </div>

              {assetIds.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-white/[0.07] mb-6">
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
                        buyZoneLow={config.buyZoneLow}
                        buyZoneHigh={config.buyZoneHigh}
                        sellZoneLow={config.sellZoneLow}
                        sellZoneHigh={config.sellZoneHigh}
                      />
                    )
                  })}
                </div>
              )}

              {assetIds.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-white/[0.07] mb-6">
                  {[
                    { label: `${outcomes[0] || 'Outcome 1'} Ask`, data: askHistory[assetIds[0]] || [], color: '#e8ff47' },
                    { label: `${outcomes[1] || 'Outcome 2'} Ask`, data: askHistory[assetIds[1]] || [], color: '#47d4ff' },
                    { label: 'Balance History', data: balanceHistory, color: '#a78bfa' },
                  ].map((sp, i) => (
                    <div key={i} className="bg-[#0a0a0f] px-5 py-4">
                      <div className="font-['Space_Mono'] text-[0.55rem] text-[#2a2a3a] tracking-wide uppercase mb-2">{sp.label}</div>
                      <Sparkline data={sp.data} color={sp.color} height={48} />
                      {sp.data.length > 0 && (
                        <div className="font-['Bebas_Neue'] text-base tracking-wide mt-1" style={{ color: sp.color }}>
                          {i < 2 ? `${(sp.data[sp.data.length - 1] * 100).toFixed(1)}¢` : `$${sp.data[sp.data.length - 1].toFixed(2)}`}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Trade History */}
                <div className="overflow-hidden bg-[#111118] border border-white/[0.07]">
                  <div className="px-5 py-4 border-b border-white/[0.07] flex items-center justify-between bg-[#111118]">
                    <div className="font-['Space_Mono'] text-[0.62rem] text-[#e8ff47] tracking-[0.18em] uppercase flex items-center gap-2">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
                      Trade History
                    </div>
                    <span className="font-['Space_Mono'] text-[0.55rem] text-[#2a2a3a] tracking-wide">{trades.length} entries</span>
                  </div>
                  <div className="h-[380px] overflow-y-auto bg-[#0a0a0f]">
                    {trades.length === 0 ? (
                      <div className="p-8 text-center font-['Space_Mono'] text-[0.65rem] text-[#2a2a3a] tracking-wide">
                        {botRunning ? 'Waiting for prices in zone...' : 'No trades yet'}
                      </div>
                    ) : trades.map((t, i) => <TradeEntry key={i} trade={t} />)}
                  </div>
                  <div className="px-5 py-3 border-t border-white/[0.07] bg-[#111118] grid grid-cols-3 gap-2">
                    {[
                      { label: 'Buys', value: trades.filter(t => t.type === 'BUY').length, color: '#47d4ff' },
                      { label: 'Sells Win', value: wins, color: '#e8ff47' },
                      { label: 'Sells Loss', value: losses, color: '#ff4766' },
                    ].map(m => (
                      <div key={m.label} className="text-center">
                        <div className="font-['Bebas_Neue'] text-xl tracking-wide" style={{ color: m.color }}>{m.value}</div>
                        <div className="font-['Space_Mono'] text-[0.5rem] text-[#2a2a3a] tracking-wide uppercase">{m.label}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Bot Console */}
                <div className="overflow-hidden bg-[#111118] border border-white/[0.07]">
                  <div className="px-5 py-4 border-b border-white/[0.07] flex items-center justify-between bg-[#111118]">
                    <div className="font-['Space_Mono'] text-[0.62rem] text-[#e8ff47] tracking-[0.18em] uppercase flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${botRunning ? 'bg-[#e8ff47] animate-pulseAccent' : 'bg-[#2a2a3a]'}`} />
                      Bot Console
                    </div>
                    <div className="flex gap-2">
                      {['#ff4766', '#e8ff47', '#47d4ff'].map((c, i) => (
                        <div key={i} className="w-2 h-2 rounded-full opacity-60" style={{ background: c }} />
                      ))}
                    </div>
                  </div>
                  <div className="h-[380px] overflow-y-auto bg-[#050509] px-5 py-3">
                    {logs.length === 0 ? (
                      <div className="font-['Space_Mono'] text-[0.65rem] text-[#2a2a3a] tracking-wide">
                        {botRunning ? '$ Initializing...' : '$ Ready'}
                        {botRunning && <span className="animate-blinkCursor">_</span>}
                      </div>
                    ) : logs.map((l, i) => <LogLine key={l.id || i} entry={l} />)}
                  </div>
                  <div className="px-5 py-2.5 border-t border-white/[0.07] bg-[#111118] flex items-center gap-2">
                    <span className="font-['Space_Mono'] text-[0.55rem] text-[#2a2a3a] tracking-wide">polybot.{botRunning ? 'running' : 'idle'}</span>
                    {botRunning && (
                      <svg className="animate-spin" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#e8ff47" strokeWidth="2">
                        <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48 2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48 2.83-2.83"/>
                      </svg>
                    )}
                    <span className="font-['Space_Mono'] text-[0.55rem] text-[#2a2a3a] tracking-wide ml-auto">{logs.length} lines</span>
                  </div>
                </div>
              </div>

              <div className="mt-6 px-6 py-5 bg-[#111118] border border-white/[0.07]">
                <div className="font-['Space_Mono'] text-[0.6rem] text-[#e8ff47] tracking-[0.18em] uppercase mb-3">Active Strategy</div>
                <div className="flex gap-8 flex-wrap">
                  {[
                    { icon: '🟢', label: 'BUY Zone', value: `${Math.round(config.buyZoneLow*100)}–${Math.round(config.buyZoneHigh*100)}¢ ask`, color: '#47d4ff' },
                    { icon: '✅', label: 'SELL Target', value: `${Math.round(config.sellZoneLow*100)}–${Math.round(config.sellZoneHigh*100)}¢ ask`, color: '#e8ff47' },
                    { icon: '🔴', label: 'Stop-Loss', value: 'Below buy price', color: '#ff4766' },
                    { icon: '📌', label: 'Hold Logic', value: 'Holds through all dips above buy price', color: '#a78bfa' },
                    { icon: '💰', label: 'Starting Balance', value: `$${config.paperBalance}`, color: '#f0f0f8' },
                  ].map(s => (
                    <div key={s.label} className="flex items-center gap-2">
                      <span className="text-base">{s.icon}</span>
                      <div>
                        <div className="font-['Space_Mono'] text-[0.5rem] text-[#2a2a3a] tracking-wide uppercase">{s.label}</div>
                        <div className="font-['Space_Mono'] text-[0.65rem] font-bold mt-0.5" style={{ color: s.color }}>{s.value}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* EMPTY STATE */}
        {!botRunning && trades.length === 0 && logs.length === 0 && (
          <section className="px-6 md:px-16 py-16 md:py-24 text-center">
            <div className="max-w-[600px] mx-auto">
              <div className="relative w-20 h-20 border border-[#e8ff47]/[0.15] flex items-center justify-center mx-auto mb-8">
                <div className="absolute -top-1.5 -left-1.5 w-2.5 h-2.5 border-t-2 border-l-2 border-[#e8ff47]" />
                <div className="absolute -top-1.5 -right-1.5 w-2.5 h-2.5 border-t-2 border-r-2 border-[#e8ff47]" />
                <div className="absolute -bottom-1.5 -left-1.5 w-2.5 h-2.5 border-b-2 border-l-2 border-[#e8ff47]" />
                <div className="absolute -bottom-1.5 -right-1.5 w-2.5 h-2.5 border-b-2 border-r-2 border-[#e8ff47]" />
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#e8ff47" strokeWidth="1.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              </div>
              <h2 className="font-['Bebas_Neue'] text-[2.5rem] tracking-[3px] mb-4 text-[#f0f0f8]">
                READY TO <span className="text-[#e8ff47]">LAUNCH</span>
              </h2>
              <p className="text-[#6b6b8a] text-[0.85rem] leading-loose mb-8">
                Enter a Polymarket event slug above, configure your zones, and hit <strong className="text-[#e8ff47]">Launch Bot</strong> to connect to live market data.
              </p>
              <div className="flex flex-col gap-2 items-center">
                {[
                  'Fetches market from gamma-api.polymarket.com',
                  'Connects to wss://ws-subscriptions-clob.polymarket.com',
                  'Polls clob.polymarket.com/price every 5s as backup',
                  'Buys when ask enters your configured buy zone',
                  'Holds through all price swings above buy price',
                  'Sells only at target zone or below buy price (stop-loss)',
                ].map(item => (
                  <div key={item} className="flex items-center gap-2.5 font-['Space_Mono'] text-[0.65rem] text-[#6b6b8a] tracking-wide">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#e8ff47" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>

      <footer className="bg-[#050509] border-t border-white/[0.06] px-6 md:px-16 py-8">
        <div className="max-w-[1400px] mx-auto flex items-center justify-between flex-wrap gap-4">
          <div className="font-['Bebas_Neue'] text-2xl tracking-[4px] text-[#e8ff47]">
            POLY<span className="text-[#ff4766]">BOT</span>
          </div>
          <div className="font-['Space_Mono'] text-[0.58rem] text-[#1a1a24] tracking-wide">
            Paper trading only · Not financial advice · Real CLOB ask prices
          </div>
        </div>
      </footer>
    </>
  )
}