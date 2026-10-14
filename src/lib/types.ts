/** Fields every Appwrite document carries. Domain document types extend this. */
export interface AppwriteDoc {
  $id: string
  /** Appwrite's monotonic row sequence (node-appwrite 22 `Models.Document`). */
  $sequence: number
  $createdAt: string
  $updatedAt: string
  $permissions: string[]
  $collectionId: string
  $databaseId: string
}

/** Every tenant-owned document carries `organizationId` (CLAUDE.md rule 4). */
export interface TenantDoc extends AppwriteDoc {
  organizationId: string
}

// ─── Platform level (DATA_MODEL.md) ───────────────────────────

/** `users` row. `$id` is the Appwrite Auth user id. */
export interface UserDoc extends AppwriteDoc {
  email: string
  fullName: string
  phone: string | null
  isSuperAdmin: boolean
}

export type OrganizationStatus = 'active' | 'suspended'

/** `organizations` row: the tenant. */
export interface OrganizationDoc extends AppwriteDoc {
  name: string
  slug: string
  logoUrl: string | null
  /** Serialized JSON; Appwrite has no JSON column type. */
  brandColors: string | null
  status: OrganizationStatus
  /** Per-organization commission override. Unit and default are OPEN_QUESTIONS #2. */
  commissionRate: number | null
}

export const MEMBERSHIP_ROLES = ['owner', 'admin', 'staff', 'designer', 'scanner'] as const
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number]

/** `memberships` row: a user's role inside one organization. */
export interface MembershipDoc extends TenantDoc {
  userId: string
  role: MembershipRole
}
