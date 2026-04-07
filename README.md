# AI Inpaint Tool MVP

Incremental TanStack Start + Prisma scaffold for an AI image inpainting workflow.

## Stack

- TanStack Start with React and TypeScript
- Prisma with PostgreSQL
- `POST /api/edit-jobs` intake that validates multipart uploads, stores uploaded assets in R2, creates jobs in Prisma, and attempts Trigger dispatch
- Real Cloudflare R2 S3-compatible upload/download helpers with explicit configuration failures
- Real Trigger task project shape plus a provider-adapter worker path that currently defaults to Gemini and fails clearly when exact masked inpainting is unsupported

## Setup

1. Copy `.env.example` to `.env`.
2. Install dependencies with `npm install`.
3. Generate Prisma client with `npm run prisma:generate`.
4. Create the database schema with `npm run prisma:push`.
5. Start the app with `npm run dev`.
6. In a separate shell, start the Trigger worker with `npm run trigger:dev`.

## Required Environment

Database:

```dotenv
DATABASE_URL="postgresql://user:password@host:5432/database"
```

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
TRIGGER_PROJECT_REF=""
TRIGGER_SECRET_KEY=""
```

Gemini image editing worker (default wired provider):

```dotenv
GOOGLE_GENERATIVE_AI_API_KEY=""
GOOGLE_IMAGE_MODEL="gemini-3.1-flash-image"
```

Optional future provider slots:

```dotenv
OPENAI_API_KEY=""
OPENAI_IMAGE_MODEL="gpt-image-1"
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
- The repo now has a real Trigger.dev project layout via [trigger.config.ts](/Users/lijie/Works/ai-inpaint-tool/trigger.config.ts) and [trigger/edit-image.ts](/Users/lijie/Works/ai-inpaint-tool/trigger/edit-image.ts)
- Job list and job detail pages read persisted state back from Postgres
- Worker code updates lifecycle state honestly, downloads source and mask assets, and uploads real result bytes to R2 if the model call succeeds
- R2 helpers perform real signed PUT/GET requests when the required env is configured

What does not work yet:

- The worker now resolves providers through an adapter layer, but the default Gemini implementation still does not expose a separate binary mask input for exact inpainting semantics, so masked jobs fail with an explicit worker error instead of producing a fake or mask-ignoring output
- A future OpenAI provider slot is wired as a placeholder so a real mask-capable integration can be added without reworking the job runner again
- No WebSocket or SSE push updates

The app should fail explicitly for missing configuration or unimplemented integrations instead of pretending a job completed successfully.

## Notes

- `POST /api/edit-jobs` uploads source and mask assets first, then creates the database record, then dispatches Trigger.dev. If dispatch fails, the API returns a structured error response and includes the created job in the error details.
- Supported upload MIME types are `image/png`, `image/jpeg`, and `image/webp`, with a 20 MB limit per uploaded file.
- The Trigger task id used by the backend is `edit-image`, and the registered worker queue name is `edit-jobs`.
- Result asset URLs come from `R2_PUBLIC_BASE_URL`, while R2 upload/download uses the S3-compatible endpoint derived from `R2_ACCOUNT_ID`.
- Google’s current Gemini image docs describe text+image editing and image output, but not exact binary-mask inpainting on the API-key path. The worker preserves honest failure semantics until that path exists or a different provider/model path is configured.
