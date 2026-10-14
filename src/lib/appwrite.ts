import { Client, Account, Databases, Functions, Storage } from 'appwrite'

// ─── Appwrite Client SDK (for browser / client-side) ───
// Defaults keep `next build` working without a .env.local (the SDK throws on an
// empty endpoint at import time); a real project ID is still required to sign in.
const client = new Client()
  .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT || 'https://fra.cloud.appwrite.io/v1')
  .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID || '')

export const account = new Account(client)
export const databases = new Databases(client)
export const storage = new Storage(client)
// Cloud-function executions from the browser (e.g. `googleauth`, which is
// executable by guests so the Google sign-in path can mint a session).
export const functions = new Functions(client)

export { client }
