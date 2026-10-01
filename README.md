# ❄️ COLD FORGE

Trackea tu **Winter Arc** (1 oct → 31 dic, 92 días) y presume tu progreso.
App móvil offline-first, landing y API — todo en inglés, español y portugués.

## Monorepo ([Bun workspaces](https://bun.sh/docs/install/workspaces))

| Paquete | Ruta | Qué es |
| --- | --- | --- |
| `@cold-forge/app` | `apps/app` | App móvil: React 19 + Vite + Capacitor (iOS/Android). Offline-first, datos en el dispositivo. |
| `@cold-forge/landing` | `apps/landing` | Landing en Astro con rutas `/en`, `/es`, `/pt`. |
| `@cold-forge/api` | `apps/api` | API con `Bun.serve` + `bun:sqlite`. Será la capa de sincronización y perfiles públicos. |
| `@cold-forge/core` | `packages/core` | Lógica pura: fechas del arc, rachas, días perfectos, rangos, logros, plantillas de hábitos. |
| `@cold-forge/i18n` | `packages/i18n` | Textos compartidos en/es/pt con tipos (si falta una traducción, no compila) y texto para compartir. |
| `@cold-forge/share-card` | `packages/share-card` | Genera las imágenes 9:16 para historias y logros (canvas → PNG). |

Cada app guarda sus textos de interfaz en su propia carpeta `src/i18n/{en,es,pt}.ts`; lo que comparten (rangos, hábitos, logros) vive en `@cold-forge/i18n`.

## Empezar

```sh
bun install
bun run dev          # app (:5173), landing (:4321) y API (:3001)
bun run dev:app      # solo la app
bun run dev:landing  # solo la landing
bun run preview:cards  # galería de imágenes para compartir
bun test             # tests de todo el monorepo
bun run typecheck    # typecheck de cada workspace
bun run build        # build de la app y la landing
```

### App nativa (Capacitor)

Los proyectos nativos no están en el repo todavía. En una máquina con Xcode / Android Studio:

```sh
cd apps/app
bun run build
bunx cap add ios
bunx cap add android
bun run cap:sync
```

## Arquitectura

- **Offline-first:** la app guarda todo en el dispositivo (Capacitor Preferences). Cada registro tiene `updatedAt`, listo para sincronizar con la API usando "gana el más reciente".
- **Lógica compartida:** `core` es puro y sin dependencias; los mismos cálculos de rachas corren en el teléfono, en la API y en la landing.
- **Idiomas:** detección automática (`pt-BR` → `pt`, `es-MX` → `es`, resto → `en`), cambiable en ajustes.

## API (actual)

| Método | Ruta | Descripción |
| --- | --- | --- |
| GET / PATCH | `/api/arc` | Arc actual. |
| POST | `/api/habits` | `{ name, emoji }` |
| DELETE | `/api/habits/:id` | Borra hábito e historial. |
| POST | `/api/check-ins/toggle` | `{ habitId, date: "YYYY-MM-DD" }` |
| GET | `/api/check-ins` | Check-ins del arc. |
| GET | `/api/stats?today=YYYY-MM-DD` | Día, rachas, cumplimiento, rango. |
| GET | `/api/share?today=…&locale=es` | Texto para presumir (o idioma vía `Accept-Language`). |

Variables: `PORT`, `DATABASE_PATH` (default `cold-forge.sqlite`).

## Siguiente

- Login + sincronización en la API, y conectar la app.
- Perfiles públicos (`/u/nombre`) en la landing.
- Endpoint de lista de espera (`TODO(waitlist)` en la landing).
