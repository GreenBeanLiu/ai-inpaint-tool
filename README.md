# AI Inpaint Tool MVP

Incremental TanStack Start + Prisma scaffold for an AI image inpainting workflow.

## Stack

- TanStack Start with React and TypeScript
- Prisma with SQLite for local development
- Local `POST /api/edit-jobs` intake that validates input and stores queued jobs
- Placeholder server modules for R2 storage, Gemini image editing, Trigger orchestration, and realtime notifications

## Setup

1. Copy `.env.example` to `.env`.
2. Install dependencies with `npm install`.
3. Generate Prisma client with `npm run prisma:generate`.
4. Create the local database schema with `npm run prisma:push`.
5. Start the app with `npm run dev`.

## Required Environment

For the current local MVP loop, only one environment variable is required:

```dotenv
DATABASE_URL="file:./dev.db"
```

This resolves to `prisma/dev.db` because the Prisma schema lives in `prisma/schema.prisma`.

Optional variables already reserved in `.env.example`:

- `APP_BASE_URL` for future absolute URL generation
- `R2_*` for Cloudflare R2 storage
- `GOOGLE_GENERATIVE_AI_API_KEY` and `GOOGLE_IMAGE_MODEL` for Gemini image editing
- `TRIGGER_SECRET_KEY` and `TRIGGER_API_URL` for background job orchestration
- `JOB_EVENTS_WS_URL` for future realtime job updates

## Current MVP Loop

What works now:

- Homepage form submits job intake to `POST /api/edit-jobs`
- The API accepts `application/json`, `application/x-www-form-urlencoded`, or `multipart/form-data`
- Input is validated with Zod
- Valid jobs are persisted with Prisma and initial events are recorded
- Job list and job detail pages read persisted state back from SQLite

What does not work yet:

- No local image upload flow yet, only URL-based metadata intake
- No Trigger dispatch after job creation
- No Gemini image generation or editing call
- No Cloudflare R2 upload for result assets
- No WebSocket or SSE push updates

The app should fail explicitly for missing configuration or unimplemented integrations instead of pretending a job completed successfully.

## Notes

- `POST /api/edit-jobs` creates a real queued database record, but worker dispatch is still intentionally skipped.
- Local Prisma development defaults to SQLite via `prisma/dev.db`.
