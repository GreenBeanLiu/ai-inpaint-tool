# TODO - ai-inpaint-tool

## Project snapshot

This project is already a solid MVP for **real intake + real storage + real job orchestration**:

- multipart upload intake works
- source/mask validation exists
- files upload to Cloudflare R2
- jobs persist in Prisma/Postgres
- Trigger.dev dispatch exists
- job list/detail pages exist
- worker lifecycle updates exist

The biggest current gap is simple:

**the product is called an inpaint tool, but the actual masked inpainting generation path is not implemented yet.**

So the next phase should focus on turning this from an honest backend scaffold into a usable product.

---

## Priority 1 - Make the core promise true

### 1. Choose and implement a real masked inpainting provider
- [ ] Confirm whether Gemini now supports explicit binary-mask inpainting on the API path you are using
- [ ] If not, choose a provider that does support real mask-based inpainting
  - [ ] OpenAI image editing
  - [ ] Replicate model with mask input
  - [ ] Stability / other diffusion API
- [ ] Introduce a provider adapter layer instead of hardcoding Gemini-only logic
- [ ] Support provider selection in backend config
- [ ] Keep honest failure behavior for unsupported providers/models

### 2. Split “image editing” from “mask-based inpainting” in code and UI
- [ ] Rename ambiguous code paths so “edit” and “inpaint” are not conflated
- [ ] Make job type explicit in the data model if needed
  - [ ] `edit`
  - [ ] `inpaint`
- [ ] Update README to clearly describe supported vs unsupported modes
- [ ] Update UI copy so users know whether they are doing general image edit or true masked inpaint

### 3. Add one successful end-to-end provider path
- [ ] Ensure one provider can complete this flow successfully:
  - [ ] upload source image
  - [ ] upload mask image
  - [ ] create job
  - [ ] run worker
  - [ ] produce result image
  - [ ] upload result to R2
  - [ ] mark job succeeded
- [ ] Add clear provider-specific error messages for common failures
  - [ ] invalid API key
  - [ ] unsupported model
  - [ ] bad image format
  - [ ] mask rejected
  - [ ] quota / rate limit

---

## Priority 2 - Improve product usability

### 4. Add image previews everywhere
- [x] Show source image preview on the home page before submit
- [x] Show mask preview on the home page before submit
- [x] Show source, mask, and result previews on the job detail page
- [x] Display image dimensions and file size in a friendlier way
- [x] Add empty/error states for broken image URLs

### 5. Make job status updates feel alive
- [x] Add polling on the detail page as the first step
- [x] Auto-refresh when job is `queued` or `processing`
- [x] Stop refreshing once job is `succeeded` or `failed`
- [ ] Later, add SSE or WebSocket push updates
- [x] Surface lifecycle events in a more readable timeline UI

### 6. Improve form UX
- [x] Disable submit when source/mask are missing
- [x] Add inline validation messages before submit
- [x] Warn when source and mask dimensions do not match if detectable client-side
- [ ] Add provider/model selectors only when multiple providers are truly supported
- [ ] Add drag-and-drop upload support
- [x] Add prompt examples for common inpainting tasks

---

## Priority 3 - Make the backend production-friendly

### 7. Strengthen job lifecycle and retry handling
- [ ] Add retry support for transient worker failures
- [ ] Distinguish retryable vs non-retryable errors
- [ ] Store provider request ids consistently
- [ ] Track attempt count per job
- [ ] Prevent duplicate processing for the same job/run when possible

### 8. Improve data model quality
- [ ] Consider storing original filenames
- [ ] Store mask MIME type separately
- [ ] Store result width/height if different from source
- [ ] Add indexes for common queries
  - [ ] status
  - [ ] createdAt
- [ ] Consider adding a dedicated provider metadata JSON field

### 9. Clean up persistence strategy
- [ ] Verify dev vs prod database setup is documented correctly
- [ ] Use Prisma migrations consistently instead of only `prisma db push`
- [ ] Add seed/dev fixtures if helpful
- [ ] Document local development with PostgreSQL clearly

