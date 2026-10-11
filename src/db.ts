// SQLite persistence (node:sqlite). Ingredients, steps and tags are stored as JSON columns on the recipe.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Ingredient } from "./ingredients.ts";

export interface Recipe {
  id: number;
  title: string;
  description: string;
  servings: number;
  totalMinutes: number | null;
  image: string | null;
  sourceUrl: string | null;
  sourceType: string;
  tags: string[];
  ingredients: Ingredient[];
  steps: string[];
  notes: string;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
}

export type RecipeInput = Omit<Recipe, "id" | "createdAt" | "updatedAt">;

export interface PlanEntry {
  id: number;
  date: string; // YYYY-MM-DD
  recipeId: number | null;
  note: string;
  servings: number;
}

export interface ShoppingExtra {
  id: number;
  week: string;
  text: string;
  checked: boolean;
}

export interface Settings {
  defaultServings: number;
  pantryStaples: string[];
  bringListUuid: string | null;
  bringListName: string | null;
}

const DEFAULT_SETTINGS: Settings = {
  defaultServings: 2,
  pantryStaples: ["zout", "peper", "peper en zout", "olijfolie", "zonnebloemolie", "water", "salt", "pepper", "olive oil"],
  bringListUuid: null,
  bringListName: null,
};

type Row = Record<string, unknown>;

export class Store {
  readonly db: DatabaseSync;

