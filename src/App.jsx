import { useEffect, useRef, useState, useCallback } from 'react'
import { PageFlip } from 'page-flip'
import 'page-flip/src/Style/stPageFlip.css'
import './App.css'

const NAV_H = 56

export default function App() {
  const hostRef = useRef(null)
  const pageFlipRef = useRef(null)

  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [totalPages, setTotalPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(0)

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

  useEffect(() => {
    let destroyed = false

    async function init() {
      const res = await fetch('/pages/manifest.json')
      if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) {
        throw new Error('Pages not generated yet. Run: npm run prerender')
      }
      const { total } = await res.json()
      if (destroyed || !hostRef.current) return

      // Build page list, then insert a blank at position 4 so double-page
      // spreads line up (cover, 2–3, blank|4, then 5–6, 7–8, …)
      const sources = Array.from({ length: total }, (_, i) => ({
        type: 'image',
        src: `/pages/page-${String(i + 1).padStart(4, '0')}.jpg`,
      }))
      sources.splice(3, 0, { type: 'blank' }) // 0-based index 3 = page 4
      setTotalPages(sources.length)

      const natural = await new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
        img.onerror = reject
        img.src = '/pages/page-0001.jpg'
      })
      if (destroyed || !hostRef.current) return

      const size = calcPageSize(natural.w, natural.h)
      setStatus('ready')

      await new Promise((r) => requestAnimationFrame(r))
      if (destroyed || !hostRef.current) return

      // Mount PageFlip on a child node — destroy() removes that child, not React's host
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
          img.loading = index < 5 ? 'eager' : 'lazy'
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
      pf.on('flip', (e) => setCurrentPage(e.data))
      pageFlipRef.current = pf
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
  }, [calcPageSize])

  const goNext = () => pageFlipRef.current?.flipNext()
  const goPrev = () => pageFlipRef.current?.flipPrev()

  return (
    <div className="app">
      {(status === 'loading' || status === 'error') && (
        <div className="loading-screen">
          <div className="loading-inner">
            <div className="loading-title">Newton's Notebook</div>
            <div className="loading-subtitle">Haverford School Student Publication</div>
            {status === 'loading' && <div className="spinner" />}
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
