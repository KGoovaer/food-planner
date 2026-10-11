# Food planner

Plan the week's meals from your phone, import recipes in seconds and turn the plan into a shopping list (optionally sent to [Bring!](https://www.getbring.com)).

- **Import recipes**
  - **HelloFresh & recipe websites**: paste a link, or install the app on your home screen and use *Share → Food* from the HelloFresh app / browser. HelloFresh's embedded data is used (per-serving amounts, pantry items marked); other sites via schema.org JSON-LD.
  - **Cookbook photos**: snap one or more pages; Claude reads the recipe (ingredients, method, servings, time). The first photo can become the recipe picture.
  - **Pasted text** and sites that block bots go through Claude as well.
  - Always lands in an editor first so you can check it before saving.
- **Week planner**: Monday–Sunday, per-meal servings (ingredients scale), notes like "eating out", move meals between days.
- **Shopping list**: ingredients of the week merged and summed (`600 g` + `0.5 kg` → `1.1 kg`), pantry basics (oil, salt, …) kept aside with a "Need" button, extra items, tick off while shopping, share as text or **send to Bring!**.
- **Find something to cook**: filter on protein (poultry, beef & red meat, pork, lamb, fish, seafood, vegetarian), *healthy*, *easy* (few ingredients, short method), cooking time, mains vs desserts, classics, chef and tags; sort A–Z, quickest first or "not cooked lately". The same quick filters are in the meal picker. These facts are derived from each recipe's ingredients, tags and title (`src/classify.ts`), so they also apply to recipes you add later – add the tag `dessert` or `healthy` to correct a recipe.
- **Cooking**: servings scaler, tap-to-tick ingredients and steps, *cook mode* keeps the screen on.
- Mobile-first PWA (installable, works with patchy reception in the shop), light/dark mode.

## Stack

Node 22 with native TypeScript (type stripping), `node:sqlite`, no framework; the frontend is plain ES modules without a build step. Runtime dependencies: `@anthropic-ai/sdk` and `zod` (AI import only).

```
src/server.ts       HTTP API + static files
src/db.ts           SQLite store
src/ingredients.ts  ingredient parsing (NL/EN units), scaling, shopping list aggregation
src/scrape.ts       HelloFresh / JSON-LD recipe extraction
src/ai.ts           Claude: photos, text, bot-protected pages
src/bring.ts        Bring! API client
src/planner.ts      weeks + shopping list for a week
web/                PWA
```

## Running

```bash
npm install
npm run dev          # http://localhost:8080, data in ./data
npm test
npm run typecheck
```

| Variable | Default | |
|---|---|---|
| `PORT` | `8080` | |
| `DATA_DIR` | `/data` | SQLite database and recipe images |
| `ANTHROPIC_API_KEY` | – | Enables photo / text import and the fallback for bot-protected sites |
| `ANTHROPIC_MODEL` | `claude-opus-5-5` | |
| `ANTHROPIC_EFFORT` | `medium` | `low` / `medium` / `high` |
| `BRING_EMAIL`, `BRING_PASSWORD` | – | Enables "Send to Bring!" (pick the list in Settings) |
| `TZ` | `Europe/Brussels` (image) | Determines "today" |

There is no login: the app is meant to sit behind the homelab's internal gateway / Tailscale.

## Deployment

Pushing to `main` runs the tests and publishes `ghcr.io/kgoovaer/food-planner:latest`. The homelab repo deploys it with ArgoCD from `proxmox/cluster/applications/food-planner` (see the readme there for secrets and backups). After deploying, open the app on the phone and use *Add to Home Screen* so it can act as a share target.

## Notes

- The Bring! integration uses Bring!'s unofficial API (same calls as the [bring-api](https://github.com/miaucl/bring-api) Python library). Item names that match Bring!'s catalog in the list's language get Bring!'s icons; the rest are added as custom items with the amount as specification.
- Ingredient editor format: one ingredient per line (`200 g kipfilet`, `1½ el olijfolie`, `2 cloves garlic, minced`); lines below a `Pantry:` line are basics you usually have at home.
- `node scripts/make-icons.ts` regenerates the PNG app icons.
