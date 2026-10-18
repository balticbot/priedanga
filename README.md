# Priedanga

Offline-first public warning and shelter app for Lithuania. Works with full network, a congested network, or no network at all.

- **Priedanga** — the citizen app: signed alerts, offline shelter finder, offline guidance in 5 languages.
- **Tiltas** — the offline Bluetooth mesh that relays signed alerts phone to phone.

Status: early development. Not affiliated with or endorsed by any government body. Only TEST alerts are issued.

## Docs

- [MVP scope](docs/mvp-scope.md)
- [Architecture](docs/architecture.md)
- [Ideas backlog](docs/ideas-backlog.md)

## Repository layout

| Path | What |
|---|---|
| `packages/alert-format` | Trust core: signed alerts, certificates, revocation, manifests ([SPEC](packages/alert-format/SPEC.md)) |
| `packages/content-builder` | Builds signed content packs from official open data (PAGD registers, Address Register) |
| `packs/dev` | Current dev content pack (12k+ shelters, KAS, evacuation points, sirens), signed with a dev key |
| `apps/mobile` | Expo (React Native) app: offline shelter finder, LT/EN/RU/PL/UK |

## Development

```bash
npm install
npm run build:packages     # build alert-format + content-builder
npm test                   # all workspaces
npm run pack               # refresh packs/dev from data.gov.lt (creates dev keys in secrets/dev on first run)
npm run web -w @priedanga/mobile    # run the app in a browser
```

Dev keys live in `secrets/dev/` and are never committed. If you rebuild the pack with new dev keys, update `apps/mobile/src/trust/root.ts` with the new root public key (`packs/dev/DEV_ROOT_PUBLIC_KEY.txt`); a test checks they match.

Data: Priešgaisrinės apsaugos ir gelbėjimo departamentas prie VRM and Registrų centras via data.gov.lt, CC BY 4.0.
