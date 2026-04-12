# AI Inpaint Tool MVP

Incremental TanStack Start + Prisma scaffold for an AI image inpainting workflow.

## Stack

- TanStack Start with React and TypeScript
- Prisma with PostgreSQL
- `POST /api/edit-jobs` intake that validates multipart uploads, stores uploaded assets in R2, creates jobs in Prisma, and attempts Trigger dispatch
- Real Cloudflare R2 S3-compatible upload/download helpers with explicit configuration failures
- Real Trigger task project shape plus a provider-adapter worker path with real OpenRouter and OpenAI masked image edit integrations

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

OpenRouter image editing worker (default wired provider):

```dotenv
OPENROUTER_API_KEY=""
OPENROUTER_IMAGE_MODEL="openai/gpt-5-image-mini"
```

Optional direct OpenAI provider slot:

```dotenv
OPENAI_API_KEY=""
OPENAI_IMAGE_MODEL="gpt-image-1.5"
```

Optional Gemini provider slot:

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
- The default masked inpainting path now targets OpenRouter with provider/model defaults of `openrouter` and `openai/gpt-5-image-mini`
- For OpenRouter masked edits, the API accepts PNG, JPEG, or WEBP source uploads and requires a PNG or WEBP mask upload because the adapter sends both images through OpenRouter chat-completions image inputs instead of a dedicated binary mask field
- For direct OpenAI masked edits, the API still rejects uploads unless source and mask share the same MIME type and both are PNG or WEBP
- Source and mask uploads are written to Cloudflare R2 for real when R2 env vars are configured
- Valid jobs are persisted with Prisma after upload succeeds, and initial events are recorded
- `POST /api/edit-jobs` attempts a real Trigger.dev dispatch with the persisted `jobId`
- The repo now has a real Trigger.dev project layout via [trigger.config.ts](/Users/lijie/Works/ai-inpaint-tool/trigger.config.ts) and [trigger/edit-image.ts](/Users/lijie/Works/ai-inpaint-tool/trigger/edit-image.ts)
- Job list and job detail pages read persisted state back from Postgres
- Worker code updates lifecycle state honestly, downloads source and mask assets, calls the selected provider adapter, and uploads real result bytes to R2 if the model call succeeds
- R2 helpers perform real signed PUT/GET requests when the required env is configured

What does not work yet:

- The Gemini implementation is still wired as a non-mask-capable provider slot, so masked submissions that explicitly target `provider=google` fail immediately instead of queueing a job that cannot succeed
- The OpenRouter provider uses the documented `/api/v1/chat/completions` multimodal image path, not a dedicated mask-upload endpoint. That means the second uploaded image is sent as a mask reference image with prompt instructions to preserve unmasked regions, so exact binary-mask semantics still depend on the routed model
- The current OpenAI worker does not transcode uploads. If the mask format is incompatible with OpenAI’s mask requirements, the API or provider preflight will fail explicitly rather than rewriting the files
- No WebSocket or SSE push updates

The app should fail explicitly for missing configuration or unimplemented integrations instead of pretending a job completed successfully.

## Notes

- `POST /api/edit-jobs` uploads source and mask assets first, then creates the database record, then dispatches Trigger.dev. If dispatch fails, the API returns a structured error response and includes the created job in the error details.
- Supported upload MIME types are `image/png`, `image/jpeg`, and `image/webp`, with a 20 MB limit per uploaded file.
- The Trigger task id used by the backend is `edit-image`, and the registered worker queue name is `edit-jobs`.
- Result asset URLs come from `R2_PUBLIC_BASE_URL`, while R2 upload/download uses the S3-compatible endpoint derived from `R2_ACCOUNT_ID`.
- OpenRouter’s current image generation docs route image editing through `POST /api/v1/chat/completions` with multimodal `messages` and `modalities` that include `image`. This repo uses that path for `provider=openrouter`, sending the source image and mask image as separate inputs and surfacing upstream failures instead of fabricating a result.
- OpenAI’s current image editing docs show masked edits on `POST /v1/images/edits` with the source image, a separate mask, and a prompt. This repo preserves that path for `provider=openai`.
- Google’s current Gemini image docs describe text+image editing and image output, but not exact binary-mask inpainting on the API-key path used here. The repo preserves honest failure semantics for that provider until that path exists.
