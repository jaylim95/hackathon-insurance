# AGENTS.md

## Purpose

This repository is a SeaVoice-branded fork of LiveKit Meet built with Next.js App Router. It supports:

- ad hoc room creation from the landing page
- joining named rooms through a pre-join flow
- custom server connection testing with user-supplied LiveKit credentials
- optional E2EE via a passphrase stored in the URL hash
- optional room recording controls
- custom server-side actions for agent dispatch and SIP dialing

The codebase is mostly standard LiveKit Meet structure with a few local customizations layered into the room experience.

## Stack

- Next.js 15 App Router
- React 18
- TypeScript
- `@livekit/components-react`
- `livekit-client`
- `livekit-server-sdk`
- Vitest for the small unit-test surface
- Prettier and Next ESLint

Package manager: `pnpm`

## Useful Commands

- `pnpm dev`
- `pnpm build`
- `pnpm start`
- `pnpm lint`
- `pnpm lint:fix`
- `pnpm test`
- `pnpm format:check`
- `pnpm format:write`

## Top-Level Layout

- `app/`
  App Router pages and route handlers.
- `app/page.tsx`
  Landing page. Lets users start a demo call or connect to a custom server.
- `app/rooms/[roomName]/page.tsx`
  Dynamic room route wrapper.
- `app/rooms/[roomName]/PageClientImpl.tsx`
  Main in-room client implementation. This is the most customized file in the repo.
- `app/custom/`
  Direct join flow when a token and LiveKit URL are already known.
- `app/connection-test/page.tsx`
  UI for connection diagnostics using `livekit-client` connection checks.
- `app/api/`
  Server routes for token generation, recording control, and blob upload.
- `lib/`
  Shared client/server helpers, hooks, and local extensions.
- `styles/`
  CSS modules plus global styling.
- `public/`
  Static assets and background imagery.

## Core Request Flows

### Landing and Demo Flow

`app/page.tsx` generates a random room id and routes to `/rooms/[roomName]`. If E2EE is enabled, the passphrase is encoded into the URL hash.

### Standard Room Join Flow

`app/rooms/[roomName]/PageClientImpl.tsx`:

1. renders LiveKit `PreJoin`
2. calls `GET /api/connection-details`
3. receives `serverUrl`, `participantToken`, and participant metadata
4. creates a `Room` and connects
5. enables camera and microphone based on pre-join choices

### Custom Server Flow

`app/page.tsx` custom tab posts credentials to `POST /api/connection-test`, gets back a short-lived token, then routes to `/custom`.

`app/custom/VideoConferenceClientImpl.tsx` connects directly using the provided `liveKitUrl` and `token`.

### Connection Test Flow

`app/connection-test/page.tsx` also uses `POST /api/connection-test`, then runs LiveKit connection checks plus custom UDP/TCP protocol checks from `lib/protocolChecks.ts`.

## Server Routes

- `app/api/connection-details/route.ts`
  Generates participant tokens from server env vars. Also rewrites the server URL for region-specific LiveKit Cloud hosts.
- `app/api/connection-test/route.ts`
  Generates a short-lived token from user-supplied URL/API key/API secret. Used by both the landing page custom connect flow and the connection-test page.
- `app/api/record/start/route.ts`
  Starts composite egress recording to S3-compatible storage. Intentionally unauthenticated and marked unsafe for production as written.
- `app/api/record/stop/route.ts`
  Stops active egress recordings for a room. Also intentionally unauthenticated.
- `app/api/upload/route.ts`
  Uploads a file to Vercel Blob using a hard-coded object key (`jay.png`). This looks like a local customization and should be treated carefully before production use.

## Shared Libraries

- `lib/client-utils.ts`
  room id generation, passphrase encoding/decoding, small client utilities
- `lib/getServerURL.ts`
  region-aware LiveKit Cloud URL rewriting
- `lib/getServerURL.test.ts`
  the only checked-in test file at the moment
- `lib/useSetupE2EE.ts`
  derives passphrase from URL hash and creates the LiveKit E2EE worker
- `lib/usePerfomanceOptimiser.ts`
  low-CPU mode hook that reduces quality under constraint
- `lib/SettingsMenu.tsx`
  optional settings and recording UI, gated by env
- `lib/Debug.tsx`
  debug overlay and optional Datadog log forwarding
- `lib/add_agent.ts`
  server action that dispatches a LiveKit agent into a room
- `lib/sip_call.ts`
  server action for SIP dial-out and hangup via LiveKit

## Environment Variables

There is no checked-in `.env.example` right now. Infer the active env surface from code:

- `LIVEKIT_URL`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `NEXT_PUBLIC_CONN_DETAILS_ENDPOINT`
- `NEXT_PUBLIC_SHOW_SETTINGS_MENU`
- `NEXT_PUBLIC_LK_RECORD_ENDPOINT`
- `NEXT_PUBLIC_DATADOG_CLIENT_TOKEN`
- `NEXT_PUBLIC_DATADOG_SITE`
- `S3_KEY_ID`
- `S3_KEY_SECRET`
- `S3_BUCKET`
- `S3_ENDPOINT`
- `S3_REGION`
- `SIP_TRUNK_ID`

Also note:

- `app/api/upload/route.ts` depends on Vercel Blob configuration through `@vercel/blob`, even though the variable names are not referenced directly in the source.
- E2EE relies on the passphrase being present in the URL hash, not in env.

## Known Sharp Edges

- `app/rooms/[roomName]/PageClientImpl.tsx` is heavily customized and currently has local inline UI for agent dispatch and SIP dialing. Read it fully before editing.
- That same file currently contains noisy `console.log` debugging and broad `alert()`-based error handling.
- `const room = React.useMemo(() => new Room(roomOptions), []);` in `PageClientImpl.tsx` does not react to `roomOptions` changes. Be careful when touching room initialization or E2EE behavior.
- `lib/useSetupE2EE.ts` creates a new worker during render when a passphrase exists. That may be relevant if you are debugging reconnects or repeated worker creation.
- Recording start/stop routes are intentionally unauthenticated and not production-safe as written.
- `app/api/upload/route.ts` overwrites the same blob object name each time.
- Formatting/style consistency is mixed. Prefer following the existing local style in touched files instead of broad cleanup unless the task is explicitly refactor-oriented.

## Current Worktree Notes

At the time this file was created, the git worktree was already dirty:

- modified: `app/rooms/[roomName]/PageClientImpl.tsx`
- untracked: `lib/sip_call.ts`

Do not revert or overwrite those changes unless the user explicitly asks for it.

## Editing Guidance For Future Agents

- Start by reading `app/page.tsx`, `app/rooms/[roomName]/PageClientImpl.tsx`, and the relevant `app/api/*` route for the feature you are changing.
- If a task mentions joining rooms, connection tokens, or participant identity, inspect `app/api/connection-details/route.ts` first.
- If a task mentions recording, inspect both `lib/SettingsMenu.tsx` and `app/api/record/*`.
- If a task mentions SIP or agent dispatch, inspect `lib/sip_call.ts`, `lib/add_agent.ts`, and the custom controls inside `PageClientImpl.tsx`.
- Avoid broad formatting-only edits in this repo unless requested.
- Preserve App Router conventions and existing import aliases (`@/lib/...`).

## Verification Guidance

For small UI or route changes, the normal minimum is:

- `pnpm lint`
- `pnpm test`

For room-flow changes, also run:

- `pnpm dev`
- manual verification of landing page, room join, and any touched API route

If the change affects recording, SIP, or agent dispatch, document what could not be verified locally without credentials or external infrastructure.
