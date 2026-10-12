// Derive filterable facts from a recipe: main protein(s), course, "healthy" and "easy".
// Heuristics over ingredient names (Dutch + English), tags and title – good enough to filter on,
// and computed on the fly so improvements apply to every recipe already in the database.

import type { Ingredient } from "./ingredients.ts";

export type Protein = "poultry" | "beef" | "pork" | "lamb" | "fish" | "seafood" | "vegetarian";
export type Course = "main" | "dessert" | "kamado";

export interface RecipeFacts {
  proteins: Protein[];
  course: Course;
  healthy: boolean;
  easy: boolean;
  childFriendly: boolean;
}

interface Classifiable {
  title: string;
  tags: string[];
  ingredients: Ingredient[];
  steps: string[];
  totalMinutes: number | null;
  servings: number;
}

const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Matches any of `prefixes` at the start of a word, any of `words` as a whole word, or any of `suffixes`
 * at the end of a word (Dutch compounds put the meat last: hoevekip, ontbijtspek, braadworst).
 */
function matcher(prefixes: string[], words: string[] = [], suffixes: string[] = []): RegExp {
  const parts = [];
  if (prefixes.length) parts.push(`(?:^|[^a-z])(?:${prefixes.join("|")})`);
  if (words.length) parts.push(`(?:^|[^a-z])(?:${words.join("|")})(?:$|[^a-z])`);
  if (suffixes.length) parts.push(`(?:${suffixes.join("|")})(?:$|[^a-z])`);
  return new RegExp(parts.join("|"));
}

const MEAT: [Exclude<Protein, "vegetarian">, RegExp][] = [
  ["poultry", matcher(["kip", "kippe", "poulet", "chicken", "kalkoen", "turkey", "eend", "duck", "parelhoen", "kwartel", "fazant", "hoen"], [], ["kip", "kippen", "kippenbouten", "eendenborst"])],
  ["pork", matcher(
    ["varken", "pork", "spek", "pancetta", "chorizo", "worst", "sausage", "bacon", "prosciutto", "parmaham", "serranoham", "guanciale", "salami", "lardon", "nduja", "'nduja", "hesp", "ribbetjes", "spareribs", "spare ribs", "hamblokjes", "beenham", "gyros", "mortadella", "coppa", "lomo", "jambon", "chipolata", "cervela", "boudin", "salsiccia", "cotechino", "kassler", "iberico", "secreto", "pluma", "presa", "procureur", "ribfinger", "sjasliek", "shaslick", "schaslik", "hammetje", "hot dog", "hotdog", "frikandel"],
    ["ham", "hammen"],
    ["spek", "spekjes", "worst", "worsten", "worstjes", "ham", "hesp", "hotdog", "hotdogs"],
  )],
  ["lamb", matcher(["lams", "lamb", "mutton", "merguez", "schaap", "geit"], ["lam"])],
  ["beef", matcher(["rund", "runder", "biefstuk", "entrecote", "ribeye", "rib-eye", "ossenstaart", "ossenwang", "beef", "veal", "kalf", "kalfs", "brisket", "bavette", "onglet", "rosbief", "steak tartare", "konijn", "rabbit", "hert", "venison", "everzwijn", "wild zwijn", "paard", "cote de boeuf", "boeuf", "picanha", "tri-tip", "tritip", "t-bone", "tournedos", "short rib", "shortrib", "galbi", "bulgogi", "wagyu", "skirt", "flank", "sukade", "diamanthaas", "tomahawk", "striploin", "chuck", "prime rib", "ossobuco", "hanger steak", "dry aged", "denver steak", "rib roast", "pastrami", "maminha", "fraldinha", "sudderlap", "bavet", "onglet", "hamburger"])],
  ["fish", matcher(
    ["zalm", "kabeljauw", "tonijn", "heek", "schelvis", "forel", "makreel", "sardien", "sardine", "ansjovis", "anchov", "zeebaars", "dorade", "tarbot", "tongfilet", "pladijs", "rogvleugel", "zeeduivel", "griet", "steenbolk", "hondshaai", "wijting", "koolvis", "haring", "snoekbaars", "paling", "visfilet", "witvis", "salmon", "cod", "tuna", "haddock", "trout", "mackerel", "sea bass", "seabass", "bream", "halibut", "hake", "monkfish", "plaice", "fish", "pollock", "swordfish", "zwaardvis", "tilapia", "pangasius", "skrei", "bokking", "sprot", "rode poon", "zeetong", "kingfish", "mahi"],
    ["vis", "tong", "rog", "sole", "skate"],
    ["zalm", "zalmfilet", "zalmfilets", "kabeljauw", "tonijn", "forel", "makreel", "baars", "tong", "vis"],
  )],
  ["seafood", matcher(["garna", "scampi", "mossel", "oester", "sint-jakob", "jakobsschelp", "coquille", "inktvis", "octopus", "kreeft", "krab", "rivierkreeft", "langoustine", "gamba", "prawn", "shrimp", "mussel", "clam", "squid", "scallop", "crab", "lobster", "zeekat", "calamar", "vongole", "kokkel", "cockle", "oyster", "zeevruchten", "seafood"], [], ["garnalen", "garnaaltjes", "mosselen", "scampi", "inktvis", "inktvissen"])],
];
// Minced meat, steak and burgers are beef unless the line names another animal ("lamb mince").
const GENERIC_BEEF = matcher(["gehakt", "steak", "hamburger", "stoofvlees", "carpaccio", "mince"], ["burger", "burgers"]);
// Stock, sauces and gelatine make a dish non-vegetarian without being its protein.
const FLAVOURING = /bouillon|fond(?:$|[^a-z])|stock|saus(?:$|[^a-z])|sauce|blokje|cube|(?:^|[^a-z])jus(?:$|[^a-z])|dashi|gelatine|extract|vet(?:$|[^a-z])|reuzel|lard(?:$|[^a-z])|dripping/;
// Look-alikes: sea aster, rye bread, champignons are caught by word boundaries; these are compounds.
const NOT_MEAT = /lamsoor|vegetarisch|vegan|plantaardig|meatier|beyond|vega |vegetarian|kipkruiden|chicken seasoning|kippenkruiden|or (?:vegetable|veggie|vegan)|of groente|veggie/;
// Buns and breads named after what goes in them ("hamburgerbroodjes") are not meat.
const BREAD = /brood|broodje|bun(?:s)?(?:$|[^a-z])|bread/;

