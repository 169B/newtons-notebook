import { Client, Databases, Account } from 'appwrite'

const endpoint = import.meta.env.VITE_APPWRITE_ENDPOINT || 'https://nyc.cloud.appwrite.io/v1'
const projectId = import.meta.env.VITE_APPWRITE_PROJECT_ID || ''

export const DATABASE_ID = import.meta.env.VITE_APPWRITE_DATABASE_ID || 'newton_analytics'
export const VISITORS_COLLECTION_ID =
  import.meta.env.VITE_APPWRITE_COLLECTION_VISITORS || 'visitors'

export const appwriteConfigured = Boolean(endpoint && projectId)

export const client = new Client().setEndpoint(endpoint).setProject(projectId)

export const databases = new Databases(client)
export const account = new Account(client)

export function getAppwriteConfigStatus() {
  return {
    endpoint,
    projectId: projectId || null,
    databaseId: DATABASE_ID,
    collectionId: VISITORS_COLLECTION_ID,
    configured: appwriteConfigured,
  }
}
