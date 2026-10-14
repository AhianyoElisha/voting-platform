# Appwrite Functions

One folder per function, Node 22 runtime, registered in `appwrite.config.json` and deployed with `appwrite push functions` (same layout as pickLT's `functions/`). The database schema lives in the same file under `tablesDB` and `tables` and is pushed with `appwrite push tables`; buckets with `appwrite push buckets`.

No function exists yet, and none is needed for what is built: the atomic writes (payment confirmation with its vote or ticket, round closure, scanning) run in Appwrite database transactions from server-only route handlers, which `docs/ARCHITECTURE.md` ("Reads vs writes") allows. The scheduled job, payment reconciliation, is a Vercel cron (`vercel.json`).

A function becomes worth adding when a job outgrows a request: long flyer batches for big events, or a reconciliation that must run off Vercel. Build it behind the same `src/lib` entry point (`ensureFlyer`, `reconcilePendingPayments`) so nothing else changes.
