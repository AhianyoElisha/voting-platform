# Appwrite Functions

One folder per function, Node 22 runtime, registered in `appwrite.config.json` and deployed with `appwrite push functions` (same layout as pickLT's `functions/`).

Functions own the **writes that must be atomic or must never run in the browser**: confirming a payment and creating its vote or ticket in one transaction, granting free votes with their audit entry, rendering flyers, reconciling stale payments on a schedule. Reads and auth stay in Next.js route handlers. See `docs/ARCHITECTURE.md`, "Reads vs writes".

Nothing here yet. The first functions arrive with the payment and voting features.
