// Strong Gym bestyrelse - dagsordener, referater, forslag og opgaver.
// Data ligger i Firebase (Firestore + Authentication). window.SG_LOCAL bruges kun af den lokale prøvefil.
const LOCAL = window.SG_LOCAL || null;
const CFG = {
  apiKey: "AIzaSyBKRHxd8ip3C4GwsQvPK8m8oUIkdcYGpJM",
  authDomain: "strong-gym-bestyrelse-1.firebaseapp.com",
  projectId: "strong-gym-bestyrelse-1",
  storageBucket: "strong-gym-bestyrelse-1.firebasestorage.app",
  messagingSenderId: "1041448738519",
  appId: "1:1041448738519:web:22370d263235ae98705a92"
};
const SDK = "https://www.gstatic.com/firebasejs/10.12.2/";
const TEMPLATE = ["Godkendelse af referat fra sidste møde", "Opfølgning på opgaver og aftaler", "Økonomi"];
const FOLLOW_UP = "Opfølgning på opgaver og aftaler";
const NOT_TREATED = "Punktet blev ikke behandlet på mødet.";
const ROLES = ["formand", "næstformand", "kasserer", "sekretær", "bestyrelsesmedlem"];

let meetings = {}, tasks = {}, proposals = {}, members = {};
let me = null;            // {email, name, role}
let authState = "loading"; // loading | out | verify | nomember | in | error
let authMsg = "", linkMsg = "";
const S = { cur: null, aDraft: null, mDraft: null, err: "", confirmDel: false, filter: "open", owner: "", importText: "" };
const app = document.getElementById("app");

