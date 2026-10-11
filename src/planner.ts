// Week arithmetic and turning a week's meal plan into a shopping list.

import { buildShoppingList, scaleIngredients, type ShoppingItem, type ShoppingSource } from "./ingredients.ts";
import type { ShoppingExtra, Store } from "./db.ts";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDate(s: unknown): s is string {
  // Round-trip check rejects dates that Date would roll over, like 2026-02-31.
  return typeof s === "string" && DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && addDays(s, 0) === s;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Monday of the week containing `date`. */
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const offset = (d.getUTCDay() + 6) % 7; // Monday = 0
  return addDays(date, -offset);
}

export function today(): string {
  // Local date of the server (TZ env var, Europe/Brussels in the container).
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export interface ShoppingView {
  week: string;
  from: string;
  to: string;
  meals: number;
  items: (ShoppingItem & { checked: boolean; needed: boolean })[];
  pantry: (ShoppingItem & { checked: boolean; needed: boolean })[];
  extras: ShoppingExtra[];
}

export function shoppingForWeek(store: Store, week: string): ShoppingView {
  const from = weekStart(week);
  const to = addDays(from, 6);
  const entries = store.listPlan(from, to).filter((e) => e.recipeId !== null);
  const sources: ShoppingSource[] = [];
  for (const entry of entries) {
    const recipe = store.getRecipe(entry.recipeId!);
    if (!recipe) continue;
    const factor = recipe.servings > 0 ? entry.servings / recipe.servings : 1;
    sources.push({ recipe: recipe.title, ingredients: scaleIngredients(recipe.ingredients, factor) });
  }
  const settings = store.getSettings();
  const checks = store.shoppingChecks(from);
  const all = buildShoppingList(sources, settings.pantryStaples).map((item) => ({
    ...item,
    checked: checks.get(item.key) ?? false,
    // Pantry items stay off the list unless marked as "need to buy" (stored as a `need:` check).
    needed: item.pantry && (checks.get(`need:${item.key}`) ?? false),
  }));
  return {
    week: from,
    from,
    to,
    meals: sources.length,
    items: all.filter((i) => !i.pantry || i.needed),
    pantry: all.filter((i) => i.pantry && !i.needed),
    extras: store.listExtras(from),
  };
}