### 10. Improve storage hygiene
- [ ] Decide cleanup policy for failed jobs
- [ ] Decide cleanup policy for old source/mask/result assets
- [ ] Add safer naming conventions or per-job directory layout in R2
- [ ] Add content-length / content-type verification after upload if needed
- [ ] Consider signed/private asset delivery instead of public URLs if privacy matters

---

## Priority 4 - Strengthen architecture

### 11. Refactor provider logic behind a stable interface
- [ ] Introduce something like `ImageEditProvider`
- [ ] Implement `GeminiImageProvider` separately
- [ ] Add `supportsMaskInpainting()` capability checks
- [ ] Move provider selection out of the worker body
- [ ] Keep route, worker, and provider responsibilities clearly separated

### 12. Tighten environment/config validation
- [ ] Validate env at app startup instead of only at call sites where useful
- [ ] Group env by subsystem
  - [ ] database
  - [ ] R2
  - [ ] Trigger.dev
  - [ ] providers
- [ ] Add clearer startup diagnostics for missing env
- [ ] Document minimal env for local UI-only testing vs full pipeline testing

### 13. Improve error taxonomy
- [ ] Standardize app/internal/provider/config/input error shapes
- [ ] Ensure API errors and worker errors share useful codes
- [ ] Make UI show actionable messages instead of raw internal failure text when appropriate
- [ ] Add correlation/request ids where possible

---

## Priority 5 - Testing and reliability

### 14. Add automated tests for critical paths
- [ ] Validation tests for multipart intake
- [ ] Tests for source/mask dimension mismatch
- [ ] Tests for repository create/update/get/list flows
- [ ] Tests for R2 helper error handling
- [ ] Tests for provider response parsing
- [ ] Tests for worker failure and success lifecycle transitions

### 15. Add manual QA checklist
- [ ] valid PNG source + valid PNG mask
- [ ] JPEG source + PNG mask
- [ ] mismatched image dimensions
- [ ] unsupported MIME type
- [ ] oversized file
- [ ] missing env vars
- [ ] Trigger dispatch failure
- [ ] provider failure
- [ ] R2 upload failure

### 16. Add observability basics
- [ ] Add structured logs around API intake
- [ ] Add structured logs around Trigger dispatch
- [ ] Add structured logs around provider calls
- [ ] Log duration for upload/download/provider steps
- [ ] Make it easy to inspect a job end-to-end by job id

---

## Priority 6 - Nice follow-up features

### 17. Better editor workflow
- [ ] Add a lightweight browser-side mask drawing tool instead of requiring a separate mask file
- [ ] Allow users to paint, erase, and preview mask overlays
- [ ] Add prompt history or recent prompts
- [ ] Support re-running a failed job
- [ ] Support “use result as new source” iteration

### 18. Result management
- [ ] Add download result button
- [ ] Add copy result URL button
- [ ] Add before/after compare slider
- [ ] Add result gallery view for recent jobs

### 19. Multi-provider experimentation
- [ ] Let a job target different providers/models intentionally
- [ ] Compare outputs across providers
- [ ] Store cost/latency metadata if available

---

## Suggested implementation order

### Phase A - make it actually useful
- [ ] Pick one provider with real mask inpainting support
- [ ] Implement provider adapter
- [ ] Complete one end-to-end successful inpaint flow
- [ ] Update README and UI copy

### Phase B - make it nicer to use
- [ ] Add image previews
- [ ] Add auto-refresh on job detail page
- [ ] Improve form validation and status messaging

### Phase C - make it robust
- [ ] Add tests
- [ ] Add retries and better error handling
- [ ] Improve env/config validation
- [ ] Improve storage and lifecycle hygiene

---

## My blunt take

If you want the highest-value next move, do **not** start with polishing the UI.

The most important next step is:

**replace or augment the Gemini worker path with one provider that can truly do masked inpainting end-to-end.**

Once that works, everything else becomes worth polishing.
