"use strict";

// Alle tekster fra databasen sættes med textContent (via h), aldrig som HTML.

const cfg = window.ARV_CONFIG || {};
const root = document.getElementById("app");

const state = {
  session: null,
  me: null,
  phase: "voting",
  items: [],
  votes: [],
  results: [],
  people: [],
  thumbs: new Map(),
  full: new Map(),
  progress: [],
  view: "main",
  filter: null,
  place: null,
  mode: loadMode(),
  queue: null,
  cursor: null,
  uploadReport: null,
  loadedAt: 0,
};

let db = null;

// ---------------------------------------------------------------- hjælpere

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") el.className = value;
    else if (key === "text") el.textContent = value;
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (value === true) el.setAttribute(key, "");
    else if (value !== false && value != null) el.setAttribute(key, value);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

function joinDa(names) {
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", ")} og ${names[names.length - 1]}`;
}

const nameOf = (id) => state.people.find((p) => p.id === id)?.display_name ?? "Ukendt";
const pad3 = (n) => String(n).padStart(3, "0");
const noLabel = (item) => (item.item_no != null ? `Nr. ${pad3(item.item_no)}` : "");

// Sorterer efter nummer (ting uden nummer sidst), derefter oprettelsestid.
function byNumber(a, b) {
  if ((a.item_no == null) !== (b.item_no == null)) return a.item_no == null ? 1 : -1;
  if (a.item_no !== b.item_no && a.item_no != null) return a.item_no - b.item_no;
  return String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id));
}

// "001 Lager kasse 01.jpeg" -> { itemNo: 1, place: "Lager kasse 01" }
function parseName(fileName) {
  const m = /^(\d+)\s+(.+?)\s*\.(jpe?g|png|heic)$/i.exec(fileName);
  const stem = fileName.replace(/\.[^.]+$/, "");
  if (!m) return { itemNo: null, place: "", title: stem };
  const itemNo = parseInt(m[1], 10);
  if (!Number.isSafeInteger(itemNo) || itemNo > 2147483647) return { itemNo: null, place: "", title: stem };
  return { itemNo, place: m[2].trim(), title: `Nr. ${pad3(itemNo)}` };
}

const myVote = (itemId) => state.votes.find((v) => v.item_id === itemId && v.user_id === state.me.id);

async function must(promise) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}

function explain(err) {
  const msg = err?.message || String(err);
  if (/invalid login/i.test(msg)) return "Forkert brugernavn eller kodeord.";
  if (/failed to fetch|network/i.test(msg)) return "Kunne ikke få forbindelse. Prøv igen om lidt.";
  return msg;
}

function fail(err) {
  console.error(err);
  alert(explain(err));
}

// ---------------------------------------------------------------- data

// Supabase svarer højst 1.000 rækker pr. kald, så store tabeller hentes i sider.
async function fetchAll(table, orders) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    let q = db.from(table).select("*");
    for (const [col, opts] of orders) q = q.order(col, opts);
    const page = await must(q.range(from, from + 999));
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

async function signThumbs(paths) {
  const map = new Map();
  for (let i = 0; i < paths.length; i += 200) {
    const signed = await must(db.storage.from("items").createSignedUrls(paths.slice(i, i + 200), 3600));
    for (const s of signed) if (s.signedUrl) map.set(s.path, s.signedUrl);
  }
  return map;
}

// Det store billede signeres først, når lysboksen åbnes, og huskes i en time.
async function fullUrl(item) {
  const hit = state.full.get(item.image_path);
  if (hit && Date.now() - hit.at < 50 * 60 * 1000) return hit.url;
  const { data, error } = await db.storage.from("items").createSignedUrl(item.image_path, 3600);
  if (error || !data?.signedUrl) throw error || new Error("Intet link");
  state.full.set(item.image_path, { url: data.signedUrl, at: Date.now() });
  return data.signedUrl;
}

async function load() {
  const [people, items, votes, results, portal, progress] = await Promise.all([
    must(db.from("profiles").select("*")),
    fetchAll("items", [["item_no", { ascending: true, nullsFirst: false }], ["created_at", {}], ["id", {}]]),
    fetchAll("votes", [["item_id", {}], ["user_id", {}]]),
    fetchAll("results", [["item_id", {}]]),
    must(db.from("portal_state").select("*").single()),
    must(db.rpc("voting_progress")),
  ]);
  state.people = people;
  state.items = items.sort(byNumber);
  state.votes = votes;
  state.results = results;
  state.phase = portal.phase;
  state.progress = progress;
  state.me = people.find((p) => p.id === state.session.user.id) ?? null;

  state.thumbs = await signThumbs(items.map((i) => i.thumb_path));
  state.full = new Map();
  if (state.place && !items.some((i) => i.place === state.place)) state.place = null;
  state.loadedAt = Date.now();
}

async function refresh() {
  try {
    await load();
    render();
  } catch (err) {
    showError(err);
  }
}

function showError(err) {
  console.error(err);
  root.replaceChildren(
    h("main", {},
      h("p", { class: "loading error", text: explain(err) }),
      h("p", { class: "loading" }, h("button", { text: "Prøv igen", onclick: refresh }))));
}

// ---------------------------------------------------------------- login

// Arvingerne har brugernavne; kontoen i Supabase har en adresse, der ikke modtager post.
// "Anna Marie" -> "anna.marie@arv.kristoffer.dk". Med @ i bruges teksten som e-mail (admin).
const USER_DOMAIN = "arv.kristoffer.dk";
const FORGOT_TO = "app@kristoffer.dk";

function loginEmail(input) {
  const raw = input.trim();
  if (raw.includes("@")) return raw;
  const slug = raw.toLowerCase()
    .replace(/æ/g, "ae").replace(/ø/g, "oe").replace(/å/g, "aa")
    .replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");
  return `${slug}@${USER_DOMAIN}`;
}

function renderLogin(message) {
  const email = h("input", { type: "text", name: "username", autocomplete: "username", autocapitalize: "none", spellcheck: "false", required: true });
  const password = h("input", { type: "password", name: "password", autocomplete: "current-password", required: true });
  const error = h("p", { class: "error small", hidden: !message, role: "alert", text: message || "" });
  const submit = h("button", { class: "primary", type: "submit", text: "Log ind" });

  const form = h("form", {
    class: "login",
    onsubmit: async (event) => {
      event.preventDefault();
      submit.disabled = true;
      error.hidden = true;
      const { error: err } = await db.auth.signInWithPassword({
        email: loginEmail(email.value),
        password: password.value,
      });
      if (err) {
        error.textContent = explain(err);
        error.hidden = false;
        submit.disabled = false;
      }
    },
  },
    h("h1", { text: "Arveportal" }),
    h("p", { class: "muted", text: "Log ind med den konto, du har fået." }),
    h("label", {}, "Brugernavn", email),
    h("label", {}, "Kodeord", password),
    error,
    submit,
    h("p", { class: "small muted forgot" },
      "Glemt kodeordet? ",
      h("a", {
        href: `mailto:${FORGOT_TO}?subject=${encodeURIComponent("Glemt kodeord til Arveportalen")}`,
        onclick: (event) => {
          const who = email.value.trim();
          if (who) event.currentTarget.href = `mailto:${FORGOT_TO}?subject=${encodeURIComponent(`Glemt kodeord til Arveportalen (${who})`)}`;
        },
        text: `Skriv til ${FORGOT_TO}`,
      }),
      "."));

  root.replaceChildren(h("div", { class: "login-wrap" }, form));
  email.focus();
}

// ---------------------------------------------------------------- fælles dele

function header() {
  const nav = h("nav", {});
  if (state.me?.is_admin) {
    const admin = state.view === "admin";
    nav.append(h("button", {
      text: admin ? "Til tingene" : "Administration",
      onclick: () => { state.view = admin ? "main" : "admin"; render(); window.scrollTo(0, 0); },
    }));
  }
  nav.append(
    h("button", { class: "link", text: "Skift kodeord", onclick: openPasswordDialog }),
    h("button", { class: "link", text: "Log ud", onclick: () => db.auth.signOut() }));
  return h("header", { class: "top" },
    h("h1", { text: "Arveportal" }),
    h("span", { class: "who", text: state.me?.display_name ?? "" }),
    nav);
}

function photo(item) {
  return h("button", {
    class: "photo",
    type: "button",
    "aria-label": `Vis ${itemName(item)} større`,
    onclick: () => openLightbox(item),
  }, h("img", { src: state.thumbs.get(item.thumb_path), alt: itemName(item), loading: "lazy" }));
}

// Nummer og sted i klar tekst, uden at gentage nummeret, hvis titlen allerede er det.
function itemName(item) {
  return [noLabel(item) && !item.title.startsWith("Nr. ") ? noLabel(item) : "", item.title, item.place]
    .filter(Boolean).join(" · ");
}

function itemHead(item) {
  const auto = item.item_no != null && item.title === noLabel(item);
  return [
    h("h3", { text: item.title }),
    item.item_no != null || item.place
      ? h("p", { class: "place small", text: [auto ? "" : noLabel(item), item.place].filter(Boolean).join(" · ") })
      : null,
  ];
}

function openLightbox(item) {
  const img = h("img", { src: state.thumbs.get(item.thumb_path), alt: itemName(item), class: "loading" });
  const note = h("span", { class: "lightbox-title small", text: "Henter billedet …" });
  const dialog = h("dialog", {
    onclose: () => dialog.remove(),
    onclick: (e) => { if (e.target === dialog || e.target.tagName === "IMG") dialog.close(); },
  },
    h("div", { class: "lightbox-inner" },
      img,
      h("span", { class: "lightbox-title", text: itemName(item) }),
      note,
      h("button", { text: "Luk", onclick: () => dialog.close() })));
  document.body.append(dialog);
  dialog.showModal();
  fullUrl(item).then((url) => {
    img.addEventListener("load", () => { img.classList.remove("loading"); note.hidden = true; }, { once: true });
    img.src = url;
  }).catch((err) => {
    console.error(err);
    note.textContent = "Det store billede kunne ikke hentes.";
  });
}

function openPasswordDialog() {
  const pw1 = h("input", { type: "password", autocomplete: "new-password", minlength: "8", required: true });
  const pw2 = h("input", { type: "password", autocomplete: "new-password", minlength: "8", required: true });
  const error = h("p", { class: "error small", hidden: true, role: "alert" });
  const dialog = h("dialog", { class: "pw-dialog", onclose: () => dialog.remove() },
    h("form", {
      onsubmit: async (event) => {
        event.preventDefault();
        error.hidden = true;
        if (pw1.value !== pw2.value) {
          error.textContent = "De to kodeord er ikke ens.";
          error.hidden = false;
          return;
        }
        const { error: err } = await db.auth.updateUser({ password: pw1.value });
        if (err) {
          error.textContent = explain(err);
          error.hidden = false;
          return;
        }
        dialog.close();
        alert("Dit kodeord er skiftet.");
      },
    },
      h("h2", { text: "Skift kodeord" }),
      h("label", {}, "Nyt kodeord (mindst 8 tegn)", pw1),
      h("label", {}, "Gentag kodeord", pw2),
      error,
      h("div", { class: "pw-actions" },
        h("button", { type: "button", text: "Annullér", onclick: () => dialog.close() }),
        h("button", { class: "primary", type: "submit", text: "Gem" }))));
  document.body.append(dialog);
  dialog.showModal();
}

function segments(options, current, onChange) {
  return h("div", { class: "segments", role: "group", "aria-label": "Filtrér" },
    options.map(([value, label]) => h("button", {
      type: "button",
      "aria-pressed": String(value === current),
      text: label,
      onclick: () => onChange(value),
    })));
}

// ---------------------------------------------------------------- afstemning

// Visningen huskes i browseren; virker storage ikke, er gitteret standard.
function loadMode() {
  try { return localStorage.getItem("arv.mode") === "single" ? "single" : "grid"; } catch { return "grid"; }
}
function saveMode(mode) {
  try { localStorage.setItem("arv.mode", mode); } catch { /* privat vindue o.l. */ }
}

const placeOf = (item) => item.place || "Uden sted";
const placeSort = (a, b) => a.localeCompare(b, "da", { numeric: true });

function votingView() {
  const total = state.items.length;
  if (!total) {
    return [h("p", { class: "empty", text: "Der er ikke lagt nogen ting ind endnu." })];
  }

  const filter = ["all", "yes"].includes(state.filter) ? state.filter : "open";
  const undecided = () => state.items.filter((i) => !myVote(i.id));
  const mineYes = () => state.items.filter((i) => myVote(i.id)?.interested === true);
  const byPlace = (list) => (state.place ? list.filter((i) => i.place === state.place) : list);
  const pick = () => byPlace(filter === "all" ? state.items : filter === "yes" ? mineYes() : undecided());
  const shown = pick();

  const counts = new Map();
  for (const item of state.items) if (item.place) counts.set(item.place, (counts.get(item.place) ?? 0) + 1);
  const places = [...counts.keys()].sort(placeSort);
  const placeSelect = places.length > 1
    ? h("select", {
        class: "place-filter",
        "aria-label": "Filtrér efter sted",
        onchange: (e) => { state.place = e.target.value || null; state.queue = null; render(); },
      },
        h("option", { value: "", text: `Alle steder (${total})` }),
        places.map((p) => h("option", { value: p, text: `${p} (${counts.get(p)})`, selected: p === state.place })))
    : null;

  const count = h("span", { class: "count" });
  const meter = h("progress", { max: String(total), "aria-label": "Fremdrift" });
  const seg = () => segments(
    [["open", `Mangler (${undecided().length})`], ["yes", `Mine ja (${mineYes().length})`], ["all", `Alle (${total})`]],
    filter,
    (value) => { state.filter = value; state.queue = null; render(); });
  const segHolder = h("div", {}, seg());
  const modeSeg = h("div", { class: "segments mode", role: "group", "aria-label": "Visning" },
    [["grid", "Gitter"], ["single", "Én ad gangen"]].map(([value, label]) => h("button", {
      type: "button",
      "aria-pressed": String(state.mode === value),
      text: label,
      onclick: () => { state.mode = value; saveMode(value); state.queue = null; render(); window.scrollTo(0, 0); },
    })));

  // Overskrift pr. kasse med "x af y besvaret", opdateres ved hver stemme.
  const placeCounters = new Map();
  const answeredIn = (place) => {
    const inPlace = state.items.filter((i) => placeOf(i) === place);
    return `${inPlace.filter((i) => myVote(i.id)).length} af ${inPlace.length} besvaret`;
  };

  const updateBar = () => {
    const done = total - undecided().length;
    count.textContent = `${done} af ${total} gennemgået`;
    meter.value = done;
    segHolder.replaceChildren(seg());
    for (const [place, el] of placeCounters) el.textContent = answeredIn(place);
  };
  updateBar();

  const intro = h("div", { class: "notice" },
    h("p", { text: "Markér for hver ting, om du er interesseret. Ingen kan se dine valg, før afstemningen lukker, og du kan ændre dem indtil da." }));
  const bar = h("div", { class: "bar" }, count, meter, segHolder, placeSelect, modeSeg);

  const emptyText = filter === "yes"
    ? "Du har ikke sagt ja til noget her endnu."
    : state.place
      ? "Ingen ting at vise her. Prøv Alle eller et andet sted."
      : "Du har taget stilling til alle tingene. Du kan stadig ændre dine valg under Alle.";

  if (state.mode === "single") return [bar, singleView(shown, updateBar, emptyText)];

  if (!shown.length) return [intro, bar, h("p", { class: "empty", text: emptyText })];

  // Grupperet efter kasse; tingene er allerede sorteret efter nummer.
  const groups = new Map();
  for (const item of shown) {
    const key = placeOf(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const sections = [...groups.keys()].sort(placeSort).map((place) => {
    const counter = h("span", { class: "small muted" });
    placeCounters.set(place, counter);
    return h("section", { class: "group" },
      h("div", { class: "group-head" }, h("h2", { text: place }), counter),
      h("div", { class: "grid" }, groups.get(place).map((item) => voteCard(item, updateBar))));
  });
  updateBar();
  return [intro, bar, ...sections];
}

// Én ting ad gangen. Rækkefølgen fastlåses, når visningen åbnes, så en stemme ikke flytter
// rundt på den (ellers forsvinder tingen under "Mangler", og "Forrige" virker ikke).
let singleKeys = null;
document.addEventListener("keydown", (e) => {
  if (!singleKeys || e.target.closest?.("input, select, textarea, dialog")) return;
  singleKeys(e);
});

function singleView(shown, afterVote, emptyText) {
  if (!state.queue) state.queue = shown.map((i) => i.id);
  const queue = state.queue.map((id) => state.items.find((i) => i.id === id)).filter(Boolean);
  if (!queue.length) { singleKeys = null; return h("p", { class: "empty", text: emptyText }); }

  let pos = Math.max(0, queue.findIndex((i) => i.id === state.cursor));
  if (pos >= queue.length) pos = queue.length - 1;

  const holder = h("div", { class: "single" });
  const show = (index) => {
    pos = index;
    if (pos >= queue.length) {
      state.cursor = null;
      singleKeys = null;
      holder.replaceChildren(h("div", { class: "empty" },
        h("p", { text: "Du er igennem listen." }),
        h("button", { text: "Start forfra", onclick: () => { state.queue = null; state.cursor = null; render(); } })));
      return;
    }
    const item = queue[pos];
    state.cursor = item.id;

    const img = h("img", { src: state.thumbs.get(item.thumb_path), alt: itemName(item), class: "loading" });
    fullUrl(item).then((url) => {
      if (state.cursor !== item.id) return;
      img.addEventListener("load", () => img.classList.remove("loading"), { once: true });
      img.src = url;
    }).catch((err) => console.error(err));
    const next = queue[pos + 1];
    if (next) fullUrl(next).then((url) => { new Image().src = url; }).catch(() => {});

    const card = voteCard(item, () => {
      afterVote();
      setTimeout(() => { if (state.cursor === item.id) show(pos + 1); }, 350);
    }, { bigImage: img });

    let touchX = null;
    card.addEventListener("touchstart", (e) => { touchX = e.touches[0].clientX; }, { passive: true });
    card.addEventListener("touchend", (e) => {
      if (touchX == null) return;
      const dx = e.changedTouches[0].clientX - touchX;
      touchX = null;
      if (dx < -60 && pos < queue.length - 1) show(pos + 1);
      else if (dx > 60 && pos > 0) show(pos - 1);
    });

    holder.replaceChildren(
      h("div", { class: "single-nav" },
        h("button", { type: "button", text: "← Forrige", disabled: pos === 0, onclick: () => show(pos - 1) }),
        h("span", { class: "small muted", text: `${pos + 1} af ${queue.length}` }),
        h("button", { type: "button", text: "Næste →", disabled: pos >= queue.length - 1, onclick: () => show(pos + 1) })),
      card);
    if (holder.isConnected) holder.scrollIntoView({ block: "start" });
  };
  singleKeys = (e) => {
    if (e.key === "ArrowRight" && pos < queue.length - 1) show(pos + 1);
    else if (e.key === "ArrowLeft" && pos > 0) show(pos - 1);
  };
  show(pos);
  return holder;
}

function voteCard(item, afterVote, { bigImage } = {}) {
  const yes = h("button", { class: "yes", type: "button", text: "Interesseret" });
  const no = h("button", { class: "no", type: "button", text: "Ikke interesseret" });
  const paint = () => {
    const vote = myVote(item.id);
    yes.setAttribute("aria-pressed", String(vote?.interested === true));
    no.setAttribute("aria-pressed", String(vote?.interested === false));
  };
  const cast = async (interested) => {
    const previous = myVote(item.id);
    state.votes = state.votes.filter((v) => v !== previous);
    state.votes.push({ item_id: item.id, user_id: state.me.id, interested });
    paint();
    afterVote();
    yes.disabled = no.disabled = true;
    try {
      await must(db.from("votes").upsert(
        { item_id: item.id, user_id: state.me.id, interested, updated_at: new Date().toISOString() },
        { onConflict: "item_id,user_id" }));
    } catch (err) {
      // Typisk at afstemningen er lukket imens, og så skal siden vise det.
      alert("Dit valg blev ikke gemt. Siden hentes igen.");
      console.error(err);
      await refresh();
      return;
    }
    yes.disabled = no.disabled = false;
  };
  yes.addEventListener("click", () => cast(true));
  no.addEventListener("click", () => cast(false));
  paint();

  return h("article", { class: bigImage ? "card big" : "card" },
    bigImage
      ? h("button", { class: "photo", type: "button", "aria-label": `Vis ${itemName(item)} større`, onclick: () => openLightbox(item) }, bigImage)
      : photo(item),
    h("div", { class: "body" },
      itemHead(item),
      item.description ? h("p", { class: "muted small", text: item.description }) : null,
      h("div", { class: "choices" }, yes, no)));
}

// ---------------------------------------------------------------- lukket og resultat

function interestedNames(itemId) {
  return state.votes
    .filter((v) => v.item_id === itemId && v.interested)
    .map((v) => nameOf(v.user_id))
    .sort((a, b) => a.localeCompare(b, "da"));
}

function closedView() {
  return [
    h("div", { class: "notice" },
      h("p", { text: "Afstemningen er lukket. Her kan alle se, hvem der er interesseret i hvad. Lodtrækningen er ikke kørt endnu." })),
    state.items.length
      ? h("div", { class: "grid" }, state.items.map((item) => {
          const names = interestedNames(item.id);
          return h("article", { class: "card" },
            photo(item),
            h("div", { class: "body" },
              itemHead(item),
              h("p", { class: "small", text: names.length ? `Interesserede: ${joinDa(names)}` : "Ingen interesserede" })));
        }))
      : h("p", { class: "empty", text: "Der er ingen ting." }),
  ];
}

function resultLine(result) {
  const names = result.candidates.map(nameOf).sort((a, b) => a.localeCompare(b, "da"));
  if (result.method === "none") return "Ingen var interesserede";
  if (result.method === "single") return "Eneste interesserede";
  return `Trukket lod mellem ${joinDa(names)}`;
}

function drawnView() {
  const filter = state.filter === "mine" ? "mine" : "all";
  const resultFor = (id) => state.results.find((r) => r.item_id === id);
  const mine = state.items.filter((i) => resultFor(i.id)?.winner_id === state.me.id);
  const shown = filter === "mine" ? mine : state.items;

  return [
    h("div", { class: "notice" }, h("p", { text: "Lodtrækningen er kørt, og resultatet er endeligt." })),
    h("div", { class: "bar" },
      segments([["all", `Alle (${state.items.length})`], ["mine", `Mine (${mine.length})`]], filter,
        (value) => { state.filter = value; render(); })),
    shown.length
      ? h("div", { class: "grid" }, shown.map((item) => {
          const result = resultFor(item.id);
          return h("article", { class: "card" },
            photo(item),
            h("div", { class: "body" },
              itemHead(item),
              h("p", { class: "winner", text: result?.winner_id ? nameOf(result.winner_id) : "Ingen modtager" }),
              result ? h("p", { class: "muted small", text: resultLine(result) }) : null));
        }))
      : h("p", { class: "empty", text: "Du har ikke fået nogen af tingene." }),
  ];
}

// ---------------------------------------------------------------- administration

const FULL = { side: 1600, quality: 0.8 };
const THUMB = { side: 480, quality: 0.7 };

function encode(bitmap, { side, quality }) {
  const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  // Tegningen på et lærred fjerner også EXIF, herunder GPS-position.
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Billedet kunne ikke konverteres"))), "image/jpeg", quality));
}

// Ét billede -> det store og miniaturen. Kaster, hvis browseren ikke kan læse filen (fx en video).
async function shrink(file) {
  const bitmap = await createImageBitmap(file);
  try {
    return { full: await encode(bitmap, FULL), thumb: await encode(bitmap, THUMB) };
  } finally {
    bitmap.close();
  }
}

const BULK_LIMIT = 20;

function uploadSection() {
  const list = h("ul", { class: "pending" });
  const summary = h("p", { class: "bulk-summary", role: "status", hidden: true });
  const status = h("p", { class: "small", role: "status" });
  const report = h("div", { class: "report small" });
  const pending = [];

  const showReport = () => {
    const r = state.uploadReport;
    if (!r) { report.replaceChildren(); return; }
    const parts = [`Lagt ind: ${r.added}.`];
    if (r.skipped) parts.push(`Sprunget over, fordi nummeret findes: ${r.skipped}.`);
    if (r.failures.length) parts.push(`Fejlede: ${r.failures.length}.`);
    report.replaceChildren(...[
      h("p", { text: parts.join(" ") }),
      r.failures.length
        ? h("div", {},
            h("p", { text: "Disse filer kunne ikke lægges ind:" }),
            h("ul", { class: "failures" }, r.failures.map((f) => h("li", { text: f }))))
        : null,
    ].filter(Boolean));
  };
  showReport();

  const upload = h("button", { class: "primary", type: "button", text: "Læg ind", hidden: true });

  const paint = () => {
    upload.hidden = pending.length === 0;
    if (pending.length > BULK_LIMIT) {
      const nos = pending.map((e) => e.parsed.itemNo).filter((n) => n != null);
      const unnumbered = pending.length - nos.length;
      const range = nos.length ? `, nr. ${pad3(Math.min(...nos))}-${pad3(Math.max(...nos))}` : "";
      summary.textContent = `${pending.length} billeder valgt${range}`
        + (unnumbered ? ` (${unnumbered} uden nummer i filnavnet)` : "")
        + ". Titel og sted tages fra filnavnene.";
      summary.hidden = false;
      list.replaceChildren();
    } else {
      summary.hidden = true;
      list.replaceChildren(...pending.map((e) => {
        if (!e.row) e.row = editableRow(e);
        return e.row;
      }));
    }
  };

  const editableRow = (entry) => {
    entry.title = h("input", { value: entry.parsed.title, "aria-label": "Navn på tingen", placeholder: "Navn på tingen" });
    entry.description = h("input", { "aria-label": "Beskrivelse", placeholder: "Beskrivelse (valgfri)" });
    return h("li", {},
      h("img", { src: URL.createObjectURL(entry.file), alt: "" }),
      h("div", { class: "fields" },
        entry.parsed.itemNo != null
          ? h("span", { class: "small muted", text: `${noLabel({ item_no: entry.parsed.itemNo })} · ${entry.parsed.place}` })
          : null,
        entry.title, entry.description),
      h("button", {
        type: "button",
        class: "link",
        text: "Fjern",
        onclick: () => { pending.splice(pending.indexOf(entry), 1); paint(); },
      }));
  };

  const picker = h("input", {
    type: "file",
    accept: "image/*",
    multiple: true,
    onchange: () => {
      const files = [...picker.files].sort((a, b) => a.name.localeCompare(b.name, "da", { numeric: true }));
      for (const file of files) pending.push({ file, parsed: parseName(file.name), title: null, description: null, row: null });
      picker.value = "";
      paint();
    },
  });

  upload.addEventListener("click", async () => {
    const bulk = pending.length > BULK_LIMIT;
    if (!bulk && pending.some((e) => !e.title.value.trim())) {
      status.textContent = "Alle ting skal have et navn.";
      return;
    }
    upload.disabled = picker.disabled = true;
    const entries = [...pending];
    const report0 = { added: 0, skipped: 0, failures: [] };
    state.uploadReport = null;
    showReport();

    let known;
    try {
      known = new Set((await fetchAll("items", [["id", {}]])).map((i) => i.item_no).filter((n) => n != null));
    } catch (err) {
      fail(err);
      upload.disabled = picker.disabled = false;
      return;
    }

    let processed = 0;
    const tick = () => { status.textContent = `${processed} af ${entries.length}`; };
    tick();

    const one = async (entry) => {
      const { itemNo, place } = entry.parsed;
      if (itemNo != null) {
        if (known.has(itemNo)) { report0.skipped++; return; }
        known.add(itemNo); // også mod dubletter i selve valget
      }
      const id = crypto.randomUUID();
      const paths = [`${id}.jpg`, `thumb/${id}.jpg`];
      let stored = false;
      try {
        const { full, thumb } = await shrink(entry.file);
        stored = true;
        await must(db.storage.from("items").upload(paths[0], full, { contentType: "image/jpeg" }));
        await must(db.storage.from("items").upload(paths[1], thumb, { contentType: "image/jpeg" }));
        await must(db.from("items").insert({
          title: bulk ? entry.parsed.title : entry.title.value.trim(),
          description: bulk ? "" : entry.description.value.trim(),
          item_no: itemNo,
          place,
          image_path: paths[0],
          thumb_path: paths[1],
        }));
        report0.added++;
      } catch (err) {
        console.error(entry.file.name, err);
        if (itemNo != null) known.delete(itemNo);
        if (stored) await db.storage.from("items").remove(paths).catch(() => {});
        report0.failures.push(entry.file.name);
      }
    };

    // Tre ad gangen; en fejl stopper ikke de andre.
    const queue = [...entries];
    const worker = async () => {
      while (queue.length) {
        await one(queue.shift());
        processed++;
        tick();
      }
    };
    await Promise.all([worker(), worker(), worker()]);

    state.uploadReport = report0;
    upload.disabled = picker.disabled = false;
    await refresh();
  });

  return h("section", { class: "section" },
    h("h2", { text: "Tilføj ting" }),
    h("p", { class: "muted small", text: "Billederne gøres mindre og får fjernet GPS-position, før de lægges op. Navne som \"001 Lager kasse 01.jpeg\" giver nummer og sted. Filer, hvis nummer allerede findes, springes over, så en afbrudt indlægning kan tages op igen ved at vælge mappen igen." }),
    picker, summary, list, upload, status, report);
}

function progressSection() {
  return h("section", { class: "section" },
    h("h2", { text: "Hvor langt er folk?" }),
    h("table", { class: "table" },
      h("tbody", {}, state.progress.map((p) =>
        h("tr", {},
          h("td", { text: p.display_name }),
          h("td", { text: `${p.voted} af ${p.total}` }))))));
}

function phaseSection() {
  const act = (fn) => async () => {
    try {
      await must(db.rpc(fn));
      state.filter = null;
      await refresh();
    } catch (err) {
      fail(err);
    }
  };
  const close = act("close_voting");
  const reopen = act("reopen_voting");
  const draw = act("run_draw");

  const missing = state.progress.filter((p) => p.voted < p.total);
  const buttons = [];
  if (state.phase === "voting") {
    buttons.push(h("button", {
      class: "primary",
      text: "Luk afstemningen",
      onclick: () => {
        const warn = missing.length
          ? `${joinDa(missing.map((p) => p.display_name))} er ikke færdig. Ting uden svar tæller som ikke interesseret.\n\n`
          : "";
        if (confirm(`${warn}Luk afstemningen? Alle kan derefter se, hvem der er interesseret i hvad.`)) close();
      },
    }));
  } else if (state.phase === "closed") {
    buttons.push(
      h("button", {
        class: "primary",
        text: "Træk lod",
        onclick: () => {
          if (confirm("Træk lod om alle ting nu? Det kan kun gøres én gang og kan ikke fortrydes.")) draw();
        },
      }),
      h("button", {
        text: "Genåbn afstemningen",
        onclick: () => { if (confirm("Genåbn afstemningen? Stemmerne bliver skjult igen.")) reopen(); },
      }));
  } else {
    buttons.push(h("button", { text: "Hent resultat som regneark", onclick: downloadCsv }));
  }

  const label = { voting: "Afstemningen er åben.", closed: "Afstemningen er lukket. Lodtrækningen er ikke kørt.", drawn: "Lodtrækningen er kørt." };
  return h("section", { class: "section" },
    h("h2", { text: "Afstemning" }),
    h("p", { text: label[state.phase] }),
    h("div", { class: "actions" }, buttons));
}

function itemsSection() {
  const canEdit = state.phase === "voting";
  return h("section", { class: "section" },
    h("h2", { text: `Tingene (${state.items.length})` }),
    h("ul", { class: "rows" }, state.items.map((item) =>
      h("li", {},
        h("img", { src: state.thumbs.get(item.thumb_path), alt: "", loading: "lazy" }),
        h("span", { class: "grow", text: itemName(item) }),
        canEdit ? h("button", {
          class: "danger",
          text: "Slet",
          onclick: async () => {
            if (!confirm(`Slet "${itemName(item)}"? Stemmer på den forsvinder også.`)) return;
            try {
              await must(db.from("items").delete().eq("id", item.id));
              await must(db.storage.from("items").remove([item.image_path, item.thumb_path]));
              await refresh();
            } catch (err) {
              fail(err);
            }
          },
        }) : null))));
}

function csvCell(value) {
  let text = String(value ?? "");
  // Forhindrer, at Excel læser en titel som en formel.
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv() {
  const method = { draw: "Lodtrækning", single: "Eneste interesserede", none: "Ingen interesserede" };
  const rows = [["Nr.", "Ting", "Sted", "Beskrivelse", "Modtager", "Måde", "Interesserede"]];
  for (const item of state.items) {
    const result = state.results.find((r) => r.item_id === item.id);
    rows.push([
      item.item_no ?? "",
      item.title,
      item.place,
      item.description,
      result?.winner_id ? nameOf(result.winner_id) : "",
      result ? method[result.method] : "",
      result ? result.candidates.map(nameOf).join(", ") : "",
    ]);
  }
  // Semikolon og BOM, så dansk Excel åbner filen rigtigt.
  const csv = "﻿" + rows.map((r) => r.map(csvCell).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = h("a", { href: url, download: "arveportal-resultat.csv" });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function adminView() {
  return [
    phaseSection(),
    state.phase === "voting" ? uploadSection() : null,
    state.phase === "voting" ? progressSection() : null,
    itemsSection(),
  ];
}

// ---------------------------------------------------------------- opstart

function render() {
  singleKeys = null;
  if (!state.me) {
    root.replaceChildren(h("main", {},
      h("p", { class: "loading error", text: "Din konto har ingen profil. Kontakt administratoren." }),
      h("p", { class: "loading" }, h("button", { text: "Log ud", onclick: () => db.auth.signOut() }))));
    return;
  }
  let content;
  if (state.view === "admin" && state.me.is_admin) content = adminView();
  else if (state.phase === "voting") content = votingView();
  else if (state.phase === "closed") content = closedView();
  else content = drawnView();
  root.replaceChildren(header(), h("main", {}, content));
}

function start() {
  if (!cfg.url || !cfg.anonKey) {
    root.replaceChildren(h("p", { class: "loading", text: "Siden er ikke sat op endnu (config.js mangler Supabase-oplysninger)." }));
    return;
  }
  db = window.supabase.createClient(cfg.url, cfg.anonKey);

  db.auth.onAuthStateChange((event, session) => {
    // Supabase må ikke kaldes direkte inde i denne callback (den kan låse sig), derfor setTimeout.
    setTimeout(async () => {
      const wasUser = state.session?.user?.id;
      state.session = session;
      if (!session) {
        state.me = null;
        state.view = "main";
        state.filter = null;
        state.queue = null;
        state.cursor = null;
        singleKeys = null;
        renderLogin();
      } else if (session.user.id !== wasUser) {
        await refresh();
      }
    }, 0);
  });

  // Signerede billedlinks udløber efter en time.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.session && Date.now() - state.loadedAt > 50 * 60 * 1000) refresh();
  });
}

start();