export function proteinsOf(ingredients: Ingredient[]): Protein[] {
  const found = new Set<Protein>();
  let meatAnywhere = false;
  for (const ing of ingredients) {
    const name = normalize(ing.name);
    if (NOT_MEAT.test(name) || BREAD.test(name)) continue;
    const hits = MEAT.filter(([, re]) => re.test(name)).map(([p]) => p);
    if (hits.length === 0 && GENERIC_BEEF.test(name)) hits.push("beef");
    if (hits.length === 0) continue;
    meatAnywhere = true;
    if (FLAVOURING.test(name)) continue;
    for (const p of hits) found.add(p);
  }
  if (!meatAnywhere) return ["vegetarian"];
  const order: Protein[] = ["poultry", "beef", "pork", "lamb", "fish", "seafood"];
  return order.filter((p) => found.has(p));
}

const DESSERT_TAG = /^(dessert|desserts|nagerecht|nagerechten|zoet|sweet|gebak|baking|cake|cakes|pudding|puddings|ijs|taart|taarten|koekjes|cookies)$/;
const DESSERT_TITLE = matcher(
  ["tiramisu", "mousse au chocolat", "chocolademousse", "panna cotta", "pannacotta", "crumble", "sorbet", "brownie", "cheesecake", "clafoutis", "creme brulee", "tarte tatin", "pudding", "roomijs", "ijsje", "cupcake", "muffin", "cookie", "koekje", "fudge", "meringue", "pavlova", "eclair", "profiterole", "chocoladetaart", "appeltaart", "rijsttaart", "frangipane", "sabayon", "tartelette", "trifle", "baklava", "churros", "flan"],
  ["cake", "ijs", "dessert", "macaron", "macarons", "zoete pannenkoeken", "suikerwafels"],
  ["appelcake", "notencake", "bananencake", "citroencake", "chocoladecake", "worteltaart", "kwarktaart", "appeltaart", "rijsttaart", "fruittaart", "fruittaartje", "rijstpap", "-ijs", "mousse"],
);

export function courseOf(title: string, tags: string[]): Course {
  // Kamado (BBQ) recipes are their own section, whether they are a main or a dessert.
  if (tags.some((t) => /^kamado/.test(normalize(t)))) return "kamado";
  if (tags.some((t) => DESSERT_TAG.test(normalize(t)))) return "dessert";
  // Only the dish itself counts, not its garnish: "Broccolisoep met ... crumble van walnoten" is soup.
  const head = normalize(title).split(/ (?:met|with|en|and|op|on|in|van|of|served) |, /)[0];
  return DESSERT_TITLE.test(head) ? "dessert" : "main";
}