/* ---------- helpers ---------- */
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clone = o => JSON.parse(JSON.stringify(o));
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
const isAdmin = () => !!me && me.role === "formand";
const editing = () => !!(S.aDraft || S.mDraft);
const cur = () => S.cur ? meetings[S.cur] : null;
const nameOf = email => email ? ((members[email] && members[email].name) || email) : "";
const memberList = () => Object.values(members).sort((a, b) => (a.name || "").localeCompare(b.name || "", "da"));
const meetingTasks = id => Object.values(tasks).filter(t => t.meetingId === id).sort((a, b) => (a.createdAt || "") < (b.createdAt || "") ? -1 : 1);
function today() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function fdate(s, long) {
  if (!s) return "Dato mangler"; const d = new Date(s + "T12:00:00"); if (isNaN(d)) return s;
  return d.toLocaleDateString("da-DK", long ? { weekday: "long", day: "numeric", month: "long", year: "numeric" } : { day: "numeric", month: "short", year: "numeric" });
}
function toast(t) { const el = document.getElementById("toast"); el.textContent = t; el.style.display = "block"; clearTimeout(toast.t); toast.t = setTimeout(() => { el.style.display = "none"; }, 3000); }
function view() { const h = location.hash; return h === "#opgaver" ? "tasks" : h === "#medlemmer" ? "members" : "meetings"; }
function hashMeeting() { const r = /^#moede-(.+)$/.exec(location.hash); return r ? r[1] : null; }
function meetingUrl(id) { return appUrl() + "#moede-" + id; }
function sorted() { return Object.values(meetings).sort((a, b) => (b.date || "9999") < (a.date || "9999") ? -1 : 1); }

/* ---------- backends ---------- */
// Lokal prøve: alt gemmes i denne browser.
const LocalB = {
  persist() { try { localStorage.setItem("sg-local2", JSON.stringify({ meetings, tasks, proposals, members })); } catch (e) { } },
  async start() {
    let d = null; try { d = JSON.parse(localStorage.getItem("sg-local2")); } catch (e) { }
    d = d || clone(LOCAL);
    meetings = d.meetings || {}; tasks = d.tasks || {}; proposals = d.proposals || {}; members = d.members || {};
    me = members[LOCAL.me] || { email: LOCAL.me, name: "Formand", role: "formand" }; authState = "in"; render();
  },
  async saveMeeting(m) { meetings[m.id] = clone(m); this.persist(); }, async deleteMeeting(id) { delete meetings[id]; this.persist(); },
  async saveTask(t) { tasks[t.id] = clone(t); this.persist(); }, async deleteTask(id) { delete tasks[id]; this.persist(); }, async toggleTask(t) { tasks[t.id] = clone(t); this.persist(); },
  async saveProposal(p) { proposals[p.id] = clone(p); this.persist(); }, async deleteProposal(id) { delete proposals[id]; this.persist(); },
  async saveMember(m) { members[m.email] = clone(m); this.persist(); }, async deleteMember(e) { delete members[e]; this.persist(); },
  async signOut() { }
};

// Firebase: login med mail og adgangskode, data i Firestore. Reglerne i Firestore afgør, hvem der må hvad.
const FireB = {
  f: null, A: null, db: null, unsub: [],
  async start() {
    const [appM, authM, fsM] = await Promise.all([import(SDK + "firebase-app.js"), import(SDK + "firebase-auth.js"), import(SDK + "firebase-firestore.js")]);
    this.f = { ...authM, ...fsM };
    const fb = appM.initializeApp(CFG);
    this.A = authM.getAuth(fb); this.db = fsM.getFirestore(fb);
    await this.handleLink();
    authM.onAuthStateChanged(this.A, u => this.onUser(u));
  },
  // Links fra Firebases mails (bekræft mail, ny adgangskode) lander i appen og håndteres her.
  async handleLink() {
    const q = {}; location.search.replace(/^\?/, "").split("&").forEach(p => { const i = p.indexOf("="); if (i > 0) q[decodeURIComponent(p.slice(0, i)).replace(/^amp;/, "")] = decodeURIComponent(p.slice(i + 1)); });
    if (!q.oobCode) return;
    history.replaceState(null, "", location.pathname + location.hash);
    if (q.mode === "resetPassword") { this.resetCode = q.oobCode; return; }
    try {
      await this.f.applyActionCode(this.A, q.oobCode);
      if (this.A.authStateReady) await this.A.authStateReady();
      const u = this.A.currentUser; if (u) { await u.reload(); await u.getIdToken(true); }
      linkMsg = "Din mail er bekræftet." + (u ? "" : " Log ind for at fortsætte.");
    } catch (e) { linkMsg = "Linket er udløbet eller allerede brugt. Log ind, og tryk \"Send mailen igen\"."; }
  },
  stop() { this.unsub.forEach(u => u()); this.unsub = []; },
  async onUser(u) {
    this.stop(); me = null; meetings = {}; tasks = {}; proposals = {}; members = {};
    if (this.resetCode) { authState = "reset"; return render(); }
    if (!u) { authState = "out"; return render(); }
    if (!u.emailVerified) { authState = "verify"; return render(); }
    await this.enter(u);
  },
  async enter(u) {
    const f = this.f, email = u.email.toLowerCase(), ref = f.doc(this.db, "members", email);
    try {
      let snap = await f.getDoc(ref);
      // Findes medlemmet ikke, er det kun ejeren af systemet, reglerne lader oprette sig selv som formand.
      if (!snap.exists()) { await f.setDoc(ref, { name: email.split("@")[0], email, role: "formand" }); snap = await f.getDoc(ref); }
      me = { ...snap.data(), email }; authState = "in"; authMsg = ""; this.listen();
    } catch (e) { authState = e && e.code === "permission-denied" ? "nomember" : "error"; }
    render();
  },
  listen() {
    const f = this.f, sub = (name, set) => this.unsub.push(f.onSnapshot(f.collection(this.db, name), snap => {
      const next = {}; snap.forEach(d => { next[d.id] = { ...d.data(), [name === "members" ? "email" : "id"]: d.id }; });
      set(next); if (!editing()) render();
    }, () => { if (name === "members") { authState = "nomember"; this.stop(); render(); } }));
    sub("members", v => { members = v; if (me) { if (v[me.email]) me = v[me.email]; } });
    sub("meetings", v => { meetings = v; });
    sub("tasks", v => { tasks = v; });
    sub("proposals", v => { proposals = v; });
  },
  strip(o, key) { const d = clone(o); delete d[key]; return d; },
  saveMeeting(m) { return this.f.setDoc(this.f.doc(this.db, "meetings", m.id), this.strip(m, "id")); },
  deleteMeeting(id) { return this.f.deleteDoc(this.f.doc(this.db, "meetings", id)); },
  saveTask(t) { return this.f.setDoc(this.f.doc(this.db, "tasks", t.id), this.strip(t, "id")); },
  deleteTask(id) { return this.f.deleteDoc(this.f.doc(this.db, "tasks", id)); },
  toggleTask(t) { return this.f.updateDoc(this.f.doc(this.db, "tasks", t.id), { done: t.done, doneAt: t.doneAt }); },
  saveProposal(p) { return this.f.setDoc(this.f.doc(this.db, "proposals", p.id), this.strip(p, "id")); },
  deleteProposal(id) { return this.f.deleteDoc(this.f.doc(this.db, "proposals", id)); },
  saveMember(m) { return this.f.setDoc(this.f.doc(this.db, "members", m.email), { name: m.name, email: m.email, role: m.role }); },
  deleteMember(email) { return this.f.deleteDoc(this.f.doc(this.db, "members", email)); },
  signOut() { return this.f.signOut(this.A); },
  authErr(e) {
    const c = (e && e.code) || "";
    return c === "auth/email-already-in-use" ? "Der findes allerede et login med den mail. Log ind i stedet."
      : c === "auth/weak-password" ? "Adgangskoden skal være mindst 6 tegn."
      : c === "auth/invalid-email" ? "Mailadressen er ikke gyldig."
      : c === "auth/too-many-requests" ? "For mange forsøg. Vent lidt og prøv igen."
      : c === "auth/network-request-failed" ? "Ingen forbindelse. Prøv igen."
      : c === "auth/expired-action-code" || c === "auth/invalid-action-code" ? "Linket er udløbet eller allerede brugt. Bed om et nyt med \"Glemt adgangskode\"."
      : "Forkert mail eller adgangskode.";
  }
};
const B = LOCAL ? LocalB : FireB;

/* ---------- text export ---------- */
function taskLine(t) { return "   - [" + (t.done ? "x" : " ") + "] " + t.text + " (" + (nameOf(t.ownerEmail) || "ansvarlig mangler") + (t.due ? ", frist " + fdate(t.due) : "") + ")"; }
function agendaText(m) {
  const L = ["Strong Gym - bestyrelsesmøde", "Dato: " + fdate(m.date, true) + (m.time ? " kl. " + m.time : ""), "Sted: " + (m.place || "-"), "", "DAGSORDEN"];
  (m.items || []).forEach((it, i) => {
    L.push((i + 1) + ". " + it.title); if (it.note) L.push("   " + it.note.replace(/\n/g, "\n   "));
    if (isFollowUp(it)) {
      const f = followUp(m);
      if (!f.fromPrev.length && !f.open.length) L.push("   Ingen opgaver at følge op på.");
      if (f.fromPrev.length) { L.push("   Fra mødet " + fdate(f.prev.date) + ":"); f.fromPrev.forEach(t => L.push(taskLine(t))); }
      if (f.open.length) { L.push("   Øvrige uløste opgaver:"); f.open.forEach(t => L.push(taskLine(t))); }
    }
  });
  L.push(((m.items || []).length + 1) + ". Eventuelt"); return L.join("\n");
}
function minutesText(m) {
  const mi = m.minutes || {}, L = ["Strong Gym - referat af bestyrelsesmøde", "Dato: " + fdate(m.date, true) + (m.time ? " kl. " + m.time : ""), "Sted: " + (m.place || "-"), "Til stede: " + (mi.present || "-"), "Afbud: " + (mi.absent || "-"), ""];
  (m.items || []).forEach((it, i) => {
    const r = (mi.items || {})[it.id] || {}; L.push((i + 1) + ". " + it.title); L.push(r.summary || NOT_TREATED);
    const d = (r.decisions || "").split("\n").filter(x => x.trim()); if (d.length) { L.push("Beslutninger:"); d.forEach(x => L.push("- " + x.trim())); } L.push("");
  });
  L.push(((m.items || []).length + 1) + ". Eventuelt"); L.push(mi.eventuelt || "Intet at bemærke."); L.push(""); L.push("OPGAVER OG AFTALER");
  const ts = meetingTasks(m.id); if (!ts.length) L.push("Ingen.");
  ts.forEach(t => L.push("- " + t.text + " (ansvarlig: " + (nameOf(t.ownerEmail) || "ikke aftalt") + (t.due ? ", frist: " + fdate(t.due) : "") + ")" + (t.done ? " [udført]" : "")));
  return L.join("\n");
}

const isFollowUp = (it) => !!it.follow || (it.title || "").trim().toLowerCase() === FOLLOW_UP.toLowerCase();
// Opfølgningspunktet samler alt fra sidste møde, løst som uløst, plus alle uløste opgaver fra tidligere møder.
function followUp(m) {
  const prev = sorted().filter(x => x.id !== m.id && x.date && (!m.date || x.date < m.date))[0];
  const fromPrev = prev ? meetingTasks(prev.id) : [];
  const seen = {}; fromPrev.forEach(t => { seen[t.id] = 1; });
  const open = Object.values(tasks).filter(t => !t.done && !seen[t.id] && t.meetingId !== m.id).sort((a, b) => (a.due || "9999") < (b.due || "9999") ? -1 : 1);
  return { prev, fromPrev, open };
}
function followUpHtml(m) {
  const f = followUp(m);
  if (!f.fromPrev.length && !f.open.length) return '<p class="muted small">Ingen opgaver at følge op på.</p>';
  let h = "";
  if (f.fromPrev.length) h += '<p class="small muted">Fra mødet ' + esc(fdate(f.prev.date)) + '</p><div>' + f.fromPrev.map(t => taskRow(t, false)).join("") + '</div>';
  if (f.open.length) h += '<p class="small muted">Øvrige uløste opgaver</p><div>' + f.open.map(t => taskRow(t, true)).join("") + '</div>';
  return h;
}
function appUrl() { return location.origin + location.pathname.replace(/[^/]*$/, ""); }
function mailtoUrl(to, subject, body) { return "mailto:" + encodeURIComponent(to.join(",")) + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body); }
function openMail(url) { const a = document.createElement("a"); a.href = url; a.style.display = "none"; document.body.appendChild(a); a.click(); a.remove(); }

