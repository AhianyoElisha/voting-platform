# voteapp (working name)

Multi-tenant paid voting platform for award shows and pageants, launching at KNUST, with a built-in flyer engine. Product and architecture docs live in `docs/`; start with `CLAUDE.md`.

The stack, folder layout, UI kit, icons and fonts mirror the pickLT project (see `docs/ARCHITECTURE.md`): Next.js 15, React 19, Tailwind CSS 4, Headless UI, Heroicons and Hugeicons, Poppins, and Appwrite for auth, database, storage, functions and realtime.

## Getting started

```bash
cp .env.example .env.local   # then fill in the Appwrite project and a SESSION_SECRET
npm install
npm run dev                  # http://localhost:3000
```

```bash
npm run build   # production build
npm run lint    # next lint
npm test        # vitest, src/**/__tests__/**/*.test.ts
```

Appwrite schema and functions are managed with the Appwrite CLI against `appwrite.config.json`.
