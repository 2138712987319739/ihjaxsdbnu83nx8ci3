# Fracture MC Friend Connect

Standalone Bedrock friend connect service for Fracture MC. The service signs in with a dedicated Xbox account, accepts Bedrock friend requests, exposes a joinable Friends-tab session, and transfers players to the configured Bedrock endpoint.

Default endpoint:

```text
play.fracturemc.com:19132
```

## Requirements

- Node.js 20.18 or newer.
- A dedicated Microsoft/Xbox account for the bot.
- A reachable Bedrock endpoint, currently `play.fracturemc.com:19132`.
- A real Bedrock client for final testing.

Do not use a staff or owner account as the bot account. This service depends on Xbox social/session APIs and should run from an account dedicated to this purpose.

## Setup

```sh
npm install
cp .env.example .env
npm run build
npm run doctor
npm start
```

On first start, complete the Microsoft device login shown in the terminal. The auth cache is stored under `.runtime/auth` and is ignored by source control.

## Player Flow

1. A Bedrock player adds the bot account from the Friends tab.
2. The service adds the player back on the follower reconciliation cycle. The default cycle is 5 seconds.
3. The service invites the player to the joinable `FractureMC` session after the add-back event.
4. The player joins the session card.
5. The session transfers the player to `play.fracturemc.com:19132`.

The session card publishes the world name as `FractureMC`. Minecraft formatting codes are rejected so Bedrock clients do not display raw formatting characters.

## Operations

```sh
npm run typecheck
npm run lint
npm run build
npm run audit
npm run doctor
npm run check:updates
npm run scan
```

`npm run check:updates` only reports available package updates. It does not change files.

## Admin Panel Location

The admin panel was left in the original dashboard folder so moving the bot does not disturb the running panel:

```sh
cd "/Users/whsly/Desktop/FractureMC/friend-connect-bot/admin-panel"
npm install
cp .env.example .env.local
npm run build
```

It is a static Next.js dashboard designed for GitHub Pages with Supabase handling login, status, command queue, fix logs, player history, and setup tables.

Apply the SQL in `/Users/whsly/Desktop/FractureMC/friend-connect-bot/admin-panel/supabase/migrations`, add allowed administrators to `admin_users`, then configure:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_FRIENDCONNECT_BOT_ID=fracture-main
NEXT_PUBLIC_BASE_PATH=
```

Enable the bot bridge with:

```text
FRIENDCONNECT_ADMIN_ENABLED=true
FRIENDCONNECT_ADMIN_SUPABASE_URL=
FRIENDCONNECT_ADMIN_SUPABASE_SERVICE_ROLE_KEY=
FRIENDCONNECT_ADMIN_BOT_ID=fracture-main
```

The panel queues allowlisted actions only. It does not expose shell execution, file editing, package updates, or free-form backend commands.

The Main section can update the safe runtime surface: Bedrock target, session text, display name, joinability, world max players, invite cooldown, presence updates, friend automation, add-back timing, friend policy, allowlists, blocklists, and lockdown mode. Xbox account profile images and gamertag changes still have to be made on the Microsoft account itself.

The Developer section includes defensive controls for diagnostics, republishing the session, reconnecting the portal, clearing invite cooldown state, retrying known invite failures, toggling lockdown, blocking or unblocking XUIDs, and reviewing security events. It does not perform retaliation or run arbitrary commands.

## Geyser And Floodgate

Fast path for crossplay:

1. Install Geyser on the front-facing Paper/Spigot or Velocity layer.
2. Install Floodgate on the same front-facing layer.
3. Set Geyser `auth-type` to `floodgate`.
4. Open UDP port `19132`.
5. Run `geyser connectiontest play.fracturemc.com 19132`.

Keep Floodgate `key.pem` private. Anyone with that key can bypass normal Java account checks through Floodgate.

Official setup references:

- https://geysermc.org/wiki/geyser/setup/
- https://geysermc.org/wiki/floodgate/setup/

## Review Notes

- The admin panel is static and private through Supabase Auth.
- No inbound management API is exposed by the bot.
- Runtime auth material stays under `.runtime/`.
- The upstream package currently has a license metadata mismatch: the repository is detected as MIT, while the npm package metadata says ISC. Resolve that before redistributing modified upstream code.
