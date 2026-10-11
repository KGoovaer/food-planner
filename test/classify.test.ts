import { test } from "node:test";
import assert from "node:assert/strict";
import { classify } from "../src/classify.ts";
import type { Ingredient } from "../src/ingredients.ts";

const ing = (...names: string[]): Ingredient[] => names.map((name) => ({ quantity: 1, unit: "", name }));
const recipe = (over: Partial<Parameters<typeof classify>[0]>) => ({
  title: "x", tags: [], ingredients: [], steps: ["a"], totalMinutes: 30, servings: 4, ...over,
});

test("proteins from Dutch and English ingredient names", () => {
  assert.deepEqual(classify(recipe({ ingredients: ing("kipfilet", "ui") })).proteins, ["poultry"]);
  assert.deepEqual(classify(recipe({ ingredients: ing("rundergehakt", "spaghetti") })).proteins, ["beef"]);
  assert.deepEqual(classify(recipe({ ingredients: ing("gehakt", "tomaten") })).proteins, ["beef"]);
  assert.deepEqual(classify(recipe({ ingredients: ing("lamb mince", "onion") })).proteins, ["lamb"]);
  assert.deepEqual(classify(recipe({ ingredients: ing("spekblokjes", "witloof", "hesp") })).proteins, ["pork"]);
  assert.deepEqual(classify(recipe({ ingredients: ing("skinless, boneless chicken thighs", "smoked pancetta") })).proteins, ["poultry", "pork"]);
  assert.deepEqual(classify(recipe({ ingredients: ing("kabeljauwfilet", "grijze garnalen") })).proteins, ["fish", "seafood"]);
  assert.deepEqual(classify(recipe({ ingredients: ing("mosselen", "witbier") })).proteins, ["seafood"]);
});

test("vegetarian detection ignores look-alikes but not hidden meat", () => {
  assert.deepEqual(classify(recipe({ ingredients: ing("champignons", "roggebrood", "lamsoor", "tongkaas") })).proteins, ["vegetarian"]);
  assert.deepEqual(classify(recipe({ ingredients: ing("courgette", "kippenbouillon") })).proteins, []); // not veggie, but no main protein
  assert.deepEqual(classify(recipe({ ingredients: ing("rijstnoedels", "fish sauce") })).proteins, []);
  assert.deepEqual(classify(recipe({ ingredients: ing("aubergine", "feta", "groentebouillon") })).proteins, ["vegetarian"]);
});

test("real-world cases: compounds ending in the meat, sausages, buns, alternatives", () => {
  assert.deepEqual(classify(recipe({ ingredients: ing("grote hoevekip", "citroen") })).proteins, ["poultry"]);
  assert.deepEqual(classify(recipe({ ingredients: ing("ontbijtspek", "eieren") })).proteins, ["pork"]);
  assert.deepEqual(classify(recipe({ ingredients: ing("braadworst", "stoemp") })).proteins, ["pork"]);
  assert.deepEqual(classify(recipe({ ingredients: ing("chipolata's", "polenta") })).proteins, ["pork"]);
  assert.deepEqual(classify(recipe({ ingredients: ing("higher-welfare pork sausages", "fennel seeds") })).proteins, ["pork"]);
  assert.deepEqual(classify(recipe({ ingredients: ing("noordzeegarnalen", "tomaten") })).proteins, ["seafood"]);
  assert.deepEqual(classify(recipe({ ingredients: ing("bietburger", "hamburgerbroodjes", "rode biet") })).proteins, ["vegetarian"]);
  assert.deepEqual(classify(recipe({ ingredients: ing("tamarind", "chicken or vegetable stock") })).proteins, ["vegetarian"]);
  assert.deepEqual(classify(recipe({ ingredients: ing("tomatensaus", "mozzarella") })).proteins, ["vegetarian"]);
  assert.deepEqual(classify(recipe({ ingredients: ing("pijlinktvissen", "look") })).proteins, ["seafood"]);
  assert.deepEqual(classify(recipe({ ingredients: ing("salsiccia's", "orzo") })).proteins, ["pork"]);
  assert.deepEqual(classify(recipe({ title: "Lasagne met ham en champignons", ingredients: ing("lasagnevellen", "champignons") })).proteins, ["pork"]);
  assert.deepEqual(classify(recipe({ title: "Bietburger met feta", ingredients: ing("bietburger", "feta") })).proteins, ["vegetarian"]);
  assert.equal(classify(recipe({ title: "Broccolisoep met halloumi en crumble van walnoten" })).course, "main");
  assert.equal(classify(recipe({ title: "Gebakken wittekool met een crumble van noten" })).course, "main");
  assert.equal(classify(recipe({ title: "Zalige appelcake" })).course, "dessert");
  assert.equal(classify(recipe({ title: "Koffie-ijs" })).course, "dessert");
  assert.equal(classify(recipe({ title: "Krokante champignontaart met amandel" })).course, "main");
  assert.equal(classify(recipe({ title: "Taartje met noten", tags: ["gebak"] })).course, "dessert");
  assert.equal(classify(recipe({ title: "Daisy's macaroni cheese" })).course, "main");
  assert.equal(classify(recipe({ title: "Cheesy curry crepes" })).course, "main");
  assert.equal(classify(recipe({ title: "Macarons met framboos" })).course, "dessert");
});

