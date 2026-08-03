/**
 * One-time setup: creates Appwrite database + visitors collection.
 *
 * Usage (PowerShell):
 *   $env:APPWRITE_API_KEY="standard_..."
 *   $env:VITE_APPWRITE_ENDPOINT="https://nyc.cloud.appwrite.io/v1"
 *   $env:VITE_APPWRITE_PROJECT_ID="your_project_id"
 *   npm run setup:analytics
 *
 * Never commit the API key. Never put it in VITE_* vars.
 */
import { Client, Databases, Permission, Role, DatabasesIndexType, Project, PlatformType } from 'node-appwrite'

const endpoint = process.env.VITE_APPWRITE_ENDPOINT || process.env.APPWRITE_ENDPOINT || 'https://nyc.cloud.appwrite.io/v1'
const projectId = process.env.VITE_APPWRITE_PROJECT_ID || process.env.APPWRITE_PROJECT_ID
const apiKey = process.env.APPWRITE_API_KEY
const databaseId = process.env.VITE_APPWRITE_DATABASE_ID || 'newton_analytics'
const collectionId = process.env.VITE_APPWRITE_COLLECTION_VISITORS || 'visitors'

if (!projectId || !apiKey) {
  console.error('Missing APPWRITE_API_KEY and/or VITE_APPWRITE_PROJECT_ID')
  process.exit(1)
}

const client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey)
const databases = new Databases(client)
const project = new Project(client)

const anyWrite = [
  Permission.read(Role.any()),
  Permission.create(Role.any()),
  Permission.update(Role.any()),
]

async function ensureWebPlatforms() {
  const hosts = [
    'localhost',
    'newton.appwrite.network',
    '*.appwrite.network',
  ]
  let existing = []
  try {
    const list = await project.listPlatforms()
    existing = list.platforms || []
  } catch (err) {
    console.log('· Could not list platforms:', String(err?.message || err).slice(0, 120))
    return
  }

  for (const hostname of hosts) {
    const found = existing.find(
      (p) =>
        (p.type === PlatformType.Web || p.type === 'web') &&
        String(p.hostname || '').toLowerCase() === hostname.toLowerCase()
    )
    if (found) {
      console.log('· Platform exists:', hostname)
      continue
    }
    try {
      const platformId = 'web_' + hostname.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').slice(0, 32)
      await project.createWebPlatform({
        platformId,
        name: hostname,
        hostname,
      })
      console.log('✓ Added web platform:', hostname)
    } catch (err) {
      console.log('· Platform', hostname + ':', String(err?.message || err).slice(0, 120))
    }
  }
}

async function ensureDatabase() {
  try {
    await databases.get(databaseId)
    console.log('✓ Database exists:', databaseId)
  } catch {
    await databases.create(databaseId, 'Newton Analytics')
    console.log('✓ Created database:', databaseId)
  }
}

async function ensureCollection() {
  try {
    await databases.getCollection(databaseId, collectionId)
    console.log('✓ Collection exists:', collectionId)
    await databases.updateCollection(databaseId, collectionId, 'Visitors', anyWrite, false, true)
  } catch {
    await databases.createCollection(databaseId, collectionId, 'Visitors', anyWrite, false, true)
    console.log('✓ Created collection:', collectionId)
  }
}

async function ensureAttribute(createFn, label) {
  try {
    await createFn()
    console.log('  + attribute', label)
    await new Promise((r) => setTimeout(r, 800))
  } catch (err) {
    const msg = String(err?.message || err)
    if (/already exists|conflict/i.test(msg)) {
      console.log('  · attribute exists', label)
    } else {
      throw err
    }
  }
}

async function ensureAttributes() {
  await ensureAttribute(
    () => databases.createStringAttribute(databaseId, collectionId, 'visitorId', 64, true),
    'visitorId'
  )
  await ensureAttribute(
    () => databases.createStringAttribute(databaseId, collectionId, 'firstSeen', 40, true),
    'firstSeen'
  )
  await ensureAttribute(
    () => databases.createStringAttribute(databaseId, collectionId, 'lastSeen', 40, true),
    'lastSeen'
  )
  await ensureAttribute(
    () => databases.createIntegerAttribute(databaseId, collectionId, 'visits', true, 0),
    'visits'
  )

  for (const [key, size] of [
    ['country', 64],
    ['countryCode', 8],
    ['region', 64],
    ['city', 64],
    ['timezone', 64],
    ['language', 32],
    ['browser', 32],
    ['os', 32],
    ['device', 32],
    ['screen', 32],
    ['referrer', 512],
    ['path', 128],
    ['userAgent', 512],
  ]) {
    await ensureAttribute(
      () => databases.createStringAttribute(databaseId, collectionId, key, size, false),
      key
    )
  }
}

async function ensureIndexes() {
  try {
    await databases.createIndex(databaseId, collectionId, 'visitorId_unique', DatabasesIndexType.Unique, [
      'visitorId',
    ])
    console.log('✓ Unique index on visitorId')
  } catch (err) {
    console.log('· Index visitorId:', String(err?.message || err).slice(0, 120))
  }
  try {
    await databases.createIndex(databaseId, collectionId, 'lastSeen_desc', DatabasesIndexType.Key, [
      'lastSeen',
    ])
    console.log('✓ Index on lastSeen')
  } catch (err) {
    console.log('· Index lastSeen:', String(err?.message || err).slice(0, 120))
  }
}

async function main() {
  console.log('Setting up analytics on', endpoint, 'project', projectId)
  await ensureDatabase()
  await ensureCollection()
  console.log('Waiting for collection…')
  await new Promise((r) => setTimeout(r, 1500))
  await ensureAttributes()
  console.log('Waiting for attributes…')
  await new Promise((r) => setTimeout(r, 3000))
  await ensureIndexes()
  await ensureWebPlatforms()
  console.log('\nDone. Add these Site env vars if missing, then redeploy:')
  console.log('  VITE_APPWRITE_ENDPOINT=' + endpoint)
  console.log('  VITE_APPWRITE_PROJECT_ID=' + projectId)
  console.log('  VITE_APPWRITE_DATABASE_ID=' + databaseId)
  console.log('  VITE_APPWRITE_COLLECTION_VISITORS=' + collectionId)
  console.log('\nIn Appwrite → Sites → Settings → Environment variables (build-time).')
  console.log('Also confirm Overview → Platforms includes newton.appwrite.network.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