/* ---------- render ---------- */
const chipAgenda = m => m.agendaStatus === "godkendt" ? '<span class="chip good">Dagsorden godkendt</span>' : '<span class="chip warn">Dagsorden - klade</span>';
const chipMin = m => !m.minutes ? '<span class="chip none">Referat mangler</span>' : m.minutes.status === "godkendt" ? '<span class="chip good">Referat godkendt</span>' : '<span class="chip warn">Referat - klade</span>';
function ownerChip(email) { const mb = members[email]; return '<span class="chip ' + (email ? "" : "crit") + '">' + esc(email ? nameOf(email) : "Ansvarlig mangler") + (mb && mb.role ? " - " + esc(mb.role) : "") + '</span>'; }
function taskRow(t, showMeeting) {
  const m = meetings[t.meetingId], late = !t.done && t.due && t.due < today(), can = isAdmin() || (me && t.ownerEmail === me.email);
  if (showMeeting === undefined) showMeeting = view() === "tasks";
  return '<div class="task' + (t.done ? " done" : "") + '"><input type="checkbox" id="tk-' + esc(t.id) + '" data-act="toggle" data-t="' + esc(t.id) + '"' + (t.done ? " checked" : "") + (can ? "" : " disabled") + ' aria-label="Udført">'
    + '<div class="stack" style="gap:4px"><span class="tt pre">' + esc(t.text) + '</span><div class="row small">' + ownerChip(t.ownerEmail)
    + (t.due ? '<span class="' + (late ? "chip crit" : "muted") + '">Frist ' + esc(fdate(t.due)) + (late ? " - overskredet" : "") + '</span>' : '<span class="muted">Ingen frist</span>')
    + (showMeeting && m ? '<button class="icon small" data-act="open" data-m="' + esc(m.id) + '">Møde ' + esc(fdate(m.date)) + '</button>' : "") + '</div></div></div>';
}
function memberOptions(sel, emptyLabel) {
  return '<option value="">' + esc(emptyLabel) + '</option>' + memberList().map(mb => '<option value="' + esc(mb.email) + '"' + (sel === mb.email ? " selected" : "") + '>' + esc(mb.name) + '</option>').join("");
}
function meetingOptions(sel, emptyLabel) {
  const ms = sorted().filter(m => !m.minutes || m.minutes.status !== "godkendt").reverse();
  return '<option value="">' + esc(emptyLabel) + '</option>' + ms.map(m => '<option value="' + esc(m.id) + '"' + (sel === m.id ? " selected" : "") + '>' + esc(fdate(m.date)) + '</option>').join("");
}

function renderAuth() {
  let h = "";
  if (authState === "loading") h = '<p class="muted">Henter...</p>';
  else if (authState === "error") h = '<div class="card"><p>Appen kunne ikke få forbindelse. Tjek nettet og prøv igen.</p><div class="row"><button data-act="reload">Prøv igen</button></div></div>';
  else if (authState === "reset") h = '<div class="card"><h3>Ny adgangskode</h3>' + (authMsg ? '<p class="note err">' + esc(authMsg) + '</p>' : "")
    + '<label for="au-new">Ny adgangskode - mindst 6 tegn<input id="au-new" type="password" autocomplete="new-password"></label><div class="row"><button class="primary" data-act="au-setpw">Gem adgangskode</button></div></div>';
  else if (authState === "out") h = '<div class="card"><h3>Log ind</h3><p class="small muted">Brug den mail, formanden har oprettet dig med. Første gang vælger du selv en adgangskode med "Opret login".</p>'
    + (authMsg ? '<p class="note err">' + esc(authMsg) + '</p>' : "")
    + '<label for="au-mail">Mail<input id="au-mail" type="email" autocomplete="username" autocapitalize="off"></label><label for="au-pw">Adgangskode<input id="au-pw" type="password" autocomplete="current-password"></label>'
    + '<div class="row"><button class="primary" data-act="au-in">Log ind</button><button data-act="au-up">Opret login</button><button data-act="au-reset">Glemt adgangskode</button></div></div>';
  else if (authState === "verify") h = '<div class="card"><h3>Bekræft din mail</h3><p>Vi har sendt en mail med et link. Klik på linket, og tryk så på knappen her. Tjek også spam.</p>'
    + (authMsg ? '<p class="note err">' + esc(authMsg) + '</p>' : "")
    + '<div class="row"><button class="primary" data-act="au-check">Jeg har bekræftet</button><button data-act="au-resend">Send mailen igen</button><button data-act="au-out">Log ud</button></div></div>';
  else if (authState === "nomember") {
    const who = (!LOCAL && FireB.A && FireB.A.currentUser) ? FireB.A.currentUser.email : "";
    h = '<div class="card"><h3>Ingen adgang</h3><p>Du er logget ind som <strong>' + esc(who) + '</strong>, men den mail er ikke oprettet som medlem af bestyrelsen.</p>'
      + '<p class="small muted">Send mailadressen ovenfor til formanden, præcis som den står. Når du er oprettet, trykker du Prøv igen.</p>'
      + '<div class="row"><button class="primary" data-act="au-retry">Prøv igen</button><button data-act="au-out">Log ud</button></div></div>';
  }
  app.innerHTML = (linkMsg && authState !== "loading" ? '<p class="note">' + esc(linkMsg) + '</p>' : "") + h;
}

