import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildShoppingList,
  formatIngredientsText,
  formatQuantity,
  parseIngredient,
  parseIngredientsText,
  scaleIngredients,
} from "../src/ingredients.ts";

test("parses HelloFresh style lines", () => {
  assert.deepEqual(parseIngredient("200 gram Kipfilet"), { quantity: 200, unit: "g", name: "Kipfilet" });
  assert.deepEqual(parseIngredient("2 stuk(s) Briochebroodje"), { quantity: 2, unit: "", name: "Briochebroodje" });
  assert.deepEqual(parseIngredient("4 plak(ken) Ontbijtspek"), { quantity: 4, unit: "slice", name: "Ontbijtspek" });
  assert.deepEqual(parseIngredient("½ el [Plantaardige] boter"), { quantity: 0.5, unit: "tbsp", name: "Plantaardige boter" });
  assert.deepEqual(parseIngredient("½ el Honing [of plantaardig alternatief]"), {
    quantity: 0.5, unit: "tbsp", name: "Honing", note: "of plantaardig alternatief",
  });
  assert.deepEqual(parseIngredient("naar smaak Peper en zout"), { quantity: null, unit: "", name: "Peper en zout", note: "naar smaak" });
});

test("parses English cookbook lines", () => {
  assert.deepEqual(parseIngredient("1 1/2 cups flour"), { quantity: 1.5, unit: "cup", name: "flour" });
  assert.deepEqual(parseIngredient("2 cloves garlic, minced"), { quantity: 2, unit: "clove", name: "garlic", note: "minced" });
  assert.deepEqual(parseIngredient("1 cup of milk"), { quantity: 1, unit: "cup", name: "milk" });
  assert.deepEqual(parseIngredient("3 large eggs"), { quantity: 3, unit: "", name: "large eggs" });
  assert.deepEqual(parseIngredient("200g butter"), { quantity: 200, unit: "g", name: "butter" });
  assert.deepEqual(parseIngredient("1,5 kg aardappelen"), { quantity: 1.5, unit: "kg", name: "aardappelen" });
  assert.deepEqual(parseIngredient("2-3 tomaten"), { quantity: 3, unit: "", name: "tomaten" });
  assert.deepEqual(parseIngredient("1½ tl kerriepoeder"), { quantity: 1.5, unit: "tsp", name: "kerriepoeder" });
  assert.deepEqual(parseIngredient("- zout"), { quantity: null, unit: "", name: "zout" });
});

test("container and size words around units", () => {
  assert.deepEqual(parseIngredient("400g can chopped tomatoes"), { quantity: 400, unit: "g", name: "chopped tomatoes", note: "can" });
  assert.deepEqual(parseIngredient("1 small bunch of coriander leaves"), { quantity: 1, unit: "bunch", name: "coriander leaves", note: "small" });
  assert.deepEqual(parseIngredient("2 large eggs"), { quantity: 2, unit: "", name: "large eggs" });
});

test("tricky lines from real recipes", () => {
  assert.deepEqual(parseIngredient("1 stengel(s) prei"), { quantity: 1, unit: "stalk", name: "prei" });
  assert.deepEqual(parseIngredient("2 cm gemberwortel"), { quantity: 2, unit: "cm", name: "gemberwortel" });
  assert.deepEqual(parseIngredient("1 bakje(s) kerstomaten"), { quantity: 1, unit: "tray", name: "kerstomaten" });
  assert.deepEqual(parseIngredient("1 zakje(s) kruidenmix"), { quantity: 1, unit: "pack", name: "kruidenmix" });
  assert.deepEqual(parseIngredient("1 doosje(s) eieren"), { quantity: 1, unit: "doosje", name: "eieren" });
  assert.deepEqual(parseIngredient("2 x 400 g tomatenblokjes"), { quantity: 800, unit: "g", name: "tomatenblokjes" });
  assert.deepEqual(parseIngredient("1.000 g bloem"), { quantity: 1000, unit: "g", name: "bloem" });
  assert.deepEqual(parseIngredient("1.5 kg bloem"), { quantity: 1.5, unit: "kg", name: "bloem" });
  assert.deepEqual(parseIngredient("5-kruidenpoeder"), { quantity: null, unit: "", name: "5-kruidenpoeder" });
  assert.deepEqual(parseIngredient("1 (400 g) can tomatoes"), { quantity: 1, unit: "can", name: "tomatoes", note: "400 g" });
  assert.deepEqual(parseIngredient("0 g suiker"), { quantity: null, unit: "", name: "g suiker" });
});

