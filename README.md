# Lava AI Assistant over Docs

VA-facing AI knowledge search for Lava SOPs, policies, and training documents.

This is a React/Vite static SPA. It uses Supabase Auth, Postgres, Storage, RLS, and an external approved Lava spine Anthropic proxy. There is no Node backend server in this app.

## What is included

- Magic link login screen
- VA-facing chat/search screen
- Document upload screen for Admins/Trainers
- Document library screen
- Audit and usage screen
- Supabase schema with `docs`, `doc_chunks`, and append-only `activity_log`
- RLS policies for department-scoped document access
- Storage bucket setup for SOP/policy files
- Spine proxy placeholder for AI answers and document indexing
- Local Markdown-only fallback option for early testing

## Important limitations until you connect Lava services

I included safe placeholders because the real values were not provided:

1. Replace `src/data/Lava_Employees_Merged.js` with the full real Lava employee file.
2. Add the approved Lava spine Anthropic proxy endpoint to `.env` as `VITE_SPINE_PROXY_URL`.
3. Confirm the existing spine `employees` and `role_grants` column names. If they differ, adjust the helper functions in `supabase/schema.sql`.
4. PDF text extraction and embeddings should happen in the spine, not the browser.
5. Anthropic key and Supabase service role key must never be added to this React app.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create environment file

Copy `.env.example` to `.env.local`.

```bash
cp .env.example .env.local
```

Fill in:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-public-anon-key
VITE_SPINE_PROXY_URL=https://your-approved-spine-domain.com/ai/docs
VITE_STORAGE_BUCKET=training-docs
VITE_ENABLE_LOCAL_CHUNK_FALLBACK=false
```

Do not add service role keys or Anthropic keys here.

### 3. Run Supabase SQL

In Supabase SQL Editor, run:

```text
supabase/schema.sql
```

Then optionally run:

```text
supabase/seed.sql
```

### 4. Replace employee file

Replace this placeholder:

```text
src/data/Lava_Employees_Merged.js
```

with the full real file from the Lava common context/spine.

The app expects employee objects to have at least:

```js
{
  id: 'uuid',
  full_name: 'Employee Name',
  email: 'employee@lavatraining.com',
  department: 'Training',
  role: 'Trainer'
}
```

If your file uses different field names, update the helper functions at the top of `src/App.jsx`.

### 5. Connect the spine proxy

The app calls:

```js
callSpine('docs.index', payload, accessToken)
callSpine('docs.answer', payload, accessToken)
```

Expected `docs.index` responsibility:

- Read file from Supabase Storage
- Extract PDF/Markdown text
- Chunk the text
- Create embeddings
- Insert rows into `doc_chunks`
- Update `docs.status`

Expected `docs.answer` responsibility:

- Verify the user/session
- Search `doc_chunks` within RLS/department rules
- Send only retrieved chunks to Anthropic
- Return answer and citations

Expected `docs.answer` response:

```json
{
  "answer": "VAs should escalate coverage questions to a licensed producer or Account Manager.",
  "confidence": "High",
  "citations": [
    {
      "doc_id": "uuid",
      "chunk_id": "uuid",
      "title": "Escalation Runbook",
      "excerpt": "Coverage interpretation must be escalated...",
      "confidence": "High",
      "file_path": "Customer Success/escalation.pdf"
    }
  ]
}
```

## Local testing without the spine

For early UI testing only, you can set:

```bash
VITE_ENABLE_LOCAL_CHUNK_FALLBACK=true
```

This allows Markdown files to be chunked in the browser and inserted into `doc_chunks` without embeddings. It does not support production PDF indexing or AI answers.

## Run locally

```bash
npm run dev
```

## Build

```bash
npm run build
```

## Deploy to Netlify

Use these Netlify settings:

- Build command: `npm run build`
- Publish directory: `dist`

Add these environment variables in Netlify:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_SPINE_PROXY_URL`
- `VITE_STORAGE_BUCKET`
- `VITE_ENABLE_LOCAL_CHUNK_FALLBACK`

## Security checklist

- RLS enabled on every table
- `activity_log` protected by no-update/no-delete triggers
- No service role key in browser
- No Anthropic key in browser
- AI calls route through the spine proxy
- Department-level document access enforced by RLS
- VAs see names in UI; UUIDs are used in database rows

## Suggested first real documents

1. Lava Insurance VA Onboarding Guide
2. Attendance and Timekeeping Policy
3. Escalation Runbook
4. Personal Lines Training SOP
5. Commercial Lines Training SOP
6. AMS360 Basic Workflow
7. HawkSoft Basic Workflow
8. Farmers Portal Access Guide
9. Client Communication Standards
10. Licensed vs Non-Licensed VA Task Guidelines
