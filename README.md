# ❄️ COLD FORGE

Trackea tu **Winter Arc** (1 oct → 31 dic, 92 días) y presume tu progreso.
App móvil offline-first, landing y API — todo en inglés, español y portugués.

## Monorepo ([Bun workspaces](https://bun.sh/docs/install/workspaces))

| Paquete | Ruta | Qué es |
| --- | --- | --- |
| `@cold-forge/app` | `apps/app` | La app: PWA (React 19 + Vite) y APK Android (Capacitor). Offline-first; modo invitado sin Firebase. |
| `@cold-forge/landing` | `apps/landing` | Landing en Astro con `/en`, `/es`, `/pt`. |
| `@cold-forge/admin` | `apps/admin` | Panel root de administración (solo habla con las Cloud Functions). |
| `@cold-forge/functions` | `apps/functions` | Cloud Functions: callables de admin, borrado de cuentas, cuotas. |
| `@cold-forge/firebase-rules` | `firebase` | Reglas de Firestore y sus tests contra el emulador. |
| `@cold-forge/core` | `packages/core` | Lógica pura: fechas del arc, rachas, rangos, logros, plantillas. |
| `@cold-forge/i18n` | `packages/i18n` | Textos compartidos en/es/pt con tipos. |
| `@cold-forge/sync` | `packages/sync` | Tipos, validación estricta (espejo de las reglas) y merge "gana el más reciente". |
| `@cold-forge/share-card` | `packages/share-card` | Imágenes 9:16 para historias y logros. |

Dominios: landing `coldforge.work` · app `app.coldforge.work` · admin `admin.coldforge.work`.
La versión con API propia (Bun + SQLite) vive en la rama `selfhosted-api`.

## Empezar

```sh
bun install
bun run dev            # app (:5173) y landing (:4321)
bun test               # tests (los de reglas se saltan sin emulador)
bun run typecheck
bun run build
# Reglas de Firestore contra el emulador (requiere Java 21):
bunx firebase-tools@15.32.1 emulators:exec --only auth,firestore --project demo-coldforge \
  "bun test firebase/rules.test.ts apps/app/src/firebase/emulator.test.ts"
```

## Arquitectura

- **Modo invitado (por defecto):** todo vive en el dispositivo; Firebase ni se descarga. Exporta/importa tus datos en JSON.
- **Con cuenta (Google):** sincronización en tiempo real con Firestore, registro por registro, "gana el más reciente".
- **Seguridad:** `firebase/firestore.rules` (cada usuario solo ve lo suyo, validación estricta, cuotas y bloqueo inmediato),
  admin solo vía Cloud Functions: es admin quien tenga su email (Google, verificado) en el secreto
  `ADMIN_ALLOWED_EMAILS` de Secret Manager, sin custom claims. Detalles en [`docs/firebase.md`](docs/firebase.md).
- **Despliegue:** Cloudflare Pages + APK en GitHub Releases; las reglas de Firestore y las Cloud Functions
  se despliegan solas desde GitHub Actions en cada push a `main` (sin claves, Workload Identity Federation).
  Paso a paso en [`docs/deploy.md`](docs/deploy.md).