const VEG = matcher([
  "broccoli", "courgette", "zucchini", "paprika", "pepper", "spinazie", "spinach", "sla", "lettuce", "tomaat", "tomaten", "tomato", "wortel", "carrot", "prei", "leek", "bloemkool", "cauliflower", "kool", "cabbage", "venkel", "fennel", "aubergine", "asperge", "asparagus", "boon", "bonen", "bean", "erwt", "pea", "linze", "lentil", "kikkererwt", "chickpea", "spruit", "sprout", "witloof", "chicory", "endive", "selder", "celery", "celeriac", "biet", "beet", "pompoen", "squash", "pumpkin", "champignon", "mushroom", "paddenstoel", "shiitake", "oesterzwam", "rucola", "rocket", "komkommer", "cucumber", "avocado", "kale", "boerenkool", "paksoi", "pak choi", "bok choy", "radijs", "radish", "artisjok", "artichoke", "postelein", "veldsla", "waterkers", "watercress", "snijbiet", "chard", "pastinaak", "parsnip", "raap", "turnip", "zoete aardappel", "sweet potato", "groente", "vegetable", "edamame", "quinoa", "bulgur", "peulen", "mangetout", "sugar snap", "kerstomaat", "spitskool", "rode kool", "savooi", "romanesco", "okra",
]);
const CREAM = matcher(["room", "slagroom", "kookroom", "cream", "creme fraiche", "mascarpone", "zure room"], ["crème"]);
const FRIED = matcher(["frituur", "friet", "frieten", "fries", "chips", "deep-fr", "deep fr", "gefrituurd", "paneermeel", "panko"]);
const PASTRY = matcher(["bladerdeeg", "puff pastry", "kruimeldeeg", "shortcrust", "filodeeg", "brick", "croissant"]);
const PROCESSED = matcher(["spek", "bacon", "worst", "sausage", "chorizo", "pancetta", "salami", "hamburger"]);
const BUTTER = matcher(["boter", "butter"], []);
const NOT_BUTTER = /pinda|peanut|noten|nut butter|amandel|almond|cacao|shea|appelstroop/;
const HEALTHY_TAG = /^(healthy|gezond|keto|lowcarb|low carb|low-carb|light|licht|salad|salade|salades|salads|vegan|plant-based|pascale naessens)$/;

function gramsPerServing(ingredients: Ingredient[], test: RegExp, exclude: RegExp | null, servings: number): number {
  let grams = 0;
  for (const i of ingredients) {
    const name = normalize(i.name);
    if (!test.test(name) || (exclude && exclude.test(name)) || i.quantity === null) continue;
    if (i.unit === "g") grams += i.quantity;
    else if (i.unit === "kg") grams += i.quantity * 1000;
    else if (i.unit === "tbsp") grams += i.quantity * 14;
    else if (i.unit === "tsp") grams += i.quantity * 5;
  }
  return grams / Math.max(servings, 1);
}

export function isHealthy(r: Classifiable, course: Course, proteins: Protein[]): boolean {
  const tags = r.tags.map(normalize);
  if (course === "dessert") return false;
  if (tags.some((t) => HEALTHY_TAG.test(t))) return true;
  const names = r.ingredients.map((i) => normalize(i.name));
  const count = (re: RegExp) => names.filter((n) => re.test(n)).length;
  let score = Math.min(count(VEG), 4);
  if (proteins.includes("fish") || proteins.includes("seafood")) score += 1;
  if (count(CREAM)) score -= 2;
  if (count(FRIED)) score -= 2;
  if (count(PASTRY)) score -= 2;
  if (count(PROCESSED)) score -= 1;
  const butter = gramsPerServing(r.ingredients, BUTTER, NOT_BUTTER, r.servings);
  if (butter >= 50) score -= 3;
  else if (butter >= 25) score -= 1;
  return score >= 3;
}

const BASICS = /^(zout|peper|peper en zout|zwarte peper|olie|olijfolie|zonnebloemolie|water|salt|pepper|black pepper|olive oil|oil|sea salt)$/;

export function isEasy(r: Classifiable): boolean {
  const real = r.ingredients.filter((i) => !i.pantry && !BASICS.test(normalize(i.name)));
  if (real.length > 10) return false;
  if (r.steps.length > 8) return false;
  if (r.totalMinutes !== null && r.totalMinutes > 45) return false;
  return true;
}

