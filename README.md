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
| `@cold-forge/sync` | `packages/sync` | Contrato app ⇄ API: tipos, validación estricta y merge "gana el más reciente". |
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

- **Offline-first:** la app guarda todo en el dispositivo. Sin cuenta funciona completa; puedes exportar e importar tus datos en JSON.
- **Sincronización opcional:** con cuenta (enlace mágico + código por correo), cada registro se sincroniza con "gana el más reciente". Si el dispositivo y la cuenta tienen arcs distintos, la app pregunta cuál conservar y el otro queda como historial.
- **Lógica compartida:** `core` es puro y sin dependencias; los mismos cálculos de rachas corren en el teléfono, en la API y en la landing.
- **Idiomas:** detección automática (`pt-BR` → `pt`, `es-MX` → `es`, resto → `en`), cambiable en ajustes.

## API (`apps/api`)

Solo sirve para sincronizar entre dispositivos; la app funciona completa sin cuenta.

| Método | Ruta | Descripción |
| --- | --- | --- |
| POST | `/v1/auth/magic-link` | `{ email, locale }` → siempre `202 { requestId }` (no revela si la cuenta existe). |
| POST | `/v1/auth/verify` | `{ requestId, code }` o `{ token }` → sesión `{ token, expiresAt, user }`. |
| POST | `/v1/auth/logout` · `/v1/auth/logout-all` | Revoca la sesión actual o todas. |
| GET / DELETE | `/v1/me` | Usuario actual / borrar cuenta y todos sus datos (requiere login de hace < 10 min). |
| POST | `/v1/sync` | Sincronización por registro, gana el más reciente, con cursor y `hasMore`. |
| GET | `/v1/export` | Todos tus datos en JSON. |

Contrato y validación compartidos en `packages/sync`. Variables documentadas en `apps/api/.env.example`;
en producción el servidor se niega a arrancar sin `AUTH_SECRET`, SMTP, `APP_URL` https y `CORS_ORIGINS`.

### Seguridad

- Códigos y tokens guardados solo como HMAC; códigos de 15 min, un solo uso, 5 intentos; 10 fallos por correo al día bloquean los códigos.
- Sesiones opacas (bearer, sin cookies), 60 días deslizantes con tope de 1 año.
- Cada tabla está aislada por `user_id` con llaves compuestas: los IDs de otro usuario no sirven de nada.
- Correos normalizados (NFC, ASCII, punycode) para que no existan variantes invisibles de una misma cuenta.
- Límites por IP (/64 en IPv6), por correo, por correo+IP, por usuario, por registros escritos, cuentas nuevas por IP y tope global de correos.
- CORS con lista exacta, cabeceras de seguridad, límites de tamaño, base de datos con permisos `0600`, logs sin correos ni códigos.

**Una sola instancia.** Los límites viven en memoria del proceso (`MemoryRateLimiter`). Corre exactamente una instancia de la API:
con N instancias cada límite se multiplica por N, y se reinician al reiniciar. El bloqueo por códigos fallidos vive en SQLite.
Para escalar, implementa `RateLimiter` sobre Redis y pásalo a `createApp`. SQLite es de un solo escritor; `/v1/sync` usa una transacción corta.

## Siguiente

- Login con Google / Apple.
- Perfiles públicos (`/u/nombre`) en la landing.
- Endpoint de lista de espera (`TODO(waitlist)` en la landing).