function renderList() {
  const ms = sorted(); let h = '<div class="row between"><h2>Møder</h2>' + (isAdmin() ? '<button class="primary" data-act="new">Ny dagsorden</button>' : "") + '</div>';
  if (!ms.length) h += '<div class="card"><p>Der er ingen møder endnu.</p><p class="muted small">Formanden opretter dagsordenen. Den starter som klade med de faste punkter, og Eventuelt står altid sidst.</p></div>';
  ms.forEach(m => {
    const open = meetingTasks(m.id).filter(t => !t.done).length;
    h += '<button class="card meet" data-act="open" data-m="' + esc(m.id) + '"><span class="d">' + esc(fdate(m.date, true)) + '</span><span class="row">' + chipAgenda(m) + chipMin(m)
      + (open ? '<span class="chip">' + open + (open === 1 ? " åben opgave" : " åbne opgaver") + '</span>' : "") + '</span><span class="muted small">' + ((m.items || []).length + 1) + ' punkter' + (m.place ? " - " + esc(m.place) : "") + '</span></button>';
  });
  h += proposalsHtml();
  if (LOCAL) h += '<p class="note">Lokal prøveversion med eksempeldata. Du er formand, og ændringer gemmes kun i denne browser.</p>';
  app.innerHTML = h;
}

function renderTasks() {
  const all = Object.values(tasks), own = memberList();
  let h = '<h2>Opgaver og aftaler</h2><div class="row"><label for="f-status">Status<select id="f-status" data-flt="filter"><option value="open">Åbne</option><option value="done">Udførte</option><option value="all">Alle</option></select></label>'
    + '<label for="f-owner">Ansvarlig<select id="f-owner" data-flt="owner"><option value="">Alle</option>' + (me ? '<option value="' + esc(me.email) + '">Mine</option>' : "") + own.filter(o => !me || o.email !== me.email).map(o => '<option value="' + esc(o.email) + '">' + esc(o.name) + '</option>').join("") + '</select></label></div>';
  const list = all.filter(t => (S.filter === "all" || (S.filter === "open") === !t.done) && (!S.owner || t.ownerEmail === S.owner)).sort((a, b) => (a.due || "9999") < (b.due || "9999") ? -1 : 1);
  const nOpen = all.filter(t => !t.done).length, nLate = all.filter(t => !t.done && t.due && t.due < today()).length;
  h += '<p class="small muted">' + nOpen + ' åbne, heraf ' + nLate + ' over frist. ' + (all.length - nOpen) + ' udførte.</p>';
  h += '<div class="card" style="gap:0">' + (list.length ? list.map(t => taskRow(t)).join("") : '<p class="muted">Ingen opgaver her. Opgaver oprettes i referatet for et møde.</p>') + '</div>';
  app.innerHTML = h;
  document.getElementById("f-status").value = S.filter; document.getElementById("f-owner").value = S.owner;
}

function proposalsHtml() {
  let h = '<h2 id="forslag">Forslag til kommende møder</h2>';
  if (S.err) h += '<p class="note err">' + esc(S.err) + '</p>';
  h += '<section class="card"><h3>Nyt forslag</h3><p class="small muted">Forslaget kommer først på dagsordenen, når formanden har godkendt det.</p>'
    + '<label for="p-title">Emne<input id="p-title" maxlength="140"></label><label for="p-note">Uddybning<textarea id="p-note" placeholder="Hvad vil du have drøftet eller besluttet?"></textarea></label>'
    + '<label for="p-meet">Møde<select id="p-meet">' + meetingOptions("", "Næste møde - formanden vælger") + '</select></label><div class="row"><button class="primary" data-act="p-add">Send forslag</button></div></section>';
  const ps = Object.values(proposals).sort((a, b) => (a.createdAt || "") < (b.createdAt || "") ? 1 : -1);
  const order = { afventer: 0, godkendt: 1, afvist: 2 }; ps.sort((a, b) => order[a.status] - order[b.status]);
  h += '<section class="card"><h3>Forslag</h3>';
  if (!ps.length) h += '<p class="muted">Ingen forslag endnu.</p>';
  ps.forEach(p => {
    const m = meetings[p.meetingId], chip = p.status === "godkendt" ? '<span class="chip good">Godkendt</span>' : p.status === "afvist" ? '<span class="chip crit">Afvist</span>' : '<span class="chip warn">Afventer formanden</span>';
    h += '<div class="tedit"><div class="row between"><h4>' + esc(p.title) + '</h4>' + chip + '</div>' + (p.note ? '<p class="pre small">' + esc(p.note) + '</p>' : "")
      + '<p class="small muted">Foreslået af ' + esc(nameOf(p.byEmail)) + (m ? " - til mødet " + esc(fdate(m.date)) : " - intet møde valgt") + '</p>';
    if (p.status === "afventer") {
      h += '<div class="row">';
      if (isAdmin()) h += '<label for="pm-' + esc(p.id) + '">Sæt på mødet<select id="pm-' + esc(p.id) + '">' + meetingOptions(p.meetingId, "Vælg møde") + '</select></label></div><div class="row"><button class="primary" data-act="p-ok" data-p="' + esc(p.id) + '">Godkend</button><button data-act="p-no" data-p="' + esc(p.id) + '">Afvis</button>';
      if (me && p.byEmail === me.email) h += '<button class="danger" data-act="p-del" data-p="' + esc(p.id) + '">Træk tilbage</button>';
      h += '</div>';
    }
    h += '</div>';
  });
  return h + '</section>';
}

function renderMembers() {
  let h = '<h2>Medlemmer</h2>'; if (S.err) h += '<p class="note err">' + esc(S.err) + '</p>';
  h += '<section class="card" style="gap:0">';
  memberList().forEach(mb => {
    h += '<div class="task" style="grid-template-columns:1fr auto"><div class="stack" style="gap:2px"><strong>' + esc(mb.name) + '</strong><span class="small muted">' + esc(mb.email) + '</span></div><div class="row"><span class="chip">' + esc(cap(mb.role)) + '</span>'
      + (isAdmin() && mb.email !== me.email ? '<button class="icon danger" data-act="mb-del" data-e="' + esc(mb.email) + '">Fjern</button>' : "") + '</div></div>';
  });
  h += '</section>';
  if (isAdmin()) h += '<section class="card"><h3>Opret eller ret medlem</h3><p class="small muted">Medlemmet opretter selv sit login i appen med den mail, du skriver her. Skriver du en mail, der allerede findes, rettes navn og rolle.</p>'
    + '<label for="mb-name">Navn<input id="mb-name"></label><label for="mb-mail">Mail<input id="mb-mail" type="email" autocapitalize="off"></label>'
    + '<label for="mb-role">Rolle<select id="mb-role">' + ROLES.map(r => '<option value="' + r + '"' + (r === "bestyrelsesmedlem" ? " selected" : "") + '>' + cap(r) + '</option>').join("") + '</select></label>'
    + '<p class="small muted">Rollen formand giver ret til at rette dagsorden, referat, opgaver og medlemmer og til at godkende forslag.</p><div class="row"><button class="primary" data-act="mb-add">Gem medlem</button></div></section>';
  app.innerHTML = h;
}

