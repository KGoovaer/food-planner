import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/db.ts";
import { addDays, shoppingForWeek, weekStart } from "../src/planner.ts";

test("week helpers", () => {
  assert.equal(weekStart("2026-10-11"), "2026-10-05"); // Sunday → previous Monday
  assert.equal(weekStart("2026-10-05"), "2026-10-05");
  assert.equal(addDays("2026-12-30", 3), "2027-01-02");
});

test("shopping list for a planned week scales servings and handles pantry items", () => {
  const store = new Store(":memory:");
  const base = { description: "", totalMinutes: 30, image: null, sourceUrl: null, sourceType: "manual", tags: [], steps: [], notes: "", favorite: false };
  const curry = store.createRecipe({
    ...base,
    title: "Curry",
    servings: 2,
    ingredients: [
      { quantity: 300, unit: "g", name: "Kipfilet" },
      { quantity: 1, unit: "", name: "Ui" },
      { quantity: 1, unit: "tbsp", name: "Olijfolie", pantry: true },
    ],
  });
  const soup = store.createRecipe({ ...base, title: "Soep", servings: 4, ingredients: [{ quantity: 2, unit: "", name: "ui" }] });

  store.addPlanEntry({ date: "2026-10-06", recipeId: curry.id, note: "", servings: 4 });
  store.addPlanEntry({ date: "2026-10-08", recipeId: soup.id, note: "", servings: 2 });
  store.addPlanEntry({ date: "2026-10-09", recipeId: null, note: "Restaurant", servings: 2 });
  store.addPlanEntry({ date: "2026-10-13", recipeId: soup.id, note: "", servings: 4 }); // next week

  let view = shoppingForWeek(store, "2026-10-10");
  assert.equal(view.from, "2026-10-05");
  assert.equal(view.meals, 2);
  assert.deepEqual(view.items.map((i) => [i.name, i.amountText]), [["Kipfilet", "600 g"], ["Ui", "3"]]);
  assert.deepEqual(view.pantry.map((i) => i.name), ["Olijfolie"]);

  store.setShoppingCheck(view.week, "ui", true);
  store.setShoppingCheck(view.week, "need:olijfolie", true);
  view = shoppingForWeek(store, "2026-10-05");
  assert.equal(view.items.find((i) => i.key === "ui")!.checked, true);
  assert.equal(view.pantry.length, 0);
  assert.equal(view.items.find((i) => i.key === "olijfolie")!.amountText, "2 tbsp");

  // Deleting a recipe removes it from the plan.
  store.deleteRecipe(curry.id);
  assert.equal(shoppingForWeek(store, "2026-10-05").meals, 1);
});

test("settings merge with defaults", () => {
  const store = new Store(":memory:");
  assert.equal(store.getSettings().defaultServings, 2);
  store.updateSettings({ defaultServings: 4, bringListUuid: "abc" });
  const s = store.getSettings();
  assert.equal(s.defaultServings, 4);
  assert.equal(s.bringListUuid, "abc");
  assert.ok(s.pantryStaples.includes("zout"));
});

test("impossible dates are rejected", async () => {
  const { isDate } = await import("../src/planner.ts");
  assert.equal(isDate("2026-02-31"), false);
  assert.equal(isDate("2028-02-29"), true);
});