const KIDS_TAG = /^(kindvriendelijk|kids|kid friendly|kid-friendly|kinderen|voor kinderen|family|family food|family favourites|gezin)$/;
const SPICY = matcher(
  ["chili", "chilli", "chilipeper", "cayenne", "sriracha", "sambal", "harissa", "jalapen", "habanero", "scotch bonnet", "wasabi", "gochujang", "nduja", "'nduja", "piri piri", "piri-piri", "peri peri", "tabasco", "madras", "vindaloo", "chipotle", "rode peper", "groene peper", "chiliflakes", "chilivlokken", "pepervlokken", "pul biber", "urfa", "aleppo", "zhoug", "shatta", "kimchi", "mierikswortel", "horseradish"],
  ["pittig", "pittige", "spicy", "hot", "fiery", "heet"],
);
const RAW = matcher(["tartaar", "tartare", "carpaccio", "ceviche", "sashimi", "oester", "oyster", "rauwe", "raw ", "crudo", "gravad", "poké", "poke bowl", "tataki"]);
const OFFAL = matcher(["lever", "liver", "niertjes", "kidney", "zwezerik", "sweetbread", "hersenen", "foie gras", "pens", "tripe", "tong van", "kalfstong", "ossentong", "bloedworst", "black pudding", "merg", "marrow", "hart van", "slakken", "escargot", "kikkerbil"], [], ["lever", "levertjes", "niertjes", "zwezeriken"]);
const SPIRITS = matcher(["whisky", "whiskey", "bourbon", "cognac", "brandy", "rum", "grappa", "calvados", "amaretto", "jenever", "gin", "vodka", "tequila", "pastis", "pernod", "grand marnier", "cointreau", "limoncello", "kirsch", "armagnac", "porto", "port", "madeira", "marsala", "sherry"]);
const ACQUIRED = matcher(["gorgonzola", "roquefort", "blauwe kaas", "blue cheese", "stilton", "bleu", "ansjovis", "anchov", "haring", "herring", "rolmops"]);
// Dried chilli, flakes and cayenne "to taste" or a pinch can simply be left out for the kids.
const SKIPPABLE_HEAT = matcher(["vlokken", "flakes", "cayenne", "chilipoeder", "chili powder", "chilli powder", "pul biber", "urfa", "aleppo", "piment d'espelette", "tabasco", "sriracha", "sambal"]);
const OPTIONAL = /optional|optioneel|naar smaak|to taste|to serve|om te serveren|extra|garnish|for serving/;

function isSpicy(i: Ingredient): boolean {
  const name = normalize(i.name);
  if (!SPICY.test(name)) return false;
  if (OPTIONAL.test(name) || OPTIONAL.test(normalize(i.note ?? ""))) return false;
  if (SKIPPABLE_HEAT.test(name)) {
    const small = i.quantity === null || i.unit === "pinch" || (i.unit === "tsp" && i.quantity <= 1) || (i.unit === "" && i.quantity <= 1);
    if (small) return false;
  }
  return true;
}
const FAVOURITE = matcher(
  ["spaghetti", "macaroni", "lasagne", "pasta", "penne", "fusilli", "pizza", "burger", "balletjes", "meatball", "gehaktbal", "boulet", "frikandel", "kip met appelmoes", "chicken nugget", "nugget", "fish finger", "vissticks", "fishfinger", "wrap", "taco", "quesadilla", "fajita", "pannenkoek", "pancake", "poffertjes", "wentelteefjes", "friet", "puree", "stoemp", "croque", "tosti", "hotdog", "hot dog", "vol-au-vent", "vol au vent", "stoofvlees", "gehaktbrood", "meatloaf", "fish pie", "shepherd", "cottage pie", "hachis", "mac and cheese", "mac n cheese", "mac & cheese", "macaroni cheese", "rijst met", "nasi", "bami", "omelet", "soep met balletjes", "tomatensoep", "kippensoep", "witloof", "hutsepot", "sausage", "worst", "mosselen", "mussels", "fish and chips", "goujons", "schnitzel", "cordon bleu", "kroket", "croquette", "lasagna", "risotto", "gnocchi", "ravioli", "tortellini", "quiche", "frittata", "pannenkoeken"],
  ["soep", "soup"],
);

export function isChildFriendly(r: Classifiable, course: Course): boolean {
  if (r.tags.some((t) => KIDS_TAG.test(normalize(t)))) return true;
  const title = normalize(r.title);
  const names = r.ingredients.map((i) => normalize(i.name));
  const any = (re: RegExp) => re.test(title) || names.some((n) => re.test(n));
  if (SPICY.test(title) || r.ingredients.some(isSpicy)) return false;
  if (any(RAW) || any(OFFAL) || any(SPIRITS) || any(ACQUIRED)) return false;
  if (course === "dessert" || FAVOURITE.test(title)) return true;
  const real = r.ingredients.filter((i) => !i.pantry && !BASICS.test(normalize(i.name)));
  return real.length <= 12;
}

export function classify(r: Classifiable): RecipeFacts {
  let proteins = proteinsOf(r.ingredients);
  // Ingredient lists are sometimes vague; "Lasagne met ham" is not vegetarian whatever the list says.
  if (proteins[0] === "vegetarian") {
    const fromTitle = proteinsOf([{ quantity: null, unit: "", name: r.title }]);
    if (fromTitle[0] !== "vegetarian") proteins = fromTitle;
  }
  const course = courseOf(r.title, r.tags);
  return {
    proteins,
    course,
    healthy: isHealthy(r, course, proteins),
    easy: isEasy(r),
    childFriendly: isChildFriendly(r, course),
  };
}