function renderMeeting() {
  const m = cur(); if (!m) { S.cur = null; return renderList(); }
  let h = '<div class="row between"><button data-act="back">Alle møder</button><span class="row">' + chipAgenda(m) + chipMin(m) + '</span></div>';
  h += '<div><h2>Bestyrelsesmøde ' + esc(fdate(m.date, true)) + '</h2><p class="muted">' + (m.time ? "Kl. " + esc(m.time) : "Tidspunkt mangler") + " - " + esc(m.place || "Sted mangler") + '</p></div>';
  if (S.err) h += '<p class="note err">' + esc(S.err) + '</p>';
  h += S.aDraft ? agendaEdit() : agendaRead(m);
  if (!S.aDraft) h += S.mDraft ? minutesEdit(m) : minutesRead(m);
  if (isAdmin() && !editing()) h += '<div class="row"><button class="danger" data-act="del">' + (S.confirmDel ? "Bekræft: slet mødet med referat og opgaver" : "Slet møde") + '</button></div>';
  app.innerHTML = h;
}
function agendaRead(m) {
  const pend = Object.values(proposals).filter(p => p.status === "afventer" && (!p.meetingId || p.meetingId === m.id)).length;
  const sent = m.agendaSentAt, canSend = isAdmin() && m.agendaStatus === "godkendt";
  let h = '<section class="card"><div class="row between"><h3>Dagsorden</h3><span class="row">' + (isAdmin() ? '<button data-act="a-edit">Rediger</button>' : "")
    + '<button data-act="copy-a">Kopiér</button>' + (canSend ? '<button class="' + (sent ? "" : "primary") + '" data-act="a-send">' + (sent ? "Send igen" : "Send til medlemmer") + '</button>' : "") + '</span></div><ol class="agenda">';
  (m.items || []).forEach(it => { h += '<li><div><h4>' + esc(it.title || "(uden titel)") + '</h4>' + (it.note ? '<p class="muted small pre">' + esc(it.note) + '</p>' : "") + (it.by ? '<p class="small muted">Foreslået af ' + esc(nameOf(it.by)) + '</p>' : "") + (isFollowUp(it) ? followUpHtml(m) : "") + '</div></li>'; });
  h += '<li><div><h4>Eventuelt</h4></div></li></ol>';
  if (sent) h += '<p class="small muted">Udsendt til medlemmerne ' + esc(fdate(String(sent).slice(0, 10))) + (m.agendaSentBy ? " af " + esc(nameOf(m.agendaSentBy)) : "") + '.</p>';
  else if (canSend) h += '<p class="note">Dagsordenen er godkendt, men ikke sendt til medlemmerne endnu.</p>';
  if (pend && (!m.minutes)) h += '<p class="note">' + pend + (pend === 1 ? " forslag afventer" : " forslag afventer") + ' formandens godkendelse. Se forslagene under Møder.</p>';
  return h + '</section>';
}
function agendaEdit() {
  const d = S.aDraft; let h = '<section class="card"><h3>Dagsorden - redigerer</h3><div class="row"><label for="a-date">Dato<input id="a-date" type="date" data-a="date" value="' + esc(d.date) + '"></label>'
    + '<label for="a-time">Tidspunkt<input id="a-time" type="time" data-a="time" value="' + esc(d.time) + '"></label><label for="a-place">Sted<input id="a-place" data-a="place" value="' + esc(d.place) + '"></label></div><ol class="agenda">';
  d.items.forEach((it, i) => {
    h += '<li><div><input id="ai-' + i + '" data-ai="' + i + '" data-k="title" value="' + esc(it.title) + '" placeholder="Punktets titel" aria-label="Titel på punkt ' + (i + 1) + '">'
      + '<textarea id="an-' + i + '" data-ai="' + i + '" data-k="note" placeholder="Evt. uddybning, bilag eller hvem der fremlægger" aria-label="Uddybning af punkt ' + (i + 1) + '">' + esc(it.note) + '</textarea>'
      + '<div class="row"><button class="icon" data-act="a-up" data-i="' + i + '"' + (i ? "" : " disabled") + ' aria-label="Flyt op">Op</button><button class="icon" data-act="a-down" data-i="' + i + '"' + (i < d.items.length - 1 ? "" : " disabled") + ' aria-label="Flyt ned">Ned</button><button class="icon danger" data-act="a-del" data-i="' + i + '">Fjern</button></div></div></li>';
  });
  return h + '<li><div><h4>Eventuelt</h4><p class="muted small">Fast sidste punkt på alle dagsordener.</p></div></li></ol>'
    + '<div class="row"><button data-act="a-add">Tilføj punkt</button></div><div class="row"><button class="primary" data-act="a-approve">Godkend dagsorden</button><button data-act="a-save">Gem som klade</button><button data-act="a-cancel">Fortryd</button></div></section>';
}
function minutesRead(m) {
  const mi = m.minutes; let h = '<section class="card"><div class="row between"><h3>Referat</h3>';
  if (mi) h += '<span class="row">' + (isAdmin() ? '<button data-act="m-edit">Rediger</button>' : "") + '<button data-act="copy-m">Kopiér</button></span>';
  h += '</div>';
  if (!mi) {
    if (!isAdmin()) return h + '<p class="muted">Der er ikke skrevet referat endnu.</p></section>';
    return h + '<p class="small muted">Send transskriptionen og den kopierede dagsorden til Claude. Indsæt den klade, du får tilbage, her - så udfyldes alle punkter, Eventuelt og opgaver. Du kan også skrive referatet selv.</p>'
      + '<textarea id="imp" data-imp="1" style="min-height:100px" placeholder="Indsæt referatklade fra Claude her" aria-label="Referatklade fra Claude">' + esc(S.importText) + '</textarea>'
      + '<div class="row"><button class="primary" data-act="m-import">Indlæs klade</button><button data-act="m-blank">Skriv referat selv</button></div></section>';
  }
  h += '<p class="small"><strong>Til stede:</strong> ' + esc(mi.present || "-") + '<br><strong>Afbud:</strong> ' + esc(mi.absent || "-") + '</p><ol class="agenda">';
  (m.items || []).forEach(it => {
    const r = (mi.items || {})[it.id] || {}, dec = (r.decisions || "").split("\n").filter(x => x.trim());
    h += '<li><div><h4>' + esc(it.title) + '</h4><p class="pre">' + esc(r.summary || NOT_TREATED) + '</p>' + (dec.length ? '<div class="small"><strong>Beslutninger</strong><ul class="dec">' + dec.map(x => '<li>' + esc(x.trim()) + '</li>').join("") + '</ul></div>' : "") + '</div></li>';
  });
  h += '<li><div><h4>Eventuelt</h4><p class="pre">' + esc(mi.eventuelt || "Intet at bemærke.") + '</p></div></li></ol></section>';
  const ts = meetingTasks(m.id);
  return h + '<section class="card"><h3>Opgaver og aftaler</h3><div>' + (ts.length ? ts.map(t => taskRow(t, false)).join("") : '<p class="muted">Ingen opgaver fra dette møde.</p>') + '</div></section>';
}
function minutesEdit(m) {
  const d = S.mDraft; let h = '<section class="card"><h3>Referat - redigerer</h3><div class="row"><label for="m-present">Til stede<input id="m-present" data-mf="present" value="' + esc(d.present) + '"></label><label for="m-absent">Afbud<input id="m-absent" data-mf="absent" value="' + esc(d.absent) + '"></label></div><ol class="agenda">';
  (m.items || []).forEach((it, i) => {
    const r = d.items[it.id];
    h += '<li><div><h4>' + esc(it.title) + '</h4><label for="ms-' + i + '">Resumé<textarea id="ms-' + i + '" data-mi="' + esc(it.id) + '" data-k="summary">' + esc(r.summary) + '</textarea></label>'
      + '<label for="md-' + i + '">Beslutninger - én pr. linje<textarea id="md-' + i + '" data-mi="' + esc(it.id) + '" data-k="decisions" style="min-height:52px">' + esc(r.decisions) + '</textarea></label></div></li>';
  });
  h += '<li><div><h4>Eventuelt</h4><label for="m-ev">Resumé<textarea id="m-ev" data-mf="eventuelt">' + esc(d.eventuelt) + '</textarea></label></div></li></ol></section>';
  h += '<section class="card"><h3>Opgaver og aftaler</h3>';
  d.tasks.forEach((t, i) => {
    h += '<div class="tedit"><textarea id="tt-' + i + '" data-ti="' + i + '" data-k="text" style="min-height:52px" placeholder="Hvad skal gøres?" aria-label="Opgave ' + (i + 1) + '">' + esc(t.text) + '</textarea>'
      + '<div class="row"><label for="to-' + i + '">Ansvarlig<select id="to-' + i + '" data-ti="' + i + '" data-k="ownerEmail">' + memberOptions(t.ownerEmail, "Vælg medlem") + '</select></label><label for="td-' + i + '">Frist<input id="td-' + i + '" type="date" data-ti="' + i + '" data-k="due" value="' + esc(t.due) + '"></label>'
      + '<label for="tp-' + i + '">Punkt<select id="tp-' + i + '" data-ti="' + i + '" data-k="itemId"><option value="">Eventuelt / andet</option>' + (m.items || []).map((it, n) => '<option value="' + esc(it.id) + '"' + (t.itemId === it.id ? " selected" : "") + '>' + (n + 1) + ". " + esc(it.title) + '</option>').join("") + '</select></label></div>'
      + '<div class="row"><button class="icon danger" data-act="t-del" data-i="' + i + '">Fjern opgave</button></div></div>';
  });
  return h + '<div class="row"><button data-act="t-add">Tilføj opgave</button></div></section>'
    + '<div class="row"><button class="primary" data-act="m-approve">Godkend referat</button><button data-act="m-save">Gem som klade</button><button data-act="m-cancel">Fortryd</button>'
    + (m.minutes && m.minutes.status === "klade" ? '<button class="danger" data-act="m-discard">Kassér klade</button>' : "") + '</div>';
}

