import { useEffect, useRef, useState, useCallback } from 'react'
import { PageFlip } from 'page-flip'
import { Book, BookOpen, Maximize2, Minimize2, Smartphone } from 'lucide-react'
import { FlowButton } from './components/FlowButton'
import { trackVisit } from './lib/analytics'
import 'page-flip/src/Style/stPageFlip.css'
import './App.css'

const NAV_H = 72
const PRELOAD_AHEAD = 8
const PRELOAD_CONCURRENCY = 6

/** Real phones/tablets only — not touchscreen laptops (those still need the nav bar). */
function isPhoneViewport() {
  return window.matchMedia(
    '(max-width: 920px) and (hover: none) and (pointer: coarse)'
  ).matches
}

function isLandscape() {
  return window.innerWidth >= window.innerHeight
}

function chromeHeight() {
  if (document.fullscreenElement) return 0
  if (isPhoneViewport()) return 0
  return NAV_H
}

/** Prefer visualViewport — excludes mobile browser chrome more accurately. */
function viewportSize() {
  const vv = window.visualViewport
  return {
    w: Math.floor(vv?.width || window.innerWidth),
    h: Math.floor(vv?.height || window.innerHeight),
  }
}

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

async function lockPortrait() {
  try {
    if (screen.orientation?.lock) {
      await screen.orientation.lock('portrait')
    }
  } catch {
    // Browsers often require fullscreen / may deny — ignore
  }
}

async function tryFullscreen() {
  try {
    const el = document.documentElement
    if (document.fullscreenElement) return true
    // Prefer standard API; some Android browsers need the element from a gesture
    if (el.requestFullscreen) {
      await el.requestFullscreen({ navigationUI: 'hide' })
      return true
    }
    if (el.webkitRequestFullscreen) {
      await el.webkitRequestFullscreen()
      return true
    }
  } catch {
    // iOS Safari blocks Fullscreen API for non-video — use CSS immersive instead
  }
  return false
}

function setImmersiveClass(on) {
  document.documentElement.classList.toggle('nn-immersive', on)
  document.body.classList.toggle('nn-immersive', on)
}