  constructor(dataDir: string) {
    if (dataDir !== ":memory:") mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(dataDir === ":memory:" ? ":memory:" : join(dataDir, "food.db"));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS recipes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        servings INTEGER NOT NULL DEFAULT 2,
        total_minutes INTEGER,
        image TEXT,
        source_url TEXT,
        source_type TEXT NOT NULL DEFAULT 'manual',
        tags TEXT NOT NULL DEFAULT '[]',
        ingredients TEXT NOT NULL DEFAULT '[]',
        steps TEXT NOT NULL DEFAULT '[]',
        notes TEXT NOT NULL DEFAULT '',
        favorite INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS plan (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        recipe_id INTEGER REFERENCES recipes(id) ON DELETE CASCADE,
        note TEXT NOT NULL DEFAULT '',
        servings INTEGER NOT NULL DEFAULT 2
      );
      CREATE INDEX IF NOT EXISTS plan_date ON plan(date);
      CREATE TABLE IF NOT EXISTS shopping_checks (
        week TEXT NOT NULL,
        key TEXT NOT NULL,
        checked INTEGER NOT NULL,
        PRIMARY KEY (week, key)
      );
      CREATE TABLE IF NOT EXISTS shopping_extras (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        week TEXT NOT NULL,
        text TEXT NOT NULL,
        checked INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  // --- recipes ---

  private toRecipe(r: Row): Recipe {
    return {
      id: Number(r.id),
      title: String(r.title),
      description: String(r.description),
      servings: Number(r.servings),
      totalMinutes: r.total_minutes === null ? null : Number(r.total_minutes),
      image: (r.image as string | null) ?? null,
      sourceUrl: (r.source_url as string | null) ?? null,
      sourceType: String(r.source_type),
      tags: JSON.parse(String(r.tags)),
      ingredients: JSON.parse(String(r.ingredients)),
      steps: JSON.parse(String(r.steps)),
      notes: String(r.notes),
      favorite: Boolean(r.favorite),
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
    };
  }

  listRecipes(): Recipe[] {
    return this.db.prepare("SELECT * FROM recipes ORDER BY favorite DESC, title COLLATE NOCASE").all().map((r) => this.toRecipe(r));
  }

  getRecipe(id: number): Recipe | null {
    const r = this.db.prepare("SELECT * FROM recipes WHERE id = ?").get(id);
    return r ? this.toRecipe(r) : null;
  }

  createRecipe(input: RecipeInput): Recipe {
    const res = this.db
      .prepare(
        `INSERT INTO recipes (title, description, servings, total_minutes, image, source_url, source_type, tags, ingredients, steps, notes, favorite)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(...this.recipeValues(input));
    return this.getRecipe(Number(res.lastInsertRowid))!;
  }

  updateRecipe(id: number, input: RecipeInput): Recipe | null {
    this.db
      .prepare(
        `UPDATE recipes SET title = ?, description = ?, servings = ?, total_minutes = ?, image = ?, source_url = ?, source_type = ?,
           tags = ?, ingredients = ?, steps = ?, notes = ?, favorite = ?, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(...this.recipeValues(input), id);
    return this.getRecipe(id);
  }

  setRecipeImage(id: number, image: string | null): void {
    this.db.prepare("UPDATE recipes SET image = ?, updated_at = datetime('now') WHERE id = ?").run(image, id);
  }

  deleteRecipe(id: number): void {
    this.db.prepare("DELETE FROM recipes WHERE id = ?").run(id);
  }

  private recipeValues(r: RecipeInput) {
    return [
      r.title,
      r.description,
      r.servings,
      r.totalMinutes,
      r.image,
      r.sourceUrl,
      r.sourceType,
      JSON.stringify(r.tags),
      JSON.stringify(r.ingredients),
      JSON.stringify(r.steps),
      r.notes,
      r.favorite ? 1 : 0,
    ] as const;
  }

  // --- plan ---

  private toPlan(r: Row): PlanEntry {
    return {
      id: Number(r.id),
      date: String(r.date),
      recipeId: r.recipe_id === null ? null : Number(r.recipe_id),
      note: String(r.note),
      servings: Number(r.servings),
    };
  }

  listPlan(from: string, to: string): PlanEntry[] {
    return this.db
      .prepare("SELECT * FROM plan WHERE date >= ? AND date <= ? ORDER BY date, id")
      .all(from, to)
      .map((r) => this.toPlan(r));
  }

  getPlanEntry(id: number): PlanEntry | null {
    const r = this.db.prepare("SELECT * FROM plan WHERE id = ?").get(id);
    return r ? this.toPlan(r) : null;
  }

  addPlanEntry(e: Omit<PlanEntry, "id">): PlanEntry {
    const res = this.db
      .prepare("INSERT INTO plan (date, recipe_id, note, servings) VALUES (?, ?, ?, ?)")
      .run(e.date, e.recipeId, e.note, e.servings);
    return this.getPlanEntry(Number(res.lastInsertRowid))!;
  }

  updatePlanEntry(id: number, e: Omit<PlanEntry, "id">): PlanEntry | null {
    this.db.prepare("UPDATE plan SET date = ?, recipe_id = ?, note = ?, servings = ? WHERE id = ?").run(e.date, e.recipeId, e.note, e.servings, id);
    return this.getPlanEntry(id);
  }

  deletePlanEntry(id: number): void {
    this.db.prepare("DELETE FROM plan WHERE id = ?").run(id);
  }

  /** How often a recipe was cooked, when last, and when it is planned next, for "haven't had this in a while" hints. */
  recipeHistory(today: string): Map<number, { count: number; last: string | null; next: string | null }> {
    const rows = this.db
      .prepare(
        `SELECT recipe_id,
                SUM(date <= ?) AS n,
                MAX(CASE WHEN date <= ? THEN date END) AS last,
                MIN(CASE WHEN date > ? THEN date END) AS next
         FROM plan WHERE recipe_id IS NOT NULL GROUP BY recipe_id`,
      )
      .all(today, today, today);
    return new Map(
      rows.map((r) => [Number(r.recipe_id), { count: Number(r.n), last: (r.last as string | null) ?? null, next: (r.next as string | null) ?? null }]),
    );
  }

  // --- shopping ---

  shoppingChecks(week: string): Map<string, boolean> {
    const rows = this.db.prepare("SELECT key, checked FROM shopping_checks WHERE week = ?").all(week);
    return new Map(rows.map((r) => [String(r.key), Boolean(r.checked)]));
  }

  setShoppingCheck(week: string, key: string, checked: boolean): void {
    this.db
      .prepare("INSERT INTO shopping_checks (week, key, checked) VALUES (?, ?, ?) ON CONFLICT(week, key) DO UPDATE SET checked = excluded.checked")
      .run(week, key, checked ? 1 : 0);
  }

  listExtras(week: string): ShoppingExtra[] {
    return this.db
      .prepare("SELECT * FROM shopping_extras WHERE week = ? ORDER BY id")
      .all(week)
      .map((r) => ({ id: Number(r.id), week: String(r.week), text: String(r.text), checked: Boolean(r.checked) }));
  }

  addExtra(week: string, text: string): void {
    this.db.prepare("INSERT INTO shopping_extras (week, text) VALUES (?, ?)").run(week, text);
  }

  setExtraChecked(id: number, checked: boolean): void {
    this.db.prepare("UPDATE shopping_extras SET checked = ? WHERE id = ?").run(checked ? 1 : 0, id);
  }

  deleteExtra(id: number): void {
    this.db.prepare("DELETE FROM shopping_extras WHERE id = ?").run(id);
  }

  // --- settings ---

  getSettings(): Settings {
    const rows = this.db.prepare("SELECT key, value FROM settings").all();
    const stored = Object.fromEntries(rows.map((r) => [String(r.key), JSON.parse(String(r.value))]));
    return { ...DEFAULT_SETTINGS, ...stored };
  }

  updateSettings(patch: Partial<Settings>): Settings {
    const stmt = this.db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    for (const [key, value] of Object.entries(patch)) {
      if (key in DEFAULT_SETTINGS && value !== undefined) stmt.run(key, JSON.stringify(value));
    }
    return this.getSettings();
  }
}
