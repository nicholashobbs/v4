# V4

* A minimal “form-from-YAML” system (the `flux4bots` lib) that renders interactive widgets, edits a working JSON doc, previews the JSON Patch, and commits steps—optionally persisting them as a conversation history.
* A demo app (“Convo4 — Contact Builder” + a Resume hub) that shows the step-by-step flow.
* A tiny FastAPI + Mongo backend for storing objects and conversation histories.
* Docker compose to run Mongo, the API server, and the Next app together.

# Top-level layout

* `infra/docker-compose.yml` – spins up `mongo`, `server` (FastAPI), and `app` (Next.js).
* `server/` – FastAPI service with endpoints for objects, templates (simple store/fetch), and conversations (create/list/load/rename/appendStep/undo/reset).
* `app/` – Next 14 project with the `flux4bots` library under `app/lib/flux4bots`, plus a demo under `app/app/demo/convo4`.

# The library (`app/lib/flux4bots`)

**Core types & helpers**

* `types.ts` – all the shapes: Widgets (`text`, `select`, `list`, `field-picker`, `action`), `Template`, `Operation` (JSON Patch subset), `DocumentStore` interface, `ActionRegistry`, UI flags, etc.
* `core/pointer.ts` – JSON Pointer encode/decode, `getAtPointer`, `setAtPointer`, `joinPointer`.
* `core/binding.ts` – resolves binding paths with `${/pointer}` substitutions.
* `core/patch.ts` – diffs docs with `fast-json-patch` and applies our Operation\[].
* `core/validate.ts` – light template sanity checks (non-fatal warnings array).

**Engine & persistence**

* `engine/ConversationEngine.ts` – owns the working doc, committed steps, current/pending step queue, and a small `runtime` for actions (`enqueueSteps`, session state, `completeStep`). Exposes a `DocumentStore` facade so the UI can `getDoc()` and `applyPatch()` which: (1) records a `CommittedStep`, (2) applies the patch, and (3) optionally persists via an adapter (FastAPI).
* `persistence/FastApiAdapter.ts` – `ConversationsAdapter` for the server routes.
* `stores/memory.ts` & `stores/fastapi.ts` – `DocumentStore` implementations (in-memory or calling the FastAPI object endpoints).

**UI**

* `components/Flux4Bots.tsx` – the renderer for a single `Template`:

  * Loads the doc via `store.getDoc()`, keeps `original` + `working`.
  * Computes the patch (`diff` mode or `explicit` mode).
  * Shows “Patch Preview” and “Apply Patch” (sticky footer), optional “Current JSON”.
  * Widgets supported:

    * `text` (bound or captured to `vars`)
    * `select` with `dropdown` or `chips` variant, supports single/multi and labeled values
    * `list` from either a bound array **or** from object **keys** (`source: {type:'keys', basePath, exclude}`) with per-item `text/select` fields
    * `field-picker` that selects one or many JSON Pointers under a base path
    * `action` button that calls an `ActionRegistry` handler to emit ops
* `components/ChipSelect.tsx` – simple chip multi-select.

**Built-in actions & demo workflow**

* `actions/builtins.ts` – small helpers like `ensureObject`, `ensureKeys`, `writeFromVar`.
* `workflows/resume.ts` – a mini “resume section” flow:

  * Declares section definitions (experience/education/skills/summary) with per-section mode (`diff`/`explicit`).
  * Provides `getResumeSectionSteps()` (ready-to-enqueue steps) and `createResumeActions(...)` which:

    * Navigates to a section (`resume.choose-section`) by enqueueing the section step + hub.
    * For collection sections: add/remove/update items, mark done/in-progress, etc.
    * Stores view state (active section, statuses) via the engine’s session state.

# The demo flow (`app/app/demo/convo4`)

* `conversation.yaml` defines the high-level flow and per-step modes:

  1. **Step 1 – name** (`explicit`): a `text` + `action` to save `/contact/name`.
  2. **Step 2 – choose fields** (`explicit`): chip-select of built-in keys (phone, email, link, location) + an optional custom label; action creates/removes keys under `/contact`.
  3. **Step 3 – fill chosen** (`diff`): a keys-driven `list` generates inputs directly bound to `/contact/<key>`, excluding `name`.
  4. **Step 4 – create sections** (`explicit`): `field-picker` over `/resume`.
  5. **Step 5 – resume hub** (`explicit`): “Go to section” uses resume workflow actions to enqueue section templates and bounce back to the hub.
* `page.tsx` (server component) finds/loads YAML templates on the server and passes parsed `Template`s + modes into the client.
* `ClientConvo4.tsx` instantiates the `ConversationEngine` (wire to FastAPI adapter), defines the `ActionRegistry` for steps 1–3, and renders a two-column UI:

  * Left: chat-like history of committed steps; the current step shows a live `Flux4Bots` form; “Apply Patch” commits.
  * Right: basic controls (+New, Load, title rename, Undo), and a live JSON view (`engine.currentDoc`).

# Backend (`server/app/main.py`)

* `POST /objects` / `GET /objects/{id}` / `POST /objects/{id}/applyPatch` – object store with server-side `jsonpatch`.
* `POST /templates` / `GET /templates/{id}` – raw YAML storage (not central to demo).
* `POST /conversations` / `GET /conversations` / `GET /conversations/{id}` / `PATCH /conversations/{id}/title` / `POST /conversations/{id}/appendStep` / `POST /conversations/{id}/undo` / `POST /conversations/{id}/reset` – persisting conversation history (title, initial doc, array of committed steps).
* CORS open for dev; Mongo via `MONGO_URI` (compose sets DB to `appdb`).

# How data flows (at runtime)

1. **Templates** (YAML) → parsed to `Template` → rendered by `<Flux4Bots>`.
2. User edits inputs → **working doc** mutates (or values captured to `vars` if unbound).
3. Patch preview = `diff(original, working)` (or explicit ops when actions run).
4. **Apply Patch** → `DocumentStore.applyPatch(ops)`:

   * `ConversationEngine` records a `CommittedStep`, applies patch, and (if adapter is present) calls FastAPI to append.
5. Client UI updates history; engine tracks the next step (from list or anything enqueued by an action).

That’s my mental model. I’m ready for your “few simple UX/quality-of-life tweaks”—we’ll keep the core logic intact.
