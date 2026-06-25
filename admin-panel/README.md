# Fracture MC FriendConnect Admin

Static admin dashboard for the FriendConnect bot. GitHub Pages serves the built files, while Supabase handles login, data, Realtime updates, and the bot action queue.

The bot service and admin panel do not need to live in the same folder at runtime. The current local layout is:

```text
/Users/whsly/Desktop/FractureMC/friend-connect-bot/FC Bot
/Users/whsly/Desktop/FractureMC/friend-connect-bot/admin-panel
```

They communicate through Supabase when the bot bridge is enabled. The admin panel never imports bot source files from the bot folder.

## Setup

```sh
npm install
cp .env.example .env.local
npm run build
```

Configure Supabase with the SQL in `supabase/migrations`, then set the public Supabase URL and anon key in `.env.local`.

The first person to open the configured panel can create the owner login with an email and password. After that, new panel accounts must be invited from Developer → Admin Users. Invites are queued in Supabase and sent by the running bot bridge with the service-role key; that key must stay only in the bot `.env`, never in GitHub Pages variables.

Enable the bridge in the bot `.env` inside `/Users/whsly/Desktop/FractureMC/friend-connect-bot/FC Bot` with the same bot id used by `NEXT_PUBLIC_FRIENDCONNECT_BOT_ID`.

## Deploy

Set `NEXT_PUBLIC_BASE_PATH` when deploying to a GitHub Pages repository path. Leave it empty for a custom domain at the site root.

## Controls

The panel queues only allowlisted bot actions. It does not expose shell execution, file editing, package updates, or free-form backend commands.

Main can edit runtime settings for the Bedrock target, session card, presence, friend automation, add-back timing, invite cooldowns, player limits, allowlists, blocklists, and lockdown mode. Developer includes diagnostics, fix logs, action history, security events, lockdown actions, XUID block controls, and admin account invitations with role-based permissions.

GitHub Pages serves static files only. DDoS filtering and edge protection come from the hosting providers in front of GitHub Pages and Supabase; the bot bridge adds no public management port and throttles queued actions before they reach the running bot.
