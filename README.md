# AI Inpaint Tool MVP

Initial TanStack Start + Prisma scaffold for an AI image inpainting workflow.

## Stack

- TanStack Start with React and TypeScript
- Prisma with SQLite for local development
- Placeholder server modules for R2 storage, Gemini image editing, and job notifications

## Setup

1. Copy `.env.example` to `.env`.
2. Install dependencies with `npm install`.
3. Generate Prisma client with `npm run prisma:generate`.
4. Create the local database schema with `npm run prisma:push`.
5. Start the app with `npm run dev`.

## Notes

- The API scaffold creates and reads edit jobs, but external storage/model integrations intentionally throw explicit `Not implemented` errors until wired up.
- Local Prisma development defaults to SQLite via `prisma/dev.db`.
