# Aura Music 🎵

A full-stack music streaming and social playback application with desktop (Tauri) and mobile (Capacitor) support.

## 🚀 Project Tech Stack

- **Frontend**: React 19, Vite, Tailwind CSS 4
- **Backend**: Express (Node.js), Socket.io (real-time sync)
- **Database**: MySQL (Users, Tracks, Playlists, Sessions), Firebase (Auth/Store), Dexie (Local IndexedDB)
- **Platforms**: Web, Desktop (Tauri), Android (Capacitor)
- **AI**: Google Gemini (`@google/genai`)
- **Audio**: Custom Web Audio API implementation (`audioGraph.ts`, `loudnessAnalysis.ts`)

## 🛠 Development Commands

### Frontend / Client
- `npm run dev`: Starts the development server (via `tsx server.ts` which serves the frontend)
- `npm run build`: Builds the production frontend via Vite
- `npm run preview`: Previews the production build
- `npm run lint`: Runs TypeScript type checking

### Desktop / Mobile
- `npm run tauri`: Runs the Tauri CLI for desktop development
- (Capacitor commands are typically run via `@capacitor/cli`)

### Backend
- The backend is integrated into `server.ts`.
- Start server: `npm run dev`

## 📐 Architecture & Patterns

### Project Structure
- `src/`: Frontend React code
  - `src/audio/`: Core audio engine, EQ math, and loudness analysis
  - `src/components/`: UI Overlays and playback components
  - `src/hooks/`: Custom React hooks for audio, sockets, and auth
  - `src/services/`: External API integrations (Firebase, iTunes, Lyrics)
- `server.ts`: Unified Express + Socket.io server handling:
  - User authentication (JWT + bcrypt)
  - Track management (MySQL + local file storage)
  - Social Sessions (Socket.io rooms for synchronized playback)
  - "Wrapped" statistics (tracking listening pings)

### Key Implementation Details
- **Session Sync**: Uses a "Host" model. Only the host can trigger playback commands (`play-track`, `seek`, etc.), which are then broadcast to all session members.
- **Audio Engine**: Implements a complex audio graph for EQ and loudness normalization.
- **Asset Storage**: Tracks and covers are stored in `public/uploads`.
- **Auth**: Supports both web-based (with Cloudflare Turnstile) and Capacitor-app based authentication.

## 📝 Guidelines

- **Naming**: Use camelCase for variables/functions, PascalCase for components.
- **State**: Prefer hooks for audio state management.
- **Backend**: Ensure all track-related DB operations handle file cleanup on deletion.
- **Performance**: Use the `audioCache.ts` utility for managing audio buffers.