function render() {
  const v = view(), inn = authState === "in";
  [["moeder", "meetings"], ["opgaver", "tasks"], ["medlemmer", "members"]].forEach(([id, name]) => { document.getElementById("nav-" + id).className = inn && v === name ? "on" : ""; });
  document.getElementById("nav").style.display = inn ? "" : "none";
  document.getElementById("nav-okonomi").style.display = LOCAL ? "none" : "";
  const who = document.getElementById("who");
  who.innerHTML = inn && me ? '<span class="small muted">' + esc(me.name) + " - " + esc(me.role) + '</span>' + (LOCAL ? "" : '<button class="icon small" data-act="au-out">Log ud</button>') : "";
  if (!inn) return renderAuth();
  const hm = hashMeeting();
  if (hm && meetings[hm] && !editing()) S.cur = hm;
  if (v === "tasks") renderTasks(); else if (v === "members") renderMembers(); else if (S.cur) renderMeeting(); else renderList();
}

/* ---------- minutes helpers ---------- */
function minutesDraft(m) {
  const mi = m.minutes || {}, d = { present: mi.present || "", absent: mi.absent || "", eventuelt: mi.eventuelt || "", items: {}, tasks: clone(meetingTasks(m.id)) };
  (m.items || []).forEach(it => { const r = (mi.items || {})[it.id] || {}; d.items[it.id] = { summary: r.summary || "", decisions: r.decisions || "" }; }); return d;
}
// Klade fra Claude: {present, absent, items:[{nr, summary, decisions:[]}], eventuelt, tasks:[{text, owner, due, nr}]}
function importDraft(m, text) {
  const a = text.indexOf("{"), b = text.lastIndexOf("}"); if (a < 0 || b < a) throw new Error("format");
  const r = JSON.parse(text.slice(a, b + 1)), str = v => typeof v === "string" ? v : "";
  const d = { present: str(r.present), absent: str(r.absent), eventuelt: str(r.eventuelt) || "Intet at bemærke.", items: {}, tasks: [] }, by = {};
  (Array.isArray(r.items) ? r.items : []).forEach(x => { if (x && x.nr) by[+x.nr] = x; });
  (m.items || []).forEach((it, i) => { const x = by[i + 1] || {}; d.items[it.id] = { summary: str(x.summary) || NOT_TREATED, decisions: (Array.isArray(x.decisions) ? x.decisions : []).filter(s => typeof s === "string" && s.trim()).join("\n") }; });
  const find = n => { n = str(n).trim().toLowerCase(); if (!n) return ""; const hit = memberList().find(mb => mb.email === n || (mb.name || "").toLowerCase() === n || (mb.name || "").toLowerCase().split(" ")[0] === n || (mb.role || "") === n); return hit ? hit.email : ""; };
  (Array.isArray(r.tasks) ? r.tasks : []).forEach(t => {
    if (!t || !str(t.text).trim()) return; const it = (m.items || [])[(+t.nr || 0) - 1];
    d.tasks.push({ id: uid(), meetingId: m.id, itemId: it ? it.id : "", text: str(t.text), ownerEmail: find(t.owner), due: /^\d{4}-\d{2}-\d{2}$/.test(str(t.due)) ? t.due : "", done: false, doneAt: "", createdAt: new Date().toISOString() });
  });
  return d;
}
async function saveMinutes(m, status) {
  const d = S.mDraft, n = clone(m);
  n.minutes = { status, present: d.present.trim(), absent: d.absent.trim(), eventuelt: d.eventuelt.trim(), items: {} };
  (m.items || []).forEach(it => { n.minutes.items[it.id] = { summary: d.items[it.id].summary.trim(), decisions: d.items[it.id].decisions.trim() }; });
  const keep = d.tasks.filter(t => t.text.trim()), keepIds = {};
  await B.saveMeeting(n); meetings[m.id] = n;
  for (const t of keep) {
    const nt = { id: t.id, meetingId: m.id, itemId: t.itemId || "", text: t.text.trim(), ownerEmail: t.ownerEmail || "", due: t.due || "", done: !!t.done, doneAt: t.doneAt || "", createdAt: t.createdAt || new Date().toISOString() };
    keepIds[t.id] = 1;
    if (JSON.stringify(tasks[t.id] || null) !== JSON.stringify(nt)) { tasks[t.id] = nt; await B.saveTask(nt); }
  }
  for (const t of meetingTasks(m.id)) if (!keepIds[t.id]) { delete tasks[t.id]; await B.deleteTask(t.id); }
}