test("editor text keeps exact quantities", () => {
  const ings = [
    { quantity: 233, unit: "g", name: "a" },
    { quantity: 12.5, unit: "g", name: "b" },
    { quantity: 0.125, unit: "tsp", name: "c" },
    { quantity: 0.03, unit: "l", name: "d" },
    { quantity: 1.5, unit: "tbsp", name: "e" },
    { quantity: null, unit: "can", name: "bonen" },
  ];
  const text = formatIngredientsText(ings);
  assert.equal(text, "233 g a\n12.5 g b\n0.125 tsp c\n0.03 l d\n1½ tbsp e\nbonen");
  assert.deepEqual(parseIngredientsText(text).map((i) => i.quantity), [233, 12.5, 0.125, 0.03, 1.5, null]);
});

test("a word that is not a unit stays part of the name", () => {
  assert.deepEqual(parseIngredient("1 ui"), { quantity: 1, unit: "", name: "ui" });
  assert.deepEqual(parseIngredient("2 grote wortels"), { quantity: 2, unit: "", name: "grote wortels" });
});

test("ingredients text round-trips including pantry section", () => {
  const text = "200 g Kipfilet\n1 Rode ui\n\nPantry:\n2 tbsp Olijfolie\nPeper en zout (naar smaak)";
  const parsed = parseIngredientsText(text);
  assert.equal(parsed.length, 4);
  assert.equal(parsed[2].pantry, true);
  assert.equal(parsed[0].pantry, undefined);
  assert.equal(formatIngredientsText(parsed), text);
});

test("formats quantities nicely", () => {
  assert.equal(formatQuantity(0.5), "½");
  assert.equal(formatQuantity(1.5), "1½");
  assert.equal(formatQuantity(2), "2");
  assert.equal(formatQuantity(0.3333), "⅓");
  assert.equal(formatQuantity(2.4), "2.4");
  assert.equal(formatQuantity(12.4), "12");
  assert.equal(formatQuantity(233.3), "235");
});

test("scales ingredients", () => {
  const scaled = scaleIngredients([{ quantity: 100, unit: "g", name: "rijst" }, { quantity: null, unit: "", name: "zout" }], 1.5);
  assert.equal(scaled[0].quantity, 150);
  assert.equal(scaled[1].quantity, null);
});

test("builds an aggregated shopping list", () => {
  const list = buildShoppingList(
    [
      { recipe: "Curry", ingredients: [
        { quantity: 1, unit: "", name: "Rode ui" },
        { quantity: 500, unit: "g", name: "Kipfilet" },
        { quantity: 2, unit: "tbsp", name: "Olijfolie", pantry: true },
      ] },
      { recipe: "Pasta", ingredients: [
        { quantity: 2, unit: "", name: "rode  ui" },
        { quantity: 0.6, unit: "kg", name: "kipfilet" },
        { quantity: 1, unit: "can", name: "Kipfilet" },
        { quantity: null, unit: "", name: "Zout" },
      ] },
    ],
    ["zout"],
  );
  const byKey = Object.fromEntries(list.map((i) => [i.key, i]));
  assert.equal(byKey["rode ui"].amountText, "3");
  assert.deepEqual(byKey["rode ui"].recipes, ["Curry", "Pasta"]);
  assert.equal(byKey["kipfilet"].amountText, "1.1 kg + 1 can");
  assert.equal(buildShoppingList([{ recipe: "x", ingredients: [{ quantity: 4, unit: "slice", name: "Spek" }] }])[0].amountText, "4 slices");
  assert.equal(byKey["olijfolie"].pantry, true);
  assert.equal(byKey["zout"].pantry, true);
  assert.equal(byKey["zout"].amountText, "");
  assert.equal(byKey["kipfilet"].pantry, false);
});
