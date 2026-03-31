# AI Inpaint Tool MVP

Incremental TanStack Start + Prisma scaffold for an AI image inpainting workflow.

## Stack

- TanStack Start with React and TypeScript
- Prisma with SQLite for local development
- `POST /api/edit-jobs` intake that validates input, stores jobs in Prisma, and attempts Trigger dispatch
- Real Cloudflare R2 S3-compatible upload/download helpers with explicit configuration failures
- Honest Gemini/worker scaffolding that fails clearly until the exact edit call is implemented

## Setup

1. Copy `.env.example` to `.env`.
2. Install dependencies with `npm install`.
3. Generate Prisma client with `npm run prisma:generate`.
4. Create the local database schema with `npm run prisma:push`.
5. Start the app with `npm run dev`.

## Required Environment

Database:

```dotenv
DATABASE_URL="file:./dev.db"
```

This resolves to `prisma/dev.db` because the Prisma schema lives in `prisma/schema.prisma`.

Cloudflare R2 upload/download and public result URLs:

```dotenv
R2_ACCOUNT_ID=""
R2_ACCESS_KEY_ID=""
R2_SECRET_ACCESS_KEY=""
R2_BUCKET_NAME=""
R2_PUBLIC_BASE_URL=""
```

Trigger.dev dispatch from `POST /api/edit-jobs`:

```dotenv
TRIGGER_API_URL="https://api.trigger.dev"
TRIGGER_SECRET_KEY=""
```

Gemini image editing worker:

```dotenv
GOOGLE_GENERATIVE_AI_API_KEY=""
GOOGLE_IMAGE_MODEL="gemini-3.1-flash-image"
```

Optional:

- `APP_BASE_URL` for future absolute URL generation
- `JOB_EVENTS_WS_URL` for future realtime job updates

## Current MVP Loop

What works now:

- Homepage form submits job intake to `POST /api/edit-jobs`
- The API accepts `application/json`, `application/x-www-form-urlencoded`, or `multipart/form-data`
- Input is validated with Zod
- Valid jobs are persisted with Prisma and initial events are recorded
- `POST /api/edit-jobs` attempts a real Trigger.dev dispatch and reports structured dispatch success or failure in the response body
- Job list and job detail pages read persisted state back from SQLite
- Worker code updates lifecycle state honestly and uploads real result bytes to R2 if the model call succeeds
- R2 helpers perform real signed PUT/GET requests when the required env is configured

What does not work yet:

- No local image upload flow yet, only URL-based metadata intake
- The exact Gemini image generation/inpainting call is still not implemented
- No WebSocket or SSE push updates

The app should fail explicitly for missing configuration or unimplemented integrations instead of pretending a job completed successfully.

## Notes

- `POST /api/edit-jobs` always creates the database record first. If Trigger dispatch fails, the response still reports the created job plus a structured dispatch failure instead of a fake success.
- The Trigger task id used by the backend is `edit-image`.
- Result asset URLs come from `R2_PUBLIC_BASE_URL`, while R2 upload/download uses the S3-compatible endpoint derived from `R2_ACCOUNT_ID`.
- Local Prisma development defaults to SQLite via `prisma/dev.db`.
