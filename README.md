# AI Inpaint Tool MVP

Incremental TanStack Start + Prisma scaffold for an AI image inpainting workflow.

## Stack

- TanStack Start with React and TypeScript
- Prisma with SQLite for local development
- `POST /api/edit-jobs` intake that validates multipart uploads, stores uploaded assets in R2, creates jobs in Prisma, and attempts Trigger dispatch
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

- Homepage form submits multipart job intake to `POST /api/edit-jobs`
- The API requires `multipart/form-data` with `image`, `mask`, and optional `prompt`, `provider`, `model` fields
- Input is validated with Zod plus file checks for presence, MIME type, size, and matching image dimensions
- Source and mask uploads are written to Cloudflare R2 for real when R2 env vars are configured
- Valid jobs are persisted with Prisma after upload succeeds, and initial events are recorded
- `POST /api/edit-jobs` attempts a real Trigger.dev dispatch with the persisted `jobId`
- Job list and job detail pages read persisted state back from SQLite
- Worker code updates lifecycle state honestly and uploads real result bytes to R2 if the model call succeeds
- R2 helpers perform real signed PUT/GET requests when the required env is configured

What does not work yet:

- The exact Gemini image generation/inpainting call is still not implemented
- No WebSocket or SSE push updates

The app should fail explicitly for missing configuration or unimplemented integrations instead of pretending a job completed successfully.

## Notes

- `POST /api/edit-jobs` uploads source and mask assets first, then creates the database record, then dispatches Trigger.dev. If dispatch fails, the API returns a structured error response and includes the created job in the error details.
- Supported upload MIME types are `image/png`, `image/jpeg`, and `image/webp`, with a 20 MB limit per uploaded file.
- The Trigger task id used by the backend is `edit-image`.
- Result asset URLs come from `R2_PUBLIC_BASE_URL`, while R2 upload/download uses the S3-compatible endpoint derived from `R2_ACCOUNT_ID`.
- Local Prisma development defaults to SQLite via `prisma/dev.db`.
