import { ID, Query } from 'appwrite'
import {
  databases,
  DATABASE_ID,
  VISITORS_COLLECTION_ID,
  appwriteConfigured,
} from './appwrite'

const VISITOR_KEY = 'nn_visitor_id'

export function getVisitorId() {
  try {
    let id = localStorage.getItem(VISITOR_KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(VISITOR_KEY, id)
    }
    return id
  } catch {
    return crypto.randomUUID()
  }
}

function detectBrowser(ua) {
  if (/Edg\//.test(ua)) return 'Edge'
  if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) return 'Chrome'
  if (/Firefox\//.test(ua)) return 'Firefox'
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return 'Safari'
  if (/OPR\//.test(ua)) return 'Opera'
  return 'Other'
}

function detectOS(ua) {
  if (/Windows NT/i.test(ua)) return 'Windows'
  if (/Mac OS X/i.test(ua)) return 'macOS'
  if (/Android/i.test(ua)) return 'Android'
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS'
  if (/Linux/i.test(ua)) return 'Linux'
  return 'Other'
}

function detectDevice(ua) {
  if (/iPad|Tablet/i.test(ua)) return 'Tablet'
  if (/Mobi|Android.*Mobile|iPhone/i.test(ua)) return 'Mobile'
  return 'Desktop'
}

async function fetchGeo() {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 4000)
    const res = await fetch('https://ipwho.is/', { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) return {}
    const data = await res.json()
    if (!data?.success) return {}
    return {
      country: String(data.country || '').slice(0, 64),
      countryCode: String(data.country_code || '').slice(0, 8),
      region: String(data.region || '').slice(0, 64),
      city: String(data.city || '').slice(0, 64),
      timezone: String(data.timezone?.id || data.timezone || '').slice(0, 64),
    }
  } catch {
    return {}
  }
}

function clientMeta() {
  const ua = navigator.userAgent || ''
  return {
    userAgent: ua.slice(0, 512),
    browser: detectBrowser(ua),
    os: detectOS(ua),
    device: detectDevice(ua),
    language: (navigator.language || '').slice(0, 32),
    screen: `${window.screen?.width || 0}x${window.screen?.height || 0}`,
    referrer: (document.referrer || '').slice(0, 512),
    path: (window.location.pathname || '/').slice(0, 128),
  }
}

/** Prevents React StrictMode double-mount from counting twice in one page load. */
let trackInFlight = false

/**
 * Record a unique-device visit. Same browser keeps the same visitorId in localStorage,
 * so refreshes / revisits increment visits instead of creating a new visitor.
 * Data lives in Appwrite Databases — survives site redeploys/pushes.
 */
export async function trackVisit() {
  if (!appwriteConfigured) {
    console.warn('[analytics] Appwrite is not configured — skipping visit track')
    return { ok: false, reason: 'not_configured' }
  }

  // Don't inflate counts when viewing the admin dashboard
  if (window.location.pathname.startsWith('/admin')) {
    return { ok: false, reason: 'admin' }
  }

  if (trackInFlight) {
    return { ok: false, reason: 'inflight' }
  }
  trackInFlight = true

  const visitorId = getVisitorId()
  const now = new Date().toISOString()
  const meta = clientMeta()
  const geo = await fetchGeo()

  try {
    const existing = await databases.listDocuments(DATABASE_ID, VISITORS_COLLECTION_ID, [
      Query.equal('visitorId', visitorId),
      Query.limit(1),
    ])

    if (existing.total > 0) {
      const doc = existing.documents[0]
      await databases.updateDocument(DATABASE_ID, VISITORS_COLLECTION_ID, doc.$id, {
        lastSeen: now,
        visits: Number(doc.visits || 0) + 1,
        ...meta,
        // Keep first geo if we already have it; fill blanks / refresh location
        country: geo.country || doc.country || '',
        countryCode: geo.countryCode || doc.countryCode || '',
        region: geo.region || doc.region || '',
        city: geo.city || doc.city || '',
        timezone: geo.timezone || doc.timezone || meta.timezone || '',
      })
      return { ok: true, visitorId, updated: true }
    }

    await databases.createDocument(DATABASE_ID, VISITORS_COLLECTION_ID, ID.unique(), {
      visitorId,
      firstSeen: now,
      lastSeen: now,
      visits: 1,
      country: geo.country || '',
      countryCode: geo.countryCode || '',
      region: geo.region || '',
      city: geo.city || '',
      timezone: geo.timezone || '',
      ...meta,
    })
    return { ok: true, visitorId, created: true }
  } catch (err) {
    trackInFlight = false
    console.error('[analytics] trackVisit failed', err)
    return { ok: false, reason: 'error', error: err }
  }
}

export async function listVisitors(limit = 500) {
  const pageSize = Math.min(100, limit)
  let offset = 0
  const all = []

  while (all.length < limit) {
    const page = await databases.listDocuments(DATABASE_ID, VISITORS_COLLECTION_ID, [
      Query.orderDesc('lastSeen'),
      Query.limit(pageSize),
      Query.offset(offset),
    ])
    all.push(...page.documents)
    if (page.documents.length < pageSize) break
    offset += page.documents.length
  }

  return all.slice(0, limit)
}
