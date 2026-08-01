/**
 * Patches page-flip for:
 * 1. Dark canvas clear (no white bar)
 * 2. Retina / DPR-aware canvas (sharp pages, mouse coords stay correct)
 */
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const files = [
  'node_modules/page-flip/dist/js/page-flip.module.js',
  'node_modules/page-flip/dist/js/page-flip.browser.js',
]

const OLD_RESIZE =
  'resizeCanvas(){const t=getComputedStyle(this.canvas),e=parseInt(t.getPropertyValue("width"),10),i=parseInt(t.getPropertyValue("height"),10);this.canvas.width=e,this.canvas.height=i}'

const NEW_RESIZE =
  'resizeCanvas(){const t=getComputedStyle(this.canvas),e=parseInt(t.getPropertyValue("width"),10),i=parseInt(t.getPropertyValue("height"),10),r=Math.min(window.devicePixelRatio||1,2);this.canvas.width=Math.max(1,Math.round(e*r)),this.canvas.height=Math.max(1,Math.round(i*r)),this.canvas.style.width=e+"px",this.canvas.style.height=i+"px",this.canvas.getContext("2d").setTransform(r,0,0,r,0,0)}'

// Clear in device pixels so DPR transform doesn't break the wipe
const OLD_CLEAR =
  'fillRect(0,0,this.canvas.width,this.canvas.height)'
const NEW_CLEAR =
  'save(),this.ctx.setTransform(1,0,0,1,0,0),this.ctx.fillRect(0,0,this.canvas.width,this.canvas.height),this.ctx.restore('

for (const rel of files) {
  const p = resolve(root, rel)
  if (!existsSync(p)) continue
  let s = readFileSync(p, 'utf8')

  // Dark paper instead of white
  s = s.replaceAll('fillStyle="white"', 'fillStyle="#0f0d0a"')
  s = s.replaceAll('fillStyle="rgb(255, 255, 255)"', 'fillStyle="#0f0d0a"')

  if (s.includes(OLD_RESIZE)) {
    s = s.replaceAll(OLD_RESIZE, NEW_RESIZE)
    console.log('patched resizeCanvas in', rel)
  } else if (s.includes('Math.min(window.devicePixelRatio')) {
    console.log('resizeCanvas already patched in', rel)
  } else {
    console.warn('WARN: resizeCanvas pattern not found in', rel)
  }

  // Only replace the clear() fillRect (unique enough with canvas.width,canvas.height)
  if (s.includes('this.ctx.fillStyle="#0f0d0a",this.ctx.fillRect(0,0,this.canvas.width,this.canvas.height)')) {
    s = s.replace(
      'this.ctx.fillStyle="#0f0d0a",this.ctx.fillRect(0,0,this.canvas.width,this.canvas.height)',
      'this.ctx.fillStyle="#0f0d0a",this.ctx.save(),this.ctx.setTransform(1,0,0,1,0,0),this.ctx.fillRect(0,0,this.canvas.width,this.canvas.height),this.ctx.restore()'
    )
    console.log('patched clear() in', rel)
  } else if (s.includes('this.ctx.fillStyle="white",this.ctx.fillRect(0,0,this.canvas.width,this.canvas.height)')) {
    s = s.replace(
      'this.ctx.fillStyle="white",this.ctx.fillRect(0,0,this.canvas.width,this.canvas.height)',
      'this.ctx.fillStyle="#0f0d0a",this.ctx.save(),this.ctx.setTransform(1,0,0,1,0,0),this.ctx.fillRect(0,0,this.canvas.width,this.canvas.height),this.ctx.restore()'
    )
    console.log('patched clear() in', rel)
  } else if (s.includes('setTransform(1,0,0,1,0,0),this.ctx.fillRect(0,0,this.canvas.width')) {
    console.log('clear() already patched in', rel)
  } else {
    console.warn('WARN: clear() pattern not found in', rel)
  }

  writeFileSync(p, s)
}