/* ---------- actions ---------- */
const val = id => { const el = document.getElementById(id); return el ? el.value.trim() : ""; };
async function authAct(a) {
  const f = FireB.f, A = FireB.A; authMsg = "";
  try {
    if (a === "au-out") { await B.signOut(); return; }
    if (a === "au-retry") { const u = A.currentUser; if (!u) { authState = "out"; return render(); } await u.reload(); await u.getIdToken(true); await FireB.enter(u); return; }
    if (a === "reload") { location.reload(); return; }
    if (a === "au-setpw") { await f.confirmPasswordReset(A, FireB.resetCode, document.getElementById("au-new").value); FireB.resetCode = null; linkMsg = "Adgangskoden er ændret. Log ind med den nye."; authState = A.currentUser ? authState : "out"; await f.signOut(A); return; }
    if (a === "au-in") await f.signInWithEmailAndPassword(A, val("au-mail"), document.getElementById("au-pw").value);
    else if (a === "au-up") { const c = await f.createUserWithEmailAndPassword(A, val("au-mail"), document.getElementById("au-pw").value); await f.sendEmailVerification(c.user); }
    else if (a === "au-reset") { if (!val("au-mail")) { authMsg = "Skriv din mail først."; return render(); } await f.sendPasswordResetEmail(A, val("au-mail")); toast("Hvis mailen findes, er der sendt et link til ny adgangskode"); }
    else if (a === "au-resend") { await f.sendEmailVerification(A.currentUser); toast("Mailen er sendt igen"); }
    else if (a === "au-check") { const u = A.currentUser; await u.reload(); if (u.emailVerified) { await u.getIdToken(true); await FireB.enter(u); } else { authMsg = "Mailen er ikke bekræftet endnu. Klik på linket i mailen først."; render(); } }
  } catch (e) { authMsg = FireB.authErr(e); render(); }
}
async function act(a, el) {
  if (a.indexOf("au-") === 0 || a === "reload") return authAct(a);
  const m = cur(), i = +el.getAttribute("data-i");
  if (a !== "del") S.confirmDel = false;
  S.err = "";
  switch (a) {
    case "new": { const id = uid(), n = { id, date: "", time: "", place: "", agendaStatus: "klade", items: TEMPLATE.map(t => ({ id: uid(), title: t, note: "", follow: t === FOLLOW_UP || undefined })), minutes: null, createdAt: new Date().toISOString() };
      await B.saveMeeting(n); meetings[id] = n; S.cur = id; S.aDraft = { date: "", time: "", place: "", items: clone(n.items) }; break; }
    case "open": S.cur = el.getAttribute("data-m"); S.aDraft = S.mDraft = null; S.importText = ""; location.hash = "#moede-" + S.cur; window.scrollTo(0, 0); break;
    case "back": S.cur = null; S.aDraft = S.mDraft = null; if (hashMeeting()) location.hash = "#moeder"; break;
    case "del": if (!S.confirmDel) { S.confirmDel = true; break; }
      for (const t of meetingTasks(m.id)) { delete tasks[t.id]; await B.deleteTask(t.id); }
      delete meetings[m.id]; await B.deleteMeeting(m.id); S.cur = null; S.confirmDel = false; toast("Mødet er slettet"); break;
    case "a-edit": S.aDraft = { date: m.date || "", time: m.time || "", place: m.place || "", items: clone(m.items || []) }; break;
    case "a-add": S.aDraft.items.push({ id: uid(), title: "", note: "" }); break;
    case "a-del": S.aDraft.items.splice(i, 1); break;
    case "a-up": case "a-down": { const j = a === "a-up" ? i - 1 : i + 1, it = S.aDraft.items, tmp = it[i]; it[i] = it[j]; it[j] = tmp; break; }
    case "a-cancel": S.aDraft = null; break;
    case "a-save": case "a-approve": { const d = S.aDraft, ok = a === "a-approve";
      if (ok && !d.date) { S.err = "Vælg en mødedato, før dagsordenen godkendes."; break; }
      if (d.items.some(x => !x.title.trim())) { S.err = "Alle punkter skal have en titel. Fjern tomme punkter."; break; }
      const n = clone(m); n.date = d.date; n.time = d.time; n.place = d.place.trim(); n.agendaStatus = ok ? "godkendt" : "klade";
      n.items = d.items.map(x => { const o = { id: x.id, title: x.title.trim(), note: (x.note || "").trim() }; if (x.by) o.by = x.by; if (isFollowUp(x)) o.follow = true; return o; });
      const same = JSON.stringify([m.date, m.time, m.place, m.items]) === JSON.stringify([n.date, n.time, n.place, n.items]);
      if (!same) { delete n.agendaSentAt; delete n.agendaSentBy; }
      await B.saveMeeting(n); meetings[m.id] = n; S.aDraft = null; toast(ok ? (n.agendaSentAt ? "Dagsorden godkendt" : "Dagsorden godkendt - send den til medlemmerne") : "Klade gemt"); break; }
    case "a-send": {
      const to = memberList().map(mb => mb.email);
      if (!to.length) { S.err = "Der er ingen medlemmer at sende til. Opret dem under Medlemmer."; break; }
      const subject = "Dagsorden - bestyrelsesmøde " + fdate(m.date, true);
      const body = ["Hej", "", "Dagsordenen til bestyrelsesmødet " + fdate(m.date, true) + (m.time ? " kl. " + m.time : "") + (m.place ? " i " + m.place : "") + " er klar.",
        "", meetingUrl(m.id), "", "Opgaver og referat ligger samme sted.", "", "Mvh", me.name].join("\n");
      openMail(mailtoUrl(to, subject, body));
      const n = clone(m); n.agendaSentAt = new Date().toISOString(); n.agendaSentBy = me.email;
      await B.saveMeeting(n); meetings[m.id] = n;
      toast("Mailen er åbnet med " + to.length + " modtagere");
      break; }
    case "copy-a": case "copy-m": try { await navigator.clipboard.writeText(a === "copy-a" ? agendaText(m) : minutesText(m)); toast("Kopieret"); } catch (e) { toast("Kunne ikke kopiere fra denne visning"); } return;
    case "m-blank": case "m-edit": S.mDraft = minutesDraft(m); break;
    case "m-import": try { S.mDraft = importDraft(m, S.importText); S.importText = ""; toast("Kladen er indlæst - ret til og gem"); } catch (e) { S.err = "Kladen kunne ikke læses. Indsæt hele teksten fra Claude, fra første { til sidste }."; } break;
    case "m-cancel": S.mDraft = null; break;
    case "m-discard": { const n = clone(m); n.minutes = null; await B.saveMeeting(n); meetings[m.id] = n;
      for (const t of meetingTasks(m.id)) if (!t.done) { delete tasks[t.id]; await B.deleteTask(t.id); } S.mDraft = null; toast("Kladen er kasseret"); break; }
    case "t-add": S.mDraft.tasks.push({ id: uid(), meetingId: m.id, itemId: "", text: "", ownerEmail: "", due: "", done: false, doneAt: "", createdAt: new Date().toISOString() }); break;
    case "t-del": S.mDraft.tasks.splice(i, 1); break;
    case "m-save": case "m-approve": { const ok = a === "m-approve", d = S.mDraft;
      if (ok) { const miss = (m.items || []).filter(x => !d.items[x.id].summary.trim());
        if (miss.length) { S.err = "Alle punkter skal have et resumé. Mangler: " + miss.map(x => x.title).join(", ") + "."; break; }
        if (d.tasks.some(t => t.text.trim() && !t.ownerEmail)) { S.err = "Alle opgaver skal have en ansvarlig, før referatet godkendes."; break; } }
      await saveMinutes(m, ok ? "godkendt" : "klade"); S.mDraft = null; toast(ok ? "Referat godkendt" : "Klade gemt"); break; }
    case "p-add": { const title = val("p-title"); if (!title) { S.err = "Skriv et emne for forslaget."; break; }
      const p = { id: uid(), title, note: val("p-note"), meetingId: val("p-meet"), byEmail: me.email, status: "afventer", createdAt: new Date().toISOString() };
      await B.saveProposal(p); proposals[p.id] = p; toast("Forslaget er sendt til formanden"); break; }
    case "p-ok": { const p = proposals[el.getAttribute("data-p")], mid = val("pm-" + p.id) || p.meetingId, mt = meetings[mid];
      if (!mt) { S.err = "Vælg det møde, forslaget skal på."; break; }
      const n = clone(mt); n.items = (n.items || []).concat([{ id: uid(), title: p.title, note: p.note || "", by: p.byEmail }]);
      await B.saveMeeting(n); meetings[mid] = n; const np = { ...p, status: "godkendt", meetingId: mid }; await B.saveProposal(np); proposals[p.id] = np; toast("Forslaget er sat på dagsordenen"); break; }
    case "p-no": { const p = proposals[el.getAttribute("data-p")], np = { ...p, status: "afvist" }; await B.saveProposal(np); proposals[p.id] = np; break; }
    case "p-del": { const id = el.getAttribute("data-p"); delete proposals[id]; await B.deleteProposal(id); break; }
    case "mb-add": { const email = val("mb-mail").toLowerCase(), name = val("mb-name"); if (!name || !/^\S+@\S+\.\S+$/.test(email)) { S.err = "Skriv både navn og en gyldig mail."; break; }
      if (email === me.email && val("mb-role") !== "formand") { S.err = "Du kan ikke fjerne formandsrollen fra dig selv."; break; }
      const mb = { name, email, role: val("mb-role") }; await B.saveMember(mb); members[email] = mb; if (email === me.email) me = mb; toast("Medlemmet er gemt"); break; }
    case "mb-del": { const e = el.getAttribute("data-e"); delete members[e]; await B.deleteMember(e); break; }
  }
  render();
}
function fail(e) { toast(e && e.code === "permission-denied" ? "Du har ikke rettighed til det" : "Kunne ikke gemme - tjek forbindelsen"); render(); }

