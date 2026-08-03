import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw, Users, Eye, Globe2, MonitorSmartphone } from 'lucide-react'
import { client, getAppwriteConfigStatus } from '../lib/appwrite'
import { listVisitors } from '../lib/analytics'
import './Admin.css'

function formatWhen(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function relativeTime(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 48) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  return `${days}d ago`
}

function place(v) {
  const parts = [v.city, v.region, v.country].filter(Boolean)
  return parts.length ? parts.join(', ') : 'Unknown'
}

export default function Admin() {
  const config = getAppwriteConfigStatus()
  const [visitors, setVisitors] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastRefresh, setLastRefresh] = useState(null)
  const [live, setLive] = useState(false)

  const refresh = useCallback(async () => {
    if (!config.configured) {
      setLoading(false)
      setError('Appwrite env vars are missing. Set VITE_APPWRITE_PROJECT_ID (and endpoint) on the site, then redeploy.')
      return
    }
    try {
      const docs = await listVisitors(500)
      setVisitors(docs)
      setError('')
      setLastRefresh(new Date())
    } catch (err) {
      console.error(err)
      setError(
        err?.message ||
          'Could not load visitors. Run npm run setup:analytics once, and allow public read/create/update on the visitors collection.'
      )
    } finally {
      setLoading(false)
    }
  }, [config.configured])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 15000)
    return () => clearInterval(id)
  }, [refresh])

  useEffect(() => {
    if (!config.configured) return undefined
    const channel = `databases.${config.databaseId}.collections.${config.collectionId}.documents`
    try {
      const unsub = client.subscribe(channel, () => {
        setLive(true)
        refresh()
      })
      setLive(true)
      return () => {
        try { unsub() } catch (_) {}
      }
    } catch {
      setLive(false)
      return undefined
    }
  }, [config.configured, config.databaseId, config.collectionId, refresh])

  const stats = useMemo(() => {
    const unique = visitors.length
    const views = visitors.reduce((sum, v) => sum + Number(v.visits || 0), 0)
    const countries = new Map()
    const devices = new Map()
    for (const v of visitors) {
      const c = v.country || 'Unknown'
      countries.set(c, (countries.get(c) || 0) + 1)
      const d = v.device || 'Unknown'
      devices.set(d, (devices.get(d) || 0) + 1)
    }
    const topCountries = [...countries.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    const topDevices = [...devices.entries()].sort((a, b) => b[1] - a[1])
    return { unique, views, topCountries, topDevices }
  }, [visitors])

  return (
    <div className="admin">
      <header className="admin-top">
        <div>
          <div className="admin-kicker">Newton&apos;s Notebook</div>
          <h1 className="admin-title">Publication Analytics</h1>
          <p className="admin-sub">
            Unique devices · saved in Appwrite (survives redeploys)
            {live ? <span className="admin-live"> · Live</span> : null}
          </p>
        </div>
        <div className="admin-actions">
          <button type="button" className="admin-btn" onClick={refresh} disabled={loading}>
            <RefreshCw size={16} />
            Refresh
          </button>
          <Link className="admin-btn admin-btn--ghost" to="/">
            Open book
          </Link>
        </div>
      </header>

      {error && <div className="admin-banner">{error}</div>}

      <section className="admin-cards">
        <div className="admin-card">
          <Users size={18} />
          <div>
            <div className="admin-card__label">Unique visitors</div>
            <div className="admin-card__value">{stats.unique}</div>
          </div>
        </div>
        <div className="admin-card">
          <Eye size={18} />
          <div>
            <div className="admin-card__label">Total visits</div>
            <div className="admin-card__value">{stats.views}</div>
          </div>
        </div>
        <div className="admin-card">
          <Globe2 size={18} />
          <div>
            <div className="admin-card__label">Countries</div>
            <div className="admin-card__value">{stats.topCountries.length}</div>
          </div>
        </div>
        <div className="admin-card">
          <MonitorSmartphone size={18} />
          <div>
            <div className="admin-card__label">Last refresh</div>
            <div className="admin-card__value admin-card__value--sm">
              {lastRefresh ? relativeTime(lastRefresh.toISOString()) : '—'}
            </div>
          </div>
        </div>
      </section>

      <section className="admin-split">
        <div className="admin-panel">
          <h2>Where readers are from</h2>
          {stats.topCountries.length === 0 ? (
            <p className="admin-empty">No location data yet.</p>
          ) : (
            <ul className="admin-bars">
              {stats.topCountries.map(([name, count]) => (
                <li key={name}>
                  <div className="admin-bars__row">
                    <span>{name}</span>
                    <strong>{count}</strong>
                  </div>
                  <div className="admin-bars__track">
                    <div
                      className="admin-bars__fill"
                      style={{ width: `${Math.max(8, (count / stats.unique) * 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="admin-panel">
          <h2>Devices</h2>
          {stats.topDevices.length === 0 ? (
            <p className="admin-empty">No device data yet.</p>
          ) : (
            <ul className="admin-bars">
              {stats.topDevices.map(([name, count]) => (
                <li key={name}>
                  <div className="admin-bars__row">
                    <span>{name}</span>
                    <strong>{count}</strong>
                  </div>
                  <div className="admin-bars__track">
                    <div
                      className="admin-bars__fill"
                      style={{ width: `${Math.max(8, (count / stats.unique) * 100)}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="admin-panel admin-panel--table">
        <div className="admin-panel__head">
          <h2>Visitors</h2>
          <span className="admin-hint">Same device = 1 visitor (local ID). Auto-saves on each open.</span>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Location</th>
                <th>Device</th>
                <th>Browser</th>
                <th>Visits</th>
                <th>First seen</th>
                <th>Last seen</th>
                <th>Path</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={7}>Loading…</td>
                </tr>
              )}
              {!loading && visitors.length === 0 && (
                <tr>
                  <td colSpan={7}>No visitors recorded yet. Open the public book once to seed data.</td>
                </tr>
              )}
              {visitors.map((v) => (
                <tr key={v.$id}>
                  <td>
                    <div className="admin-loc">
                      <strong>{place(v)}</strong>
                      <span>{v.timezone || v.language || ''}</span>
                    </div>
                  </td>
                  <td>
                    {v.device || '—'}
                    <div className="admin-muted">{v.os || ''}</div>
                  </td>
                  <td>{v.browser || '—'}</td>
                  <td>{v.visits || 1}</td>
                  <td>{formatWhen(v.firstSeen)}</td>
                  <td>
                    {formatWhen(v.lastSeen)}
                    <div className="admin-muted">{relativeTime(v.lastSeen)}</div>
                  </td>
                  <td className="admin-mono">{v.path || '/'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="admin-foot">
        Project {config.projectId || 'unset'} · DB {config.databaseId} · Collection {config.collectionId}
        {' · '}Not password-protected yet
      </footer>
    </div>
  )
}