test("course from tags and title", () => {
  assert.equal(classify(recipe({ tags: ["dessert", "ottolenghi"] })).course, "dessert");
  assert.equal(classify(recipe({ tags: ["nagerecht"] })).course, "dessert");
  assert.equal(classify(recipe({ tags: ["kamado", "rund"] })).course, "kamado");
  assert.equal(classify(recipe({ title: "Witte chocolade cheesecake", tags: ["kamado", "dessert"] })).course, "kamado");
  assert.equal(classify(recipe({ title: "Tiramisu met speculoos" })).course, "dessert");
  assert.equal(classify(recipe({ title: "Chocolademousse" })).course, "dessert");
  assert.equal(classify(recipe({ title: "Rodekooltaart met appelen en spek" })).course, "main");
  assert.equal(classify(recipe({ title: "Spaghetti bolognese" })).course, "main");
});

test("healthy heuristic", () => {
  const veg = ing("broccoli", "courgette", "paprika", "spinazie", "zalm", "citroen");
  assert.equal(classify(recipe({ ingredients: veg })).healthy, true);
  assert.equal(classify(recipe({ ingredients: [...veg, ...ing("room", "bladerdeeg", "spek")] })).healthy, false);
  assert.equal(classify(recipe({ ingredients: ing("frietjes", "biefstuk", "bearnaise") })).healthy, false);
  assert.equal(classify(recipe({ tags: ["keto"], ingredients: ing("eieren", "kaas") })).healthy, true);
  assert.equal(classify(recipe({ tags: ["pascale naessens"], ingredients: ing("eieren", "kaas") })).healthy, true);
  assert.equal(classify(recipe({ tags: ["dessert"], ingredients: veg })).healthy, false);
  // 400 g butter for 4 people is not healthy, whatever the vegetables
  assert.equal(classify(recipe({ ingredients: [...veg, { quantity: 400, unit: "g", name: "boter" }] })).healthy, false);
});

test("easy: few ingredients, short method, not too long", () => {
  const pantry = { quantity: 1, unit: "tbsp", name: "olijfolie", pantry: true };
  assert.equal(classify(recipe({ ingredients: [...ing("spaghetti", "gehakt", "tomaten", "ui", "look"), pantry], steps: ["a", "b", "c"], totalMinutes: 40 })).easy, true);
  assert.equal(classify(recipe({ ingredients: ing(...Array.from({ length: 14 }, (_, i) => `x${i}`)) })).easy, false);
  assert.equal(classify(recipe({ ingredients: ing("a", "b"), totalMinutes: 180 })).easy, false);
  assert.equal(classify(recipe({ ingredients: ing("a", "b"), steps: Array(12).fill("s") })).easy, false);
});
