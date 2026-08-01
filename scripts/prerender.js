/**
 * Pre-renders every PDF page to JPEG via real Chromium (Playwright).
 * Run once: npm run prerender
 */
import { chromium } from 'playwright'
import { createServer } from 'http'
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'fs'
import { resolve, dirname, extname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT      = resolve(__dirname, '..')
const PDF_PATH  = resolve(ROOT, 'public', 'newtons-notebook.pdf')
const OUT_DIR   = resolve(ROOT, 'public', 'pages')
const SCALE     = 3.0   // sharp on retina displays
const QUALITY   = 0.95

const MIME = {
  '.html': 'text/html',
  '.js':   'text/javascript',
  '.mjs':  'text/javascript',
  '.css':  'text/css',
  '.pdf':  'application/pdf',
  '.json': 'application/json',
  '.map':  'application/json',
}

mkdirSync(OUT_DIR, { recursive: true })

function startServer() {
  return new Promise((resolvePromise) => {
    const server = createServer((req, res) => {
      try {
        const urlPath = decodeURIComponent((req.url || '/').split('?')[0])
        const filePath = join(ROOT, urlPath === '/' ? 'scripts/prerender.html' : urlPath.replace(/^\//, ''))
        if (!filePath.startsWith(ROOT) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
          res.writeHead(404)
          res.end('Not found')
          return
        }
        const type = MIME[extname(filePath)] || 'application/octet-stream'
        res.writeHead(200, {
          'Content-Type': type,
          'Access-Control-Allow-Origin': '*',
        })
        res.end(readFileSync(filePath))
      } catch (e) {
        res.writeHead(500)
        res.end(String(e))
      }
    })
    server.listen(0, '127.0.0.1', () => {
      resolvePromise({ server, port: server.address().port })
    })
  })
}

async function main() {
  console.log('📖  Starting local server…')
  const { server, port } = await startServer()
  const base = `http://127.0.0.1:${port}`

  console.log('📖  Launching Chromium…')
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()

  await page.goto(`${base}/scripts/prerender.html`, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__ready === true, { timeout: 60000 })

  console.log('📄  Loading PDF…')
  const total = await page.evaluate(async (pdfUrl) => {
    window.__pdf = await window.pdfjsLib.getDocument({ url: pdfUrl }).promise
    return window.__pdf.numPages
  }, `${base}/public/newtons-notebook.pdf`)

  console.log(`📄  ${total} pages — rendering at ${SCALE}x scale…\n`)

  for (let i = 1; i <= total; i++) {
    const dataUrl = await page.evaluate(async ({ pageNum, scale, quality }) => {
      const pdfPage  = await window.__pdf.getPage(pageNum)
      const viewport = pdfPage.getViewport({ scale })
      const canvas   = document.createElement('canvas')
      canvas.width   = Math.round(viewport.width)
      canvas.height  = Math.round(viewport.height)
      await pdfPage.render({
        canvasContext: canvas.getContext('2d'),
        viewport,
      }).promise
      return canvas.toDataURL('image/jpeg', quality)
    }, { pageNum: i, scale: SCALE, quality: QUALITY })

    const buffer  = Buffer.from(dataUrl.split(',')[1], 'base64')
    const outPath = resolve(OUT_DIR, `page-${String(i).padStart(4, '0')}.jpg`)
    writeFileSync(outPath, buffer)

    const bar = '█'.repeat(Math.round((i / total) * 30)).padEnd(30, '░')
    process.stdout.write(`\r  [${bar}] ${i}/${total}`)
  }

  writeFileSync(
    resolve(OUT_DIR, 'manifest.json'),
    JSON.stringify({ total, scale: SCALE }, null, 2)
  )

  await browser.close()
  server.close()
  console.log(`\n\n✅  Done! Images saved to public/pages/`)
  console.log(`   Refresh http://localhost:5173/ — no PDF rendering needed.`)
}

main().catch((e) => {
  console.error('\n❌', e)
  process.exit(1)
})
