# BloxCode Radar

A small Roblox game-code search site. The public page shows commonly searched games first, suggests popular games while someone types, and tries to correct a misspelling to a game already in the shared list. Searches and popularity counts are public to every visitor.

## What it does

- Shows the most searched saved games at the top, with their shared search counts.
- Offers the five most popular games as search suggestions; matching games and a close spelling appear while typing.
- If a search is close to a saved game, it opens that game's shared result and says which spelling it matched.
- If no close saved game exists, it searches public web pages for the entered name. If no pages are found, it asks the visitor to try the correct spelling.
- Re-checks saved public source pages hourly through the Cloudflare Worker.
- Labels extracted codes unverified; only redeeming a code in its game can confirm it works.

## Update the existing site

The existing Cloudflare D1 database needs one small schema change before the updated Worker runs. Do these steps in order:

1. In Cloudflare, open the existing `bloxcode-radar` D1 database, open its SQL Console, and run the contents of `worker/migration-popularity.sql` **once**. Do not run this migration a second time.
2. Open the `bloxcode-radar-api` Worker code editor, replace its code with all of `worker/index.js`, then deploy. Keep its existing `DB` binding and encrypted `TAVILY_API_KEY` secret.
3. In the GitHub repository, upload/replace `index.html`, the `worker` folder, and `README.md`, then commit. GitHub Pages will publish the updated search bar and public popularity list.

The migration adds a counter column to the existing `games` table. The updated Worker needs that column, so do step 1 before deploying the Worker.

## Fresh setup

For a new D1 database, run `worker/schema.sql` once instead of the migration. Deploy `worker/index.js` to a Cloudflare Worker, bind the D1 database as `DB`, and add the Tavily API key as an encrypted Worker secret named `TAVILY_API_KEY`. Set the Worker Cron Trigger to `17 * * * *` for hourly refreshes. Publish `index.html` on GitHub Pages; it calls the existing Worker URL and contains no API key.

Never put the Tavily key in `index.html`, GitHub, or a message. The Worker caps new game searches at 900 Tavily credits per month and limits each visitor to five new-game searches per day. Searches of saved games use the database and do not call web search.

## Project files

- `index.html` — public GitHub Pages search page.
- `worker/index.js` — search API and hourly refresh job.
- `worker/schema.sql` — full tables for a new database.
- `worker/migration-popularity.sql` — one-time change for the existing database.