export default function App() {
  const hostRef = useRef(null)
  const bookRootRef = useRef(null)
  const pageFlipRef = useRef(null)
  const sourcesRef = useRef([])
  const preloadedRef = useRef(new Set())
  const naturalRef = useRef({ w: 1, h: 1.4 })

  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [totalPages, setTotalPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(0)
  const [loadHint, setLoadHint] = useState('Opening document…')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [gotoValue, setGotoValue] = useState('')
  const [phoneLandscape, setPhoneLandscape] = useState(
    () => isPhoneViewport() && isLandscape()
  )
  const [hideChrome, setHideChrome] = useState(
    () => Boolean(document.fullscreenElement) || isPhoneViewport()
  )
  const [singlePage, setSinglePage] = useState(() => isPhoneViewport())
  const singlePageRef = useRef(isPhoneViewport())
  const immersiveRef = useRef(false)
  const [immersive, setImmersive] = useState(false)

  const calcPageSize = useCallback((imgW, imgH) => {
    const pageAspect = imgW / imgH
    const phone = isPhoneViewport()
    const single = singlePageRef.current || phone
    const { w: vw, h: vh } = viewportSize()
    // Small inset so page edges aren't clipped by the flip container / safe areas
    const pad = phone ? 4 : (immersiveRef.current || document.fullscreenElement ? 0 : 16)
    const maxH = Math.max(160, vh - chromeHeight() - pad * 2)
    const maxW = Math.max(120, vw - pad * 2)
    const pagesWide = single ? 1 : 2

    // Always contain (never crop page sides/top) — letterbox if needed
    let h = maxH
    let pageW = h * pageAspect
    if (pageW * pagesWide > maxW) {
      pageW = maxW / pagesWide
      h = pageW / pageAspect
    }
    return {
      width: Math.max(120, Math.floor(pageW)),
      height: Math.max(160, Math.floor(h)),
    }
  }, [])

  const applyBookSize = useCallback((size) => {
    const root = bookRootRef.current
    const pf = pageFlipRef.current
    if (!root || !pf) return
    const phone = isPhoneViewport()
    const pagesWide = (singlePageRef.current || phone) ? 1 : 2
    root.style.width = `${size.width * pagesWide}px`
    root.style.height = `${size.height}px`
    root.style.minWidth = `${size.width * pagesWide}px`
    root.style.minHeight = `${size.height}px`
    root.style.maxWidth = `${size.width * pagesWide}px`
    const settings = pf.getSettings()
    settings.width = size.width
    settings.height = size.height
    settings.minWidth = size.width
    settings.maxWidth = size.width
    settings.minHeight = size.height
    settings.maxHeight = size.height
    settings.usePortrait = true
    try {
      pf.update()
    } catch {
      // ignore transient update errors during rotate
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

  const syncLayoutFlags = useCallback(() => {
    const phone = isPhoneViewport()
    setPhoneLandscape(phone && isLandscape())
    setHideChrome(
      Boolean(document.fullscreenElement) || immersiveRef.current || phone
    )
    setIsFullscreen(Boolean(document.fullscreenElement) || immersiveRef.current)
    setImmersive(immersiveRef.current)
    if (phone && !singlePageRef.current) {
      singlePageRef.current = true
      setSinglePage(true)
    }
  }, [])

  const enterImmersive = useCallback(async () => {
    await tryFullscreen()
    immersiveRef.current = true
    setImmersiveClass(true)
    setImmersive(true)
    setIsFullscreen(true)
    setHideChrome(true)
    if (isPhoneViewport()) await lockPortrait()
    // Nudge iOS Safari to collapse the URL bar
    window.scrollTo(0, 1)
    const { w, h } = naturalRef.current
    requestAnimationFrame(() => {
      applyBookSize(calcPageSize(w, h))
      window.scrollTo(0, 1)
    })
  }, [applyBookSize, calcPageSize])

  const exitImmersive = useCallback(async () => {
    immersiveRef.current = false
    setImmersiveClass(false)
    setImmersive(false)
    try {
      if (document.fullscreenElement) {
        if (document.exitFullscreen) await document.exitFullscreen()
        else if (document.webkitExitFullscreen) await document.webkitExitFullscreen()
      }
    } catch {
      // ignore
    }
    syncLayoutFlags()
    const { w, h } = naturalRef.current
    requestAnimationFrame(() => applyBookSize(calcPageSize(w, h)))
  }, [applyBookSize, calcPageSize, syncLayoutFlags])

  useEffect(() => {
    const refit = () => {
      syncLayoutFlags()
      const { w, h } = naturalRef.current
      applyBookSize(calcPageSize(w, h))
    }
    const onFs = () => {
      if (document.fullscreenElement) {
        immersiveRef.current = true
        setImmersiveClass(true)
        if (isPhoneViewport()) lockPortrait()
      } else if (!immersiveRef.current) {
        setImmersiveClass(false)
      }
      requestAnimationFrame(refit)
    }
    document.addEventListener('fullscreenchange', onFs)
    window.addEventListener('resize', refit)
    window.addEventListener('orientationchange', refit)
    window.visualViewport?.addEventListener('resize', refit)
    window.visualViewport?.addEventListener('scroll', refit)
    syncLayoutFlags()
    return () => {
      document.removeEventListener('fullscreenchange', onFs)
      window.removeEventListener('resize', refit)
      window.removeEventListener('orientationchange', refit)
      window.visualViewport?.removeEventListener('resize', refit)
      window.visualViewport?.removeEventListener('scroll', refit)
    }
  }, [applyBookSize, calcPageSize, syncLayoutFlags])

  // Phone: force single-page + enter immersive once ready
  useEffect(() => {
    if (status !== 'ready' || !isPhoneViewport()) return undefined
    singlePageRef.current = true
    setSinglePage(true)
    lockPortrait()
    const { w, h } = naturalRef.current
    applyBookSize(calcPageSize(w, h))
    return undefined
  }, [status, applyBookSize, calcPageSize])

  useEffect(() => {
    trackVisit()
  }, [])

  useEffect(() => {
    if (status !== 'ready') return

    const onKey = (e) => {
      if (e.target instanceof HTMLElement) {
        const tag = e.target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable) return
      }
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault()
        ensurePreloaded(currentPage + 1, PRELOAD_AHEAD)
        pageFlipRef.current?.flipNext()
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        pageFlipRef.current?.flipPrev()
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [status, currentPage, ensurePreloaded])

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

      const sources = Array.from({ length: total }, (_, i) => ({
        type: 'image',
        src: `/pages/page-${String(i + 1).padStart(4, '0')}.jpg`,
      }))
      sources.splice(3, 0, { type: 'blank' })
      sources.splice(sources.length - 1, 0, { type: 'blank' })
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
      naturalRef.current = natural
      preloadedRef.current.add(firstSrc)

      const size = calcPageSize(natural.w, natural.h)

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
      const pagesWide = singlePageRef.current ? 1 : 2
      root.className = 'flipbook'
      root.style.width = `${size.width * pagesWide}px`
      root.style.height = `${size.height}px`
      root.style.minWidth = `${size.width * pagesWide}px`
      root.style.minHeight = `${size.height}px`
      root.style.maxWidth = `${size.width * pagesWide}px`
      hostRef.current.appendChild(root)
      bookRootRef.current = root

      sources.forEach((entry, index) => {
        const page = document.createElement('div')
        const isCover = index === 0 || index === sources.length - 1
        page.className = [
          'page',
          entry.type === 'blank' ? 'page--blank' : '',
          isCover ? 'page--cover' : '',
        ].filter(Boolean).join(' ')
        page.dataset.density = isCover ? 'hard' : 'soft'

        if (entry.type === 'blank') {
          page.setAttribute('aria-label', 'Blank page')
        } else {
          const img = document.createElement('img')
          img.src = entry.src
          img.alt = isCover
            ? (index === 0 ? 'Front cover' : 'Back cover')
            : `Page ${index + 1}`
          img.draggable = false
          img.decoding = 'async'
          img.loading = 'eager'
          img.fetchPriority = index < 6 ? 'high' : 'low'
          page.appendChild(img)
        }

        root.appendChild(page)
      })

      // Match StPageFlip demo defaults for natural crease / flip shadows
      const pf = new PageFlip(root, {
        width: size.width,
        height: size.height,
        size: 'fixed',
        showCover: true,
        usePortrait: true,
        autoSize: false,
        drawShadow: true,
        flippingTime: 1000,
        useMouseEvents: true,
        mobileScrollSupport: true,
        swipeDistance: 30,
        maxShadowOpacity: 0.5,
        showPageCorners: true,
        startZIndex: 0,
      })

      pf.loadFromHTML(root.querySelectorAll('.page'))
      pf.on('flip', (e) => {
        setCurrentPage(e.data)
        ensurePreloaded(e.data + 1, PRELOAD_AHEAD)
      })
      pageFlipRef.current = pf

      // Fit again after layout settles (esp. mobile browser chrome)
      requestAnimationFrame(() => {
        applyBookSize(calcPageSize(natural.w, natural.h))
      })

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
      bookRootRef.current = null
      if (hostRef.current) hostRef.current.innerHTML = ''
    }
  }, [applyBookSize, calcPageSize, ensurePreloaded])

  const goNext = () => {
    ensurePreloaded(currentPage + 1, PRELOAD_AHEAD)
    pageFlipRef.current?.flipNext()
  }
  const goPrev = () => pageFlipRef.current?.flipPrev()

  const phoneTurn = (dir) => {
    if (isPhoneViewport() && !immersiveRef.current && !document.fullscreenElement) {
      enterImmersive()
    }
    if (dir === 'next') goNext()
    else goPrev()
  }

  const goToPage = (raw) => {
    const pf = pageFlipRef.current
    if (!pf || !totalPages) return
    const n = Number.parseInt(String(raw).trim(), 10)
    if (!Number.isFinite(n)) return
    const index = Math.min(totalPages, Math.max(1, n)) - 1
    ensurePreloaded(Math.max(0, index - 2), PRELOAD_AHEAD + 2)
    pf.turnToPage(index)
    setCurrentPage(index)
    setGotoValue('')
  }

  const goToCover = () => {
    const pf = pageFlipRef.current
    if (!pf) return
    ensurePreloaded(0, PRELOAD_AHEAD)
    pf.turnToPage(0)
    setCurrentPage(0)
  }

  const togglePageMode = () => {
    if (isPhoneViewport()) return // phones stay single-page
    const next = !singlePageRef.current
    singlePageRef.current = next
    setSinglePage(next)
    const pf = pageFlipRef.current
    const page = pf?.getCurrentPageIndex?.() ?? currentPage
    const { w, h } = naturalRef.current
    const size = calcPageSize(w, h)
    applyBookSize(size)
    if (pf) {
      try {
        pf.turnToPage(page)
        setCurrentPage(page)
      } catch {
        // ignore
      }
    }
  }

  const toggleFullscreen = async () => {
    if (document.fullscreenElement || immersiveRef.current) {
      await exitImmersive()
    } else {
      await enterImmersive()
    }
  }

  const enterPhonePortrait = async () => {
    singlePageRef.current = true
    setSinglePage(true)
    await enterImmersive()
    syncLayoutFlags()
  }

  return (
    <div className="app">
      {(status === 'loading' || status === 'error') && (
        <div className="loading-screen">
          <div className="loading-inner">
            <img
              className="loading-logo"
              src="/logo.png"
              alt="Newton's Notebook"
              width={160}
              height={160}
            />
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

      {phoneLandscape && status === 'ready' && (
        <div className="rotate-gate">
          <Smartphone className="rotate-gate__icon" size={48} />
          <div className="rotate-gate__title">Hold upright</div>
          <div className="rotate-gate__text">
            Newton&apos;s Notebook reads one page at a time in portrait. Rotate, then tap below.
          </div>
          <button type="button" className="rotate-gate__btn" onClick={enterPhonePortrait}>
            Open fullscreen
          </button>
        </div>
      )}

      <div
        className={[
          'viewer',
          hideChrome ? 'viewer--fullscreen' : '',
          isPhoneViewport() ? 'viewer--phone' : '',
          singlePage || isPhoneViewport() ? 'viewer--single' : '',
          immersive ? 'viewer--immersive' : '',
        ].filter(Boolean).join(' ')}
        style={{ visibility: status === 'ready' ? 'visible' : 'hidden' }}
      >
        <button
          type="button"
          className="fullscreen-btn"
          onClick={toggleFullscreen}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </button>

        <div className="flipbook-wrap">
          <div className="book-stage">
            <div ref={hostRef} className="flipbook-host" />
          </div>
        </div>

        {isPhoneViewport() && status === 'ready' && !phoneLandscape && (
          <>
            <button
              type="button"
              className="phone-turn phone-turn--prev"
              onClick={() => phoneTurn('prev')}
              aria-label="Previous page"
            />
            <button
              type="button"
              className="phone-turn phone-turn--next"
              onClick={() => phoneTurn('next')}
              aria-label="Next page"
            />
          </>
        )}

        {!hideChrome && (
          <div className="nav-bar">
            <FlowButton text="Prev" direction="prev" onClick={goPrev} />
            <div className="nav-center">
              <span className="page-label">Page {currentPage + 1} of {totalPages}</span>
              <form
                className="goto-form"
                onSubmit={(e) => {
                  e.preventDefault()
                  goToPage(gotoValue)
                }}
              >
                <label className="goto-label" htmlFor="goto-page">Go to</label>
                <input
                  id="goto-page"
                  className="goto-input"
                  type="number"
                  min={1}
                  max={totalPages || 1}
                  inputMode="numeric"
                  placeholder="#"
                  value={gotoValue}
                  onChange={(e) => setGotoValue(e.target.value)}
                />
                <button type="submit" className="goto-btn">Go</button>
              </form>
            </div>
            <FlowButton text="Next" direction="next" onClick={goNext} />
          </div>
        )}

        {!isPhoneViewport() && (
          <button
            type="button"
            className={`mode-btn${singlePage ? ' mode-btn--active' : ''}`}
            onClick={togglePageMode}
            aria-pressed={singlePage}
            aria-label={singlePage ? 'Switch to two-page spread' : 'Switch to one page at a time'}
            title={singlePage ? 'Two-page spread' : 'One page at a time'}
          >
            {singlePage ? <BookOpen size={16} /> : <Book size={16} />}
            {singlePage ? '2 Pages' : '1 Page'}
          </button>
        )}

        {currentPage > 0 && (
          <button
            type="button"
            className="cover-btn"
            onClick={goToCover}
            aria-label="Go to cover"
            title="Go to cover"
          >
            Cover
          </button>
        )}
      </div>
    </div>
  )
}
