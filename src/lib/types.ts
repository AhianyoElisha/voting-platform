/** Fields every Appwrite document carries. Domain document types extend this. */
export interface AppwriteDoc {
  $id: string
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