document.addEventListener("click", e => { const el = e.target.closest("[data-act]"); if (!el || el.type === "checkbox" || el.disabled) return; act(el.getAttribute("data-act"), el).catch(fail); });
app.addEventListener("change", e => {
  const el = e.target;
  if (el.getAttribute("data-act") === "toggle") {
    const t = tasks[el.getAttribute("data-t")]; if (!t) return; const old = t, n = { ...t, done: el.checked, doneAt: el.checked ? new Date().toISOString() : "" };
    tasks[t.id] = n; render(); B.toggleTask(n).catch(err => { tasks[t.id] = old; fail(err); }); return;
  }
  if (el.hasAttribute("data-flt")) { S[el.getAttribute("data-flt")] = el.value; render(); }
});
app.addEventListener("input", e => {
  const el = e.target, k = el.getAttribute("data-k");
  if (el.hasAttribute("data-imp")) S.importText = el.value;
  else if (el.hasAttribute("data-a") && S.aDraft) S.aDraft[el.getAttribute("data-a")] = el.value;
  else if (el.hasAttribute("data-ai") && S.aDraft) S.aDraft.items[+el.getAttribute("data-ai")][k] = el.value;
  else if (el.hasAttribute("data-mf") && S.mDraft) S.mDraft[el.getAttribute("data-mf")] = el.value;
  else if (el.hasAttribute("data-mi") && S.mDraft) S.mDraft.items[el.getAttribute("data-mi")][k] = el.value;
  else if (el.hasAttribute("data-ti") && S.mDraft) S.mDraft.tasks[+el.getAttribute("data-ti")][k] = el.value;
});
window.addEventListener("hashchange", () => { S.err = ""; render(); });
document.getElementById("nav-moeder").addEventListener("click", () => { if (editing()) return; S.cur = null; if (hashMeeting()) location.hash = "#moeder"; else render(); });

render();
if (!LOCAL && "serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => { });
B.start().catch(() => { authState = "error"; render(); });
