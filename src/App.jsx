import { useEffect, useRef, useState, useCallback } from 'react'
import { PageFlip } from 'page-flip'
import 'page-flip/src/Style/stPageFlip.css'
import './App.css'

const NAV_H = 56
const PRELOAD_AHEAD = 8
const PRELOAD_CONCURRENCY = 6

function preloadImage(src) {
  return new Promise((resolve) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(src)
    img.onerror = () => resolve(src)
    img.src = src
  })
}

async function preloadMany(srcs, concurrency = PRELOAD_CONCURRENCY, cancelled) {
  let i = 0
  async function worker() {
    while (i < srcs.length) {
      if (cancelled?.()) return
      const src = srcs[i++]
      if (!src) continue
      await preloadImage(src)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()))
}

export default function App() {
  const hostRef = useRef(null)
  const pageFlipRef = useRef(null)
  const sourcesRef = useRef([])
  const preloadedRef = useRef(new Set())

  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [totalPages, setTotalPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(0)
  const [loadHint, setLoadHint] = useState('Opening document…')

  const calcPageSize = useCallback((imgW, imgH) => {
    const pageAspect = imgW / imgH
    const maxH = window.innerHeight - NAV_H - 16
    const maxW = window.innerWidth * 0.98
    let h = maxH
    let pageW = h * pageAspect
    if (pageW * 2 > maxW) {
      pageW = maxW / 2
      h = pageW / pageAspect
    }
    return {
      width: Math.floor(pageW),
      height: Math.floor(h),
    }
  }, [])

  const ensurePreloaded = useCallback(async (fromIndex, count = PRELOAD_AHEAD) => {
    const sources = sourcesRef.current
    const pending = []
    for (let i = fromIndex; i < Math.min(fromIndex + count, sources.length); i++) {
      const entry = sources[i]
      if (!entry || entry.type !== 'image') continue
      if (preloadedRef.current.has(entry.src)) continue
      pending.push(entry.src)
    }
    await Promise.all(
      pending.map(async (src) => {
        await preloadImage(src)
        preloadedRef.current.add(src)
      })
    )
  }, [])

  useEffect(() => {
    let destroyed = false
    const cancelled = () => destroyed

    async function init() {
      const res = await fetch('/pages/manifest.json')
      if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) {
        throw new Error('Pages not generated yet. Run: npm run prerender')
      }
      const { total } = await res.json()
      if (destroyed || !hostRef.current) return

      // Build page list + blank at page 4 for spread alignment
      const sources = Array.from({ length: total }, (_, i) => ({
        type: 'image',
        src: `/pages/page-${String(i + 1).padStart(4, '0')}.jpg`,
      }))
      sources.splice(3, 0, { type: 'blank' })
      sourcesRef.current = sources
      setTotalPages(sources.length)

      const firstSrc = sources.find((s) => s.type === 'image').src
      const natural = await new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
        img.onerror = reject
        img.src = firstSrc
      })
      if (destroyed || !hostRef.current) return
      preloadedRef.current.add(firstSrc)

      const size = calcPageSize(natural.w, natural.h)

      // Warm the first spread(s) before showing the book — no black pages at start
      setLoadHint('Loading first pages…')
      const initialSrcs = sources
        .slice(0, 6)
        .filter((s) => s.type === 'image')
        .map((s) => s.src)
      await preloadMany(initialSrcs, 4, cancelled)
      initialSrcs.forEach((s) => preloadedRef.current.add(s))
      if (destroyed || !hostRef.current) return

      setStatus('ready')
      await new Promise((r) => requestAnimationFrame(r))
      if (destroyed || !hostRef.current) return

      hostRef.current.innerHTML = ''
      const root = document.createElement('div')
      root.className = 'flipbook'
      root.style.width = `${size.width * 2}px`
      root.style.height = `${size.height}px`
      hostRef.current.appendChild(root)

      sources.forEach((entry, index) => {
        const page = document.createElement('div')
        page.className = entry.type === 'blank' ? 'page page--blank' : 'page'
        page.dataset.density =
          index === 0 || index === sources.length - 1 ? 'hard' : 'soft'

        if (entry.type === 'blank') {
          page.setAttribute('aria-label', 'Blank page')
        } else {
          const img = document.createElement('img')
          img.src = entry.src
          img.alt = `Page ${index + 1}`
          img.draggable = false
          img.decoding = 'async'
          img.loading = 'eager'
          img.fetchPriority = index < 6 ? 'high' : 'low'
          page.appendChild(img)
        }

        root.appendChild(page)
      })

      const pf = new PageFlip(root, {
        width: size.width,
        height: size.height,
        size: 'fixed',
        showCover: true,
        usePortrait: false,
        autoSize: true,
        drawShadow: true,
        flippingTime: 700,
        useMouseEvents: true,
        mobileScrollSupport: true,
        swipeDistance: 30,
        maxShadowOpacity: 0.5,
        showPageCorners: true,
      })

      pf.loadFromHTML(root.querySelectorAll('.page'))
      pf.on('flip', (e) => {
        setCurrentPage(e.data)
        // Prefetch the next spread(s) as soon as the user turns
        ensurePreloaded(e.data + 1, PRELOAD_AHEAD)
      })
      pageFlipRef.current = pf

      // Keep downloading the rest in the background so later flips are instant
      const rest = sources
        .filter((s) => s.type === 'image' && !preloadedRef.current.has(s.src))
        .map((s) => s.src)

      preloadMany(rest, PRELOAD_CONCURRENCY, cancelled).then(() => {
        rest.forEach((s) => preloadedRef.current.add(s))
      })
    }

    init().catch((err) => {
      console.error(err)
      setError(err.message || 'Failed to load notebook pages')
      setStatus('error')
    })

    return () => {
      destroyed = true
      try { pageFlipRef.current?.destroy() } catch (_) {}
      pageFlipRef.current = null
      if (hostRef.current) hostRef.current.innerHTML = ''
    }
  }, [calcPageSize, ensurePreloaded])

  const goNext = () => {
    const next = currentPage + 1
    ensurePreloaded(next, PRELOAD_AHEAD)
    pageFlipRef.current?.flipNext()
  }
  const goPrev = () => pageFlipRef.current?.flipPrev()

  return (
    <div className="app">
      {(status === 'loading' || status === 'error') && (
        <div className="loading-screen">
          <div className="loading-inner">
            <div className="loading-title">Newton's Notebook</div>
            <div className="loading-subtitle">Haverford School Student Publication</div>
            {status === 'loading' && (
              <>
                <div className="spinner" />
                <div className="progress-text">{loadHint}</div>
              </>
            )}
            {status === 'error' && <div className="progress-text">{error}</div>}
          </div>
        </div>
      )}

      <div className="viewer" style={{ visibility: status === 'ready' ? 'visible' : 'hidden' }}>
        <div className="flipbook-wrap">
          <div ref={hostRef} className="flipbook-host" />
        </div>

        <div className="nav-bar">
          <button type="button" className="nav-btn" onClick={goPrev}>‹ Prev</button>
          <span className="page-label">Page {currentPage + 1} of {totalPages}</span>
          <button type="button" className="nav-btn" onClick={goNext}>Next ›</button>
        </div>
      </div>
    </div>
  )
}
