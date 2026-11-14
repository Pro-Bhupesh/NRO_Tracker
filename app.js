import { PHASES, OWN, ACTS, SALES_GROUPS, DISTRICTS, DRAW_SLOTS, TERRITORY, LETTER_PREFIX, TARGET_DAYS, STALL_DAYS, UPDATE_DAYS_PER_WEEK, SITE_RADIUS_M } from "./data.js";
import { initStore, DEMO, DEL, blankActs } from "./store.js";

/* ---------- helpers ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const iso = d => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
const today = () => iso(new Date());
const dOf = s => new Date(s + "T00:00:00");
const fmt = s => s ? dOf(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "";
const fmtY = s => s ? dOf(s).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "";
const diff = (a, b) => Math.round((dOf(a) - dOf(b)) / 864e5);
const addDays = (s, n) => { const d = dOf(s); d.setDate(d.getDate() + n); return iso(d); };
const weekStart = s => addDays(s, -((dOf(s).getDay() + 6) % 7));
const hhmm = () => new Date().toTimeString().slice(0, 5);
const uniq = a => [...new Set(a)];
const ROLE = { admin: "Admin", eo: "EO", pmc: "PMC", tm: "TM", pending: "No access" };
const ERR = { "auth/invalid-credential": "Wrong User ID or password", "auth/wrong-password": "Wrong User ID or password", "auth/user-not-found": "Wrong User ID or password", "auth/invalid-email": "Wrong User ID or password", "auth/email-already-in-use": "That User ID already has a login. To reset a forgotten password, first delete that user in the Firebase console under Authentication, then add the same User ID again here.", "auth/weak-password": "Password must be at least 6 characters", "auth/too-many-requests": "Too many attempts. Wait a few minutes and try again.", "auth/network-request-failed": "No network connection" };

/* ---------- state ---------- */
let store, me = null, sites = [], users = [], letters = [], std = [], visitsAll = [];
const sub = {}; // per-site loaded sub-collections
const R = { tab: "dash", siteId: null, sub: "acts", week: weekStart(today()), fEO: "", letter: null };
const L = { siteId: "", act: 0, type: "Delay", obs: "" };

const isAdmin = () => me.role === "admin";
const isEO = () => me.role === "eo" || me.role === "admin";
const canMake = s => me.role === "admin" || (me.role === "pmc" && s.pmcUid === me.uid); // maker: PMC of the site
const site = id => sites.find(s => s.id === id);
const actName = i => ACTS[i - 1][0];
const owner = (s, i) => (s.acts[i] && s.acts[i].own) || ACTS[i - 1][s.cat === "CC" ? 2 : 3];

/* ---------- calculations ---------- */
function phasePct(s, pi) { let sum = 0, n = 0; ACTS.forEach((a, k) => { const x = s.acts[k + 1]; if (a[1] === pi && x.s !== "N") { sum += x.p; n++; } }); return n ? Math.round(sum / n) : null; }
function overall(s) { let t = 0, w = 0; PHASES.forEach((ph, pi) => { const p = phasePct(s, pi); if (p !== null) { t += ph[1] * p; w += ph[1]; } }); return w ? Math.round(t / w) : 0; }
function byOwner(s, k) { let sum = 0, n = 0; ACTS.forEach((a, j) => { const x = s.acts[j + 1]; if (owner(s, j + 1) === k && x.s !== "N") { sum += x.p; n++; } }); return n ? Math.round(sum / n) : 0; }
const dayNo = s => s.startDate ? Math.max(1, diff(today(), s.startDate) + 1) : 0;
function health(s) { if (!s.startDate) return ["", "Not started"]; const gap = overall(s) - Math.min(100, Math.round(dayNo(s) / (s.targetDays || TARGET_DAYS) * 100)); return gap < -20 ? ["bad", "Delayed"] : gap < -5 ? ["warn", "At risk"] : ["ok", "On track"]; }
const stalledDays = (s, i) => { const x = s.acts[i]; return x.s === "W" && x.chg && diff(today(), x.chg) >= STALL_DAYS ? diff(today(), x.chg) : 0; };
const stalledList = s => ACTS.map((a, k) => k + 1).filter(i => stalledDays(s, i));
const updInWeek = (s, ws) => uniq((s.updDays || []).filter(d => d >= ws && d <= addDays(ws, 6)));
const drawCount = s => DRAW_SLOTS.filter(d => s.draw && s.draw[d[0]]).length;
function planState(s, d) { if ((s.visitDays || []).includes(d)) return "done"; if (s.plan && s.plan[d]) return d < today() ? "missed" : "planned"; return ""; }

/* ---------- small UI pieces ---------- */
const chip = (c, t) => `<span class="chip ${c ? "c-" + c : ""}">${esc(t)}</span>`;
const stChip = x => x.s === "C" ? chip("ok", "Completed") : x.s === "W" ? chip("warn", "In progress") : x.s === "N" ? chip("", "Not applicable") : chip("", "Yet to start");
const pm = p => `<div class="pm"><div class="meter" role="img" aria-label="${p} percent"><i style="width:${p}%"></i></div><span>${p}%</span></div>`;
const photoCard = (p, s) => `<a class="ph" href="${esc(p.url)}" target="_blank" rel="noopener"><div class="img"><img src="${esc(p.url)}" alt="" loading="lazy"></div><b>${esc(actName(p.act))}</b><span>${s ? esc(s.name) + " &middot; " : ""}${fmt(p.date)}</span></a>`;
function dots(s, ws) { const u = updInWeek(s, ws); return `<div class="dots" aria-label="${u.length} of ${UPDATE_DAYS_PER_WEEK} update days">${[0, 1, 2, 3, 4, 5, 6].map(k => `<i class="${u.includes(addDays(ws, k)) ? "on" : ""}">${"MTWTFSS"[k]}</i>`).join("")}</div>`; }
const head = (title, crumb, right) => `<div class="head"><div>${crumb ? `<div class="crumb">${crumb}</div>` : ""}<h1>${title}</h1></div><div class="row">${right || ""}</div></div>`;
const opt = (v, t, sel) => `<option value="${esc(v)}"${String(v) === String(sel ?? "") ? " selected" : ""}>${esc(t)}</option>`;
function toast(msg, bad) { const t = $("toast"); t.textContent = msg; t.className = "toast show" + (bad ? " bad" : ""); clearTimeout(toast.t); toast.t = setTimeout(() => t.className = "toast", 4000); }
function busy(on) { $("busy").hidden = !on; }
function dlg(title, body, form, okText = "Save", wide = false) {
  $("ovl").innerHTML = `<div class="ovl"><form class="dlg${wide ? " wide" : ""}" data-f="${form}" role="dialog" aria-modal="true"><div class="ptitle"><h2>${esc(title)}</h2><button type="button" class="btn alt sm" data-a="closedlg">Cancel</button></div><div class="pad">${body}<div class="row"><button class="btn" type="submit">${esc(okText)}</button></div></div></form></div>`;
  const f = $("ovl").querySelector("input:not([type=hidden]),select,textarea"); if (f) f.focus();
}
const closeDlg = () => $("ovl").innerHTML = "";

/* ---------- photo handling ---------- */
function getPos() { return new Promise(r => { if (!navigator.geolocation) return r(null); navigator.geolocation.getCurrentPosition(p => r({ lat: p.coords.latitude, lng: p.coords.longitude }), () => r(null), { enableHighAccuracy: true, timeout: 8000 }); }); }
function distM(a, b) { const k = Math.PI / 180, x = (b.lng - a.lng) * k * Math.cos((a.lat + b.lat) * k / 2), y = (b.lat - a.lat) * k; return Math.round(Math.sqrt(x * x + y * y) * 6371000); }
async function compress(file, stamp) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Could not read the photo")); i.src = URL.createObjectURL(file); });
  const k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement("canvas");
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  const g = c.getContext("2d"); g.drawImage(img, 0, 0, c.width, c.height);
  const h = Math.max(22, Math.round(c.width / 45)); g.fillStyle = "rgba(0,0,0,.55)"; g.fillRect(0, c.height - h * 1.6, c.width, h * 1.6);
  g.fillStyle = "#fff"; g.font = `${h}px sans-serif`; g.textBaseline = "middle"; g.fillText(stamp, h * .5, c.height - h * .8, c.width - h);
  return new Promise(r => c.toBlob(r, "image/jpeg", .72));
}

/* ---------- data loading ---------- */
async function refresh() {
  sites = (await store.listSites(me)).sort((a, b) => a.name.localeCompare(b.name));
  if (isEO() && (R.tab === "users" || !users.length)) users = await store.listUsers();
  if (R.tab === "letters") { letters = await store.topList("letters"); if (!site(L.siteId) && sites[0]) { L.siteId = sites[0].id; L.act = firstOpen(sites[0]); } }
  if (R.tab === "draw") std = await store.topList("std");
  if (R.tab === "visits") { visitsAll = []; for (const s of sites) (await store.subList(s.id, "visits", 10)).forEach(v => visitsAll.push({ ...v, site: s.name })); visitsAll.sort((a, b) => b.ts.localeCompare(a.ts)); }
  if (R.tab === "sites" && R.siteId && site(R.siteId)) {
    const name = { acts: null, photos: "updates", log: "updates", visits: "visits", meas: "meas", mom: "mom", draw: null }[R.sub];
    if (name) (sub[R.siteId] = sub[R.siteId] || {})[name] = await store.subList(R.siteId, name);
  } else if (R.tab === "sites") R.siteId = null;
}
async function go(patch) { Object.assign(R, patch); await run(refresh); }
async function run(fn) { busy(true); try { await fn(); } catch (e) { console.error(e); toast(ERR[e.code] || e.message || String(e), true); } finally { busy(false); render(); } }
const firstOpen = s => ACTS.map((a, k) => k + 1).find(i => "WY".includes(s.acts[i].s)) || 1;

/* ---------- views ---------- */
const PIN = '<svg class="pin" viewBox="0 0 48 60" aria-hidden="true"><path d="M24 2C12 2 4 11 4 22c0 14 20 34 20 34s20-20 20-34C44 11 36 2 24 2z" fill="#f5b400"/><circle cx="24" cy="22" r="14" fill="#fff"/><path d="M17 14h9v16h-9zm11 4 3 3v7a1.5 1.5 0 0 1-3 0zM19 16h5v5h-5z" fill="#0a3a8c" fill-rule="evenodd"/></svg>';
const CRANE = '<svg class="crane" viewBox="0 0 220 110" aria-hidden="true"><g fill="none" stroke="#0a3a8c" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M84 96V18m10 78V18M84 18h10M84 34l10-16M84 50l10-16M84 66l10-16M84 82l10-16M60 18h110M89 6l-29 12m29-12 81 12M150 18v22m-6 0h12M70 18v8"/><path d="M20 96V66h34v30M20 76h34M20 86h34M31 66v30M43 66v30" opacity=".75"/><path d="M110 96V60h30v36M110 72h30M110 84h30M125 60v36" opacity=".75"/></g><path d="M8 100c50-10 110 8 204-8" fill="none" stroke="#f5b400" stroke-width="4" stroke-linecap="round"/></svg>';
function vAuth() {
  const fld = (name, type, ph, ic, extra = "") => `<label class="fld"><svg viewBox="0 0 24 24" aria-hidden="true">${ic}</svg><input name="${name}" type="${type}" placeholder="${ph}" aria-label="${ph}" required ${extra}>${type === "password" ? `<button type="button" class="eye" data-a="eye" aria-label="Show password"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5C6 5 2 12 2 12s4 7 10 7 10-7 10-7-4-7-10-7zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm0-2a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/></svg></button>` : ""}</label>`;
  const U = '<path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zm-8 9c0-4 3.6-7 8-7s8 3 8 7z"/>', K = '<path d="M7 10V8a5 5 0 0 1 10 0v2h2v11H5V10zm2 0h6V8a3 3 0 0 0-6 0zm3 4a1.6 1.6 0 0 0-1 2.9V19h2v-2.1A1.6 1.6 0 0 0 12 14z" fill-rule="evenodd"/>';
  return `<div class="auth split"><div class="hero">
    <div class="hbrand"><div class="hname"><b>NRO</b> Tracker</div>${PIN}</div>
    <div class="tbe"><span>Track</span><span class="g">Build</span><span>Energise</span></div>
    </div>
    <form class="dlg card" data-f="login"><div class="pad">${CRANE}
    <div class="hname sm"><b>NRO</b> Tracker</div>
    <p class="note center">${TERRITORY}</p>
    ${DEMO ? `<p class="note center">Demo mode: Firebase is not configured yet. There are no sites; anything you add is kept only in this browser. Enter as:</p>
      <div class="row center">${[["admin", "Admin"], ["eo2", "EO"], ["pmc1", "PMC"], ["tm", "TM"]].map(u => `<button type="button" class="btn alt" data-a="demo" data-v="${u[0]}">${u[1]}</button>`).join("")}</div>
      <p class="note center"><button type="button" class="link" data-a="resetdemo">Reset demo data</button></p>`
      : `${fld("uid", "text", "User ID", U, 'autocomplete="username" autocapitalize="none" spellcheck="false"')}${fld("pw", "password", "Password", K, 'autocomplete="current-password"')}
      <button class="btn wide" type="submit">Sign In</button>
      <p class="note center">Logins are issued by the admin. If you have forgotten your password, ask the admin for a new login.</p>`}
  </div></form></div>`;
}
function vPending() { return `<div class="auth"><div class="dlg"><div class="pad"><div class="brand dark"><b>NRO <i>Tracker</i></b><span>${TERRITORY}</span></div><h2>No access</h2><p>${esc(me.name)}, this login has no role at present. Ask the admin to give you access.</p><div class="row"><button class="btn" data-a="reload">Check again</button><button class="btn alt" data-a="logout">Sign out</button></div></div></div></div>`; }

function attention() {
  let ex = [];const ws = weekStart(today());
  sites.filter(s => s.status !== "commissioned").forEach(s => {
    stalledList(s).forEach(i => ex.push(["bad", s, `${actName(i)}: no progress for ${stalledDays(s, i)} days (${OWN[owner(s, i)]})`]));
    Object.keys(s.plan || {}).filter(d => d >= addDays(today(), -14) && planState(s, d) === "missed").forEach(d => ex.push(["bad", s, `Planned visit on ${fmt(d)} was missed`]));
    const u = updInWeek(s, ws).length; if (u < UPDATE_DAYS_PER_WEEK) ex.push(["warn", s, `${u} of ${UPDATE_DAYS_PER_WEEK} update days this week`]);
    DRAW_SLOTS.forEach(d => { if (!(s.draw && s.draw[d[0]])) ex.push(["warn", s, `${d[1]} not uploaded`]); });
    if (!s.sg || !s.soName) ex.push(["warn", s, "Sales group or SO not mapped"]);
  });
  ex.sort((a, b) => (a[0] === "bad" ? 0 : 1) - (b[0] === "bad" ? 0 : 1));
  return ex;
}
function vDash() {
  const act = sites.filter(s => s.status !== "commissioned"), n = act.length, ws = weekStart(today());
  const avg = n ? Math.round(act.reduce((a, s) => a + overall(s), 0) / n) : 0;
  let done = 0, planned = 0; act.forEach(s => { for (let k = 0; k < 7; k++) { const st = planState(s, addDays(ws, k)); if (st) planned++; if (st === "done") done++; } });
  const ex = attention(), latest = [];
  act.forEach(s => (s.lastPhotos || []).slice(0, 2).forEach(p => latest.push([p, s]))); latest.sort((a, b) => b[0].date.localeCompare(a[0].date));
  const kp = [["Active NROs", n, `${act.filter(s => s.cat === "CC").length} CC, ${act.filter(s => s.cat === "DC").length} DC`], ["Average progress", avg + "%", "weighted by phase"], ["At risk or delayed", act.filter(s => ["bad", "warn"].includes(health(s)[0])).length, "against target days"], ["Visits this week", `${done} / ${planned}`, "done / planned"], [`${UPDATE_DAYS_PER_WEEK}-day update rule`, `${act.filter(s => updInWeek(s, ws).length >= UPDATE_DAYS_PER_WEEK).length} / ${n}`, "sites compliant this week"], ["Stalled activities", act.reduce((a, s) => a + stalledList(s).length, 0), `no change for ${STALL_DAYS}+ days`]];
  return head("Overview", "", isEO() ? `<button class="btn" data-a="siteform">New NRO</button>` : "") + `
  <div class="panel kpis">${kp.map(k => `<div class="kpi"><span>${k[0]}</span><b>${k[1]}</b><small>${k[2]}</small></div>`).join("")}</div>
  <div class="panel"><div class="ptitle"><h2>Projects</h2><span class="note">Click a row to open</span></div><div class="tw"><table><thead><tr><th>Site</th><th>Type</th><th>EO / SO</th><th>Schedule</th><th>Phases</th><th>Overall</th><th class="n">Contractor</th><th class="n">Dealer</th><th class="n">Day</th><th>Updates this week</th></tr></thead><tbody>
  ${act.map(s => { const h = health(s); return `<tr class="click" data-a="open" data-v="${s.id}" tabindex="0"><td><b>${esc(s.name)}</b><br><span class="note">${esc(s.place)}</span></td><td><span class="tag cat">${s.cat}</span></td><td>${esc(s.eoName || "Not mapped")}<br><span class="note">${esc(s.soName || "SO not mapped")}</span></td><td>${chip(h[0], h[1])}</td><td><div class="phases">${PHASES.map((p, pi) => `<i title="${p[0]}"><b style="width:${phasePct(s, pi) || 0}%"></b></i>`).join("")}</div></td><td>${pm(overall(s))}</td><td class="n">${byOwner(s, "C")}%</td><td class="n">${byOwner(s, "D")}%</td><td class="n">${dayNo(s)} / ${s.targetDays || TARGET_DAYS}</td><td>${dots(s, ws)}</td></tr>`; }).join("") || `<tr><td colspan="10" class="note">No projects yet.${isEO() ? " Use New NRO to add the first site." : ""}</td></tr>`}
  </tbody></table></div></div>
  <div class="grid two">
    <div class="panel"><div class="ptitle"><h2>Needs attention</h2><span class="note">${ex.length} items</span></div><ul class="att">${ex.slice(0, 12).map(e => `<li class="${e[0]} click" data-a="open" data-v="${e[1].id}" tabindex="0"><div><b>${esc(e[1].name)}</b><br><span class="note">${esc(e[2])}</span></div></li>`).join("") || `<li class="none"><span class="note">Nothing pending.</span></li>`}${ex.length > 12 ? `<li class="none"><span class="note">and ${ex.length - 12} more. Open a project to see all its items.</span></li>` : ""}</ul></div>
    <div class="panel"><div class="ptitle"><h2>Latest photographs</h2></div><div class="pad"><div class="photos">${latest.slice(0, 8).map(x => photoCard(x[0], x[1])).join("") || `<span class="note">No photos uploaded yet.</span>`}</div></div></div>
  </div>`;
}

function vSiteList() {
  const eos = uniq(sites.map(s => s.eoName).filter(Boolean)), list = sites.filter(s => !R.fEO || s.eoName === R.fEO);
  return head("Projects", "", `<label class="inline">EO <select data-c="feo"><option value="">All</option>${eos.map(e => opt(e, e, R.fEO)).join("")}</select></label>${isEO() ? `<button class="btn" data-a="siteform">New NRO</button>` : ""}`) +
    `<div class="panel tw"><table><thead><tr><th>Site</th><th>District</th><th>Type</th><th>Sales group</th><th>EO</th><th>SO</th><th>Contractor</th><th>PMC</th><th>Schedule</th><th>Overall</th></tr></thead><tbody>${list.map(s => { const h = health(s); return `<tr class="click" data-a="open" data-v="${s.id}" tabindex="0"><td><b>${esc(s.name)}</b><br><span class="note">${esc(s.place)}</span></td><td>${esc(s.district)}</td><td><span class="tag cat">${s.cat}</span></td><td>${esc(s.sg || "Not mapped")}</td><td>${esc(s.eoName || "Not mapped")}</td><td>${esc(s.soName || "Not mapped")}</td><td>${esc(s.contractor || "")}</td><td>${esc(s.pmcName || "Not assigned")}</td><td>${s.status === "commissioned" ? chip("ok", "Commissioned") : chip(h[0], h[1])}</td><td>${pm(overall(s))}</td></tr>`; }).join("") || `<tr><td colspan="10" class="note">No projects.</td></tr>`}</tbody></table></div>`;
}

function vSite() {
  const s = site(R.siteId), mk = canMake(s), h = health(s), d = sub[s.id] || {};
  const tabs = [["acts", "Activities"], ["photos", "Photos"], ["visits", "Visits"], ["meas", "Measurements"], ["mom", "MoM"], ["draw", `Drawings (${drawCount(s)}/${DRAW_SLOTS.length})`], ["log", "Update log"]];
  let body = "";
  if (R.sub === "acts") body = `${isEO() ? `<div class="row"><button class="btn alt" data-a="openform">Enter opening status</button><span class="note">For a site already under construction: set all activities in one go, no photos needed.</span></div>` : ""}<div class="panel">${PHASES.map((ph, pi) => { const pp = phasePct(s, pi) || 0; return `<details ${pp < 100 ? "open" : ""}><summary>${ph[0]}${pm(pp)}</summary><div class="tw"><table class="acts"><thead><tr><th class="n">No</th><th>Activity</th><th>Scope</th><th>Status</th><th>Progress</th><th>Pending item</th><th>Last change</th><th></th></tr></thead><tbody>${ACTS.map((a, k) => { if (a[1] !== pi) return ""; const i = k + 1, x = s.acts[i], sd = stalledDays(s, i); return `<tr><td class="n">${i}</td><td>${esc(a[0])}${sd ? " " + chip("bad", `Stalled ${sd} days`) : ""}</td><td>${OWN[owner(s, i)]}</td><td>${stChip(x)}</td><td>${x.s === "N" ? "" : pm(x.p)}</td><td>${esc(x.note || "")}</td><td>${fmt(x.chg)}</td><td><span class="row">${mk ? `<button class="btn alt sm" data-a="actform" data-v="${i}">Update</button>` : ""}${isEO() ? `<button class="btn alt sm" data-a="scopeform" data-v="${i}">Scope</button>` : ""}</span></td></tr>`; }).join("")}</tbody></table></div></details>`; }).join("")}</div>`;
  if (R.sub === "photos") { const ph = (d.updates || []).filter(u => u.photo); body = `<div class="panel"><div class="ptitle"><h2>Photo timeline</h2>${mk ? `<button class="btn sm" data-a="photoform">Add photo</button>` : ""}</div><div class="pad"><div class="photos">${ph.map(u => photoCard({ url: u.photo.url, act: u.act, date: u.date })).join("") || `<span class="note">No photos yet.</span>`}</div></div></div>`; }
  if (R.sub === "visits") { const open = (d.visits || []).find(v => !v.outAt && v.date === today() && v.uid === me.uid); body = `<div class="panel"><div class="ptitle"><h2>Site visits</h2>${mk ? (open ? `<button class="btn gold sm" data-a="checkout" data-v="${open.id}">Check out</button>` : `<button class="btn gold sm" data-a="checkin">Check in at site</button>`) : ""}</div><div class="tw"><table><thead><tr><th>Date</th><th>By</th><th>In</th><th>Out</th><th>Location check</th><th>Present</th><th>Remarks</th></tr></thead><tbody>${(d.visits || []).map(v => `<tr><td>${fmt(v.date)}</td><td>${esc(v.name)}</td><td>${esc(v.inAt)}</td><td>${esc(v.outAt || "Open")}</td><td>${v.atSite === true ? chip("ok", "At site") : v.atSite === false ? chip("bad", `${v.dist} m away`) : chip("", "Not verified")}</td><td>${esc(v.present || "")}</td><td>${esc(v.remarks || "")}</td></tr>`).join("") || `<tr><td colspan="7" class="note">No visits recorded.</td></tr>`}</tbody></table></div>${s.lat == null ? `<div class="pad"><p class="note">Site coordinates are not set, so check-ins cannot be verified. The EO can add them in Edit details.</p></div>` : ""}</div>`; }
  if (R.sub === "meas") body = `<div class="panel"><div class="ptitle"><h2>Measurements, contractor scope</h2>${mk ? `<button class="btn sm" data-a="measform">Add measurement</button>` : ""}</div><div class="tw"><table><thead><tr><th>BOQ item</th><th class="n">Nos</th><th class="n">L</th><th class="n">B</th><th class="n">D</th><th class="n">Measured</th><th class="n">BOQ qty</th><th>Check</th><th></th></tr></thead><tbody>${(d.meas || []).map(m => { const q = m.n * m.l * m.b * m.d; return `<tr><td>${esc(m.item)}</td><td class="n">${m.n}</td><td class="n">${m.l}</td><td class="n">${m.b}</td><td class="n">${m.d}</td><td class="n">${q.toFixed(2)} ${esc(m.unit)}</td><td class="n">${m.boq || ""} ${m.boq ? esc(m.unit) : ""}</td><td>${!m.boq ? chip("", "No BOQ qty") : q > m.boq ? chip("bad", "Over by " + (q - m.boq).toFixed(2)) : chip("ok", "Within BOQ")}</td><td>${mk ? `<button class="btn alt sm" data-a="delmeas" data-v="${m.id}">Delete</button>` : ""}</td></tr>`; }).join("") || `<tr><td colspan="9" class="note">No measurements yet.</td></tr>`}</tbody></table></div></div>`;
  if (R.sub === "mom") body = `<div class="panel"><div class="ptitle"><h2>MoM action points</h2>${mk || isEO() ? `<button class="btn sm" data-a="momform">Add point</button>` : ""}</div><div class="tw"><table><thead><tr><th>Date</th><th>Point</th><th>Owner</th><th>Target</th><th>Status</th><th></th></tr></thead><tbody>${(d.mom || []).map(m => `<tr><td>${fmt(m.date)}</td><td>${esc(m.t)}</td><td>${esc(m.o)}</td><td>${fmt(m.d)}${m.open && m.d && m.d < today() ? " " + chip("bad", "Overdue") : ""}</td><td>${m.open ? chip("warn", "Open") : chip("ok", "Closed")}</td><td>${m.open && (mk || isEO()) ? `<button class="btn alt sm" data-a="closemom" data-v="${m.id}">Close</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="6" class="note">No points yet.</td></tr>`}</tbody></table></div></div>`;
  if (R.sub === "draw") body = `<div class="panel"><div class="ptitle"><h2>Site-specific drawings</h2></div><div class="tw"><table><thead><tr><th>Drawing</th><th>Status</th><th>Revision</th><th>Uploaded</th><th>Earlier revisions</th><th></th></tr></thead><tbody>${DRAW_SLOTS.map(([k, n]) => { const x = s.draw && s.draw[k]; return `<tr><td>${x && x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${n}</a>` : n}</td><td>${x ? chip("ok", "Uploaded") : chip("bad", "Not uploaded")}</td><td>${x ? "R" + x.rev : ""}</td><td>${x ? esc(x.by) + ", " + fmt(x.date) : ""}</td><td>${x && x.hist ? x.hist.map(o => `<a href="${esc(o.url)}" target="_blank" rel="noopener">R${o.rev}</a>`).join(", ") : ""}</td><td>${mk ? `<button class="btn alt sm" data-a="drawform" data-v="${k}">Upload PDF</button>` : ""}</td></tr>`; }).join("")}</tbody></table></div></div>`;
  if (R.sub === "log") body = `<div class="panel"><div class="ptitle"><h2>Update log</h2><span class="note">Every PMC entry, newest first</span></div><div class="tw"><table><thead><tr><th>Date</th><th>Activity</th><th>Entry</th><th>Note</th><th>By</th><th>Photo</th><th>EO review</th></tr></thead><tbody>${(d.updates || []).map(u => `<tr><td>${fmt(u.date)}</td><td>${u.act ? u.act + ". " + esc(actName(u.act)) : "All activities"}</td><td>${esc(u.to || "Photo only")}</td><td>${esc(u.note || "")}</td><td>${esc(u.name)}</td><td>${u.photo ? `<a href="${esc(u.photo.url)}" target="_blank" rel="noopener">View</a>` : ""}</td><td>${u.chk ? chip("ok", "Reviewed by " + u.chk.by) : isEO() ? `<button class="btn alt sm" data-a="review" data-v="${u.id}">Mark reviewed</button>` : chip("", "Not reviewed")}</td></tr>`).join("") || `<tr><td colspan="7" class="note">No entries yet.</td></tr>`}</tbody></table></div></div>`;
  return head(`${esc(s.name)} <span class="tag cat">${s.cat}</span> ${s.status === "commissioned" ? chip("ok", "Commissioned") : chip(h[0], h[1])}`, `<button data-a="back">Projects</button> / ${esc(s.name)}`, isEO() ? `<button class="btn alt" data-a="siteform" data-v="${s.id}">Edit details</button>` : "") + `
    <div class="panel pad"><div class="facts">
      <div><span>Location</span>${esc(s.place)}, ${esc(s.district)}</div><div><span>Sales group</span>${esc(s.sg || "Not mapped")}</div><div><span>EO</span>${esc(s.eoName || "Not mapped")}</div><div><span>SO</span>${esc(s.soName || "Not mapped")}</div>
      <div><span>Dealer</span>${esc(s.dealer || "Not entered")}</div><div><span>Contractor</span>${esc(s.contractor || "Not entered")}</div><div><span>PMC</span>${esc(s.pmcName || "Not assigned")}</div><div><span>WBSE</span>${esc(s.wbse || "Not entered")}</div>
      <div><span>Work started</span>${fmtY(s.startDate) || "Not entered"}</div><div><span>Day</span>${dayNo(s)} of ${s.targetDays || TARGET_DAYS}</div><div><span>Contractor scope</span>${pm(byOwner(s, "C"))}</div><div><span>Dealer scope</span>${pm(byOwner(s, "D"))}</div>
    </div></div>
    <div class="panel steps">${PHASES.map((ph, pi) => { const pp = phasePct(s, pi) || 0; return `<div class="step"><span>${pi + 1}. ${ph[0]}</span><b>${pp}%</b><div class="meter"><i style="width:${pp}%"></i></div></div>`; }).join("")}<div class="step total"><span>Overall</span><b>${overall(s)}%</b><div class="meter"><i style="width:${overall(s)}%"></i></div></div></div>
    <div class="tabs" role="tablist">${tabs.map(x => `<button role="tab" aria-selected="${R.sub === x[0]}" data-a="sub" data-v="${x[0]}">${x[1]}</button>`).join("")}</div>${body}`;
}

function vVisits() {
  const ws = R.week, days = [0, 1, 2, 3, 4, 5, 6].map(k => addDays(ws, k)), act = sites.filter(s => s.status !== "commissioned");
  return head("Site visits", "", `<button class="btn alt sm" data-a="week" data-v="-7">Previous week</button><b>${fmt(ws)} to ${fmt(days[6])}</b><button class="btn alt sm" data-a="week" data-v="7">Next week</button>`) + `
  <div class="panel"><div class="ptitle"><h2>Visit planner</h2><span class="note">Tap a cell to plan or cancel a visit</span></div><div class="tw"><table class="plan"><thead><tr><th style="text-align:left">Site</th>${days.map(d => `<th${d === today() ? ' class="now"' : ""}>${dOf(d).toLocaleDateString("en-GB", { weekday: "short" })} ${dOf(d).getDate()}</th>`).join("")}<th>Update days</th></tr></thead><tbody>${act.map(s => { const u = updInWeek(s, ws).length, can = canMake(s) || isEO(); return `<tr><td style="text-align:left"><b>${esc(s.name)}</b><br><span class="note">${esc(s.pmcName || "")}</span></td>${days.map(d => { const v = planState(s, d); return `<td><button class="cell ${v}" ${can && v !== "done" ? `data-a="plan" data-v="${s.id}|${d}"` : "disabled"} aria-label="${esc(s.name)} ${fmt(d)} ${v || "no visit"}">${v ? v[0].toUpperCase() + v.slice(1) : "+"}</button></td>`; }).join("")}<td>${chip(u >= UPDATE_DAYS_PER_WEEK ? "ok" : ws < weekStart(today()) || u === 0 ? "bad" : "warn", `${u} / ${UPDATE_DAYS_PER_WEEK}`)}</td></tr>`; }).join("") || `<tr><td colspan="9" class="note">No active projects.</td></tr>`}</tbody></table></div>
  <div class="pad"><p class="note">A visit is recorded when the PMC checks in at site. An update day is any day with a progress entry that has a photo; ${UPDATE_DAYS_PER_WEEK} are required per site each week.</p></div></div>
  <div class="panel"><div class="ptitle"><h2>Visit record</h2></div><div class="tw"><table><thead><tr><th>Date</th><th>Site</th><th>By</th><th>In</th><th>Out</th><th>Location check</th><th>Remarks</th></tr></thead><tbody>${visitsAll.slice(0, 40).map(v => `<tr><td>${fmt(v.date)}</td><td>${esc(v.site)}</td><td>${esc(v.name)}</td><td>${esc(v.inAt)}</td><td>${esc(v.outAt || "Open")}</td><td>${v.atSite === true ? chip("ok", "At site") : v.atSite === false ? chip("bad", `${v.dist} m away`) : chip("", "Not verified")}</td><td>${esc(v.remarks || "")}</td></tr>`).join("") || `<tr><td colspan="7" class="note">No visits recorded.</td></tr>`}</tbody></table></div></div>`;
}

function vDraw() {
  return head("Drawings", "") + `<div class="panel"><div class="ptitle"><h2>Standard drawings, common to all sites</h2>${isEO() ? `<button class="btn sm" data-a="stdform">Add drawing</button>` : ""}</div><div class="tw"><table><thead><tr><th>Drawing</th><th>Uploaded</th></tr></thead><tbody>${std.map(d => `<tr><td><a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.title)}</a></td><td>${esc(d.by)}, ${fmt(d.date)}</td></tr>`).join("") || `<tr><td colspan="2" class="note">No standard drawings uploaded yet.</td></tr>`}</tbody></table></div></div>
  <div class="panel"><div class="ptitle"><h2>Site-specific drawings</h2></div><div class="tw"><table><thead><tr><th>Site</th>${DRAW_SLOTS.map(d => `<th>${d[1]}</th>`).join("")}</tr></thead><tbody>${sites.map(s => `<tr class="click" data-a="opendraw" data-v="${s.id}" tabindex="0"><td><b>${esc(s.name)}</b></td>${DRAW_SLOTS.map(([k]) => { const x = s.draw && s.draw[k]; return `<td>${x ? chip("ok", "R" + x.rev + ", " + fmt(x.date)) : chip("bad", "Not uploaded")}</td>`; }).join("")}</tr>`).join("") || `<tr><td colspan="4" class="note">No projects.</td></tr>`}</tbody></table></div></div>`;
}

function letterBody() {
  const s = site(L.siteId); if (!s) return "";
  const i = L.act || firstOpen(s), x = s.acts[i], ow = owner(s, i), sd = stalledDays(s, i);
  const to = ow === "D" ? `The Dealer${s.dealer ? ", " + s.dealer : ""}\n${s.name}, ${s.place}` : ow === "C" || ow === "CD" ? `M/s ${s.contractor || "(contractor)"}\nContractor, ${s.name}` : `${OWN[ow]}\n${s.name}`;
  const text = L.type === "Delay"
    ? `Subject: Delay in "${actName(i)}" at ${s.name}\n\nThis refers to the NRO work in progress at ${s.name}, ${s.place}.\n\nAs recorded by the PMC, the activity "${actName(i)}", which is in your scope, stands at ${x.p}% ${sd ? `and has shown no progress for ${sd} days` : "and is behind schedule"}.${x.note ? ` Pending item: ${x.note}.` : ""} The site is on day ${dayNo(s)} of the ${s.targetDays || TARGET_DAYS}-day target.\n\nYou are requested to complete this work within 7 days of this letter and confirm completion to the PMC. Further delay will affect the commissioning schedule.`
    : `Subject: Deviation from approved drawing in "${actName(i)}" at ${s.name}\n\nThis refers to the NRO work in progress at ${s.name}, ${s.place}.\n\nDuring the PMC site visit, the activity "${actName(i)}" was found to deviate from the approved drawing.\n\nObservation: ${L.obs || "(enter the observation)"}\n\nYou are requested to rectify the work as per the approved drawing within 7 days and inform the PMC for re-inspection. Work executed in deviation will not be accepted.`;
  return { to: ow === "D" ? "Dealer" : OWN[ow], text: `To,\n${to}\n\n${text}` };
}
const letterFull = l => `Ref: ${l.ref || "(draft, not issued)"}\nDate: ${fmtY(l.issued || l.date)}\n\n${l.body}\n\n\n${l.signName || ""}\n${l.signRole || "Engineering Officer"}\n${TERRITORY}`;
function vLetters() {
  if (R.letter) { const l = letters.find(x => x.id === R.letter); if (l) return head(`Letter ${esc(l.ref || "(draft)")}`, `<button data-a="letterback">Letters</button> / ${esc(l.siteName)}`, `<button class="btn" data-a="print">Print or save as PDF</button>`) + `<div class="letter print">${esc(letterFull(l))}</div>`; }
  const s = site(L.siteId), vis = letters.filter(l => site(l.siteId)), lb = letterBody();
  const form = !s ? `<p class="note">No projects available.</p>` : `<div class="form">
      <label>Site<select data-c="ltsite">${sites.map(x => opt(x.id, x.name, L.siteId)).join("")}</select></label>
      <label>Type<select data-c="lttype">${opt("Delay", "Delay", L.type)}${opt("Deviation", "Deviation from standard", L.type)}</select></label>
      <label>Activity<select data-c="ltact">${ACTS.map((a, k) => "CN".includes(s.acts[k + 1].s) ? "" : opt(k + 1, `${k + 1}. ${a[0]} (${OWN[owner(s, k + 1)]})${stalledDays(s, k + 1) ? " - stalled" : ""}`, L.act)).join("")}</select></label></div>
      ${L.type === "Deviation" ? `<label>Observation<textarea data-c="ltobs" rows="3" placeholder="What was found against the drawing">${esc(L.obs)}</textarea></label>` : ""}
      <div class="row">${me.role !== "tm" ? `<button class="btn alt" data-a="saveletter" data-v="Draft">Save as draft</button>` : ""}${isEO() ? `<button class="btn gold" data-a="saveletter" data-v="Issued">Issue letter</button>` : ""}</div>
      <p class="note">${isEO() ? "Issuing gives the letter a reference number and your name." : "The PMC can save a draft. The EO issues it."}</p>`;
  return head("Letters", "") + `<div class="grid two"><div class="panel"><div class="ptitle"><h2>New letter</h2></div><div class="pad">${form}</div></div><div class="letter">${esc(lb ? lb.text : "")}</div></div>
  <div class="panel"><div class="ptitle"><h2>Letter log</h2></div><div class="tw"><table><thead><tr><th>Ref</th><th>Date</th><th>Site</th><th>To</th><th>Type</th><th>Subject</th><th>Status</th><th></th></tr></thead><tbody>${vis.map(l => `<tr><td>${esc(l.ref || "")}</td><td>${fmt(l.issued || l.date)}</td><td>${esc(l.siteName)}</td><td>${esc(l.to)}</td><td>${esc(l.type)}</td><td>${esc(actName(l.act))}</td><td>${l.status === "Issued" ? chip("ok", "Issued") : chip("warn", "Draft by " + l.by)}</td><td class="row"><button class="btn alt sm" data-a="viewletter" data-v="${l.id}">View</button>${l.status !== "Issued" && isEO() ? `<button class="btn gold sm" data-a="issueletter" data-v="${l.id}">Issue</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="8" class="note">No letters yet.</td></tr>`}</tbody></table></div></div>`;
}

function vUsers() {
  const list = users.filter(u => u.role !== "removed").sort((a, b) => a.name.localeCompare(b.name));
  return head("Users", "", `<button class="btn" data-a="userform">Add user</button>`) + `<div class="panel"><div class="tw"><table><thead><tr><th>Name</th><th>User ID</th><th>Role</th><th>Sites</th></tr></thead><tbody>${list.map(u => `<tr><td><b>${esc(u.name)}</b>${u.uid === me.uid ? " (you)" : ""}</td><td>${esc(u.userId || "")}</td><td>${u.uid === me.uid ? chip("ok", ROLE[u.role]) : `<select data-c="role" data-v="${u.uid}" aria-label="Role for ${esc(u.name)}">${Object.keys(ROLE).map(r => opt(r, ROLE[r], u.role)).join("")}</select>`}</td><td>${sites.filter(s => s.pmcUid === u.uid || s.eoUid === u.uid).map(s => esc(s.name)).join(", ")}</td></tr>`).join("")}</tbody></table></div>
  <div class="pad"><p class="note">You create every login here and hand the User ID and starting password to the person. Users can change their own password after signing in. Set a role to No access to block a login. A PMC sees only the sites assigned to them in the site details.</p></div></div>`;
}

/* ---------- shell ---------- */
function render() {
  const app = $("app"), full = $("full");
  if (!me || me.role === "pending") { app.hidden = true; full.hidden = false; full.innerHTML = me ? vPending() : vAuth(); return; }
  app.hidden = false; full.hidden = true; full.innerHTML = "";
  const tabs = [["dash", "Overview"], ["sites", "Projects", sites.length], ["visits", "Site visits"], ["draw", "Drawings"], ["letters", "Letters"]]; if (isAdmin()) tabs.push(["users", "Users"]);
  $("nav").innerHTML = tabs.map(t => `<button ${R.tab === t[0] ? 'aria-current="page"' : ""} data-a="tab" data-v="${t[0]}"><span>${t[1]}</span>${t[2] !== undefined ? `<em>${t[2]}</em>` : ""}</button>`).join("");
  $("who").innerHTML = `<b>${esc(me.name)}</b><span>${ROLE[me.role]}${DEMO ? " &middot; demo mode" : ""}</span><button class="link" data-a="pwform">Change password</button><button class="link" data-a="logout">Sign out</button>`;
  $("main").innerHTML = R.tab === "dash" ? vDash() : R.tab === "sites" ? (R.siteId && site(R.siteId) ? vSite() : vSiteList()) : R.tab === "visits" ? vVisits() : R.tab === "draw" ? vDraw() : R.tab === "letters" ? vLetters() : vUsers();
}

/* ---------- dialogs ---------- */
function siteForm(id) {
  const s = id ? site(id) : { cat: "CC", targetDays: TARGET_DAYS, startDate: today(), eoUid: me.uid };
  const eos = users.filter(u => ["eo", "admin"].includes(u.role)), pmcs = users.filter(u => u.role === "pmc");
  dlg(id ? "Edit site details" : "New NRO", `<input type="hidden" name="id" value="${esc(id || "")}"><div class="form">
    <label>Site name<input name="name" required value="${esc(s.name)}" placeholder="e.g. NRO Hirekerur"></label><label>Village / location<input name="place" required value="${esc(s.place)}"></label>
    <label>District<select name="district">${DISTRICTS.map(d => opt(d, d, s.district)).join("")}</select></label>
    <label>Category<select name="cat" ${id ? "disabled" : ""}>${opt("CC", "CC", s.cat)}${opt("DC", "DC", s.cat)}</select></label>
    <label>Sales group<select name="sg">${opt("", "Not mapped", s.sg)}${SALES_GROUPS.map(g => opt(g, g, s.sg)).join("")}</select></label>
    <label>EO<select name="eoUid">${opt("", "Not mapped", s.eoUid)}${eos.map(u => opt(u.uid, u.name, s.eoUid)).join("")}</select></label>
    <label>SO (Sales Officer)<input name="soName" value="${esc(s.soName)}"></label><label>PMC<select name="pmcUid">${opt("", "Not assigned", s.pmcUid)}${pmcs.map(u => opt(u.uid, u.name, s.pmcUid)).join("")}</select></label>
    <label>Dealer<input name="dealer" value="${esc(s.dealer)}"></label><label>Contractor<input name="contractor" value="${esc(s.contractor)}"></label>
    <label>WBSE<input name="wbse" value="${esc(s.wbse)}"></label><label>Work start date<input name="startDate" type="date" value="${esc(s.startDate)}"></label>
    <label>Target days<input name="targetDays" type="number" min="1" value="${esc(s.targetDays)}"></label>
    <label>Latitude<input name="lat" id="f-lat" inputmode="decimal" value="${esc(s.lat)}"></label><label>Longitude<input name="lng" id="f-lng" inputmode="decimal" value="${esc(s.lng)}"></label>
    ${id ? `<label>Status<select name="status">${opt("active", "Active", s.status)}${opt("commissioned", "Commissioned", s.status)}</select></label>` : ""}</div>
    <div class="row"><button type="button" class="btn alt sm" data-a="herepos">Use my current location</button></div>
    ${id ? "" : `<p class="note">Saving copies the ${ACTS.length}-activity template with the ${"CC or DC"} scope owners and sets every activity to Yet to start.</p>`}`, "site", id ? "Save" : "Create project");
}
function actForm(i) {
  const s = site(R.siteId), x = s.acts[i];
  dlg(`${i}. ${actName(i)}`, `<input type="hidden" name="i" value="${i}"><div class="form">
    <label>Status<select name="s">${opt("Y", "Yet to start", x.s)}${opt("W", "In progress", x.s)}${opt("C", "Completed", x.s)}${opt("N", "Not applicable", x.s)}</select></label>
    <label>Percent done (when in progress)<input name="p" type="number" min="1" max="99" value="${x.s === "W" ? x.p : ""}"></label></div>
    <label>Pending item or remark<input name="note" value="${esc(x.note)}" placeholder="e.g. chamber cover pending"></label>
    <label>Photo<input name="file" type="file" accept="image/*" capture="environment"></label>
    <p class="note">A photo is required to mark an activity Completed. Only entries with a photo count towards the ${UPDATE_DAYS_PER_WEEK}-day rule.</p>`, "act", "Save update");
}
function scopeForm(i) {
  const s = site(R.siteId), x = s.acts[i];
  dlg(`Scope: ${i}. ${actName(i)}`, `<input type="hidden" name="i" value="${i}"><div class="form"><label>Scope owner<select name="own">${Object.keys(OWN).map(k => opt(k, OWN[k], owner(s, i))).join("")}</select></label><label>Applies to this site<select name="na">${opt("0", "Yes", x.s === "N" ? "1" : "0")}${opt("1", "No, not applicable", x.s === "N" ? "1" : "0")}</select></label></div>`, "scope");
}

function parseStatus(t) {
  const raw = t.trim(), u = raw.toUpperCase().replace(/\s+/g, " ");
  if (!u) return null;
  if (/^(COMPLETED|COMPLETE|DONE)$/.test(u)) return { s: "C", p: 100, note: "" };
  if (/^(YTS|YET TO START|NOT STARTED)$/.test(u)) return { s: "Y", p: 0, note: "" };
  if (/^(NA|N\/A|NOT APPLICABLE)$/.test(u)) return { s: "N", p: 0, note: "" };
  const m = u.match(/(\d{1,3})\s*%/), p = m ? Math.min(99, Math.max(1, +m[1])) : 50;
  return { s: "W", p, note: /^(WIP|UNDER ?PROGRESS|IN PROGRESS)( \d{1,3} ?%)?$/.test(u) ? "" : raw.replace(/\s+/g, " ") };
}
function openForm() {
  const s = site(R.siteId);
  dlg("Opening status: " + s.name, `<label>Paste the Status / Remarks column from your Excel sheet (rows 1 to ${ACTS.length}, one per line)<textarea id="o-paste" rows="4" placeholder="COMPLETED&#10;NA&#10;WIP 90%&#10;YTS ..."></textarea></label>
    <div class="row"><button type="button" class="btn alt sm" data-a="parsepaste">Fill the table from pasted text</button><span class="note" id="o-msg">Or set each row by hand below.</span></div>
    <div class="tw" style="max-height:50vh;overflow:auto;border:1px solid var(--line);border-radius:6px"><table><thead><tr><th class="n">No</th><th>Activity</th><th>Scope</th><th>Status</th><th>%</th><th>Pending item</th></tr></thead><tbody>${ACTS.map((a, k) => { const i = k + 1, x = s.acts[i]; return `<tr><td class="n">${i}</td><td>${esc(a[0])}</td><td>${OWN[owner(s, i)]}</td><td><select name="s_${i}" id="o-s-${i}" aria-label="Status ${i}">${opt("Y", "Yet to start", x.s)}${opt("W", "In progress", x.s)}${opt("C", "Completed", x.s)}${opt("N", "Not applicable", x.s)}</select></td><td><input name="p_${i}" id="o-p-${i}" type="number" min="1" max="99" value="${x.s === "W" ? x.p : ""}" aria-label="Percent ${i}"></td><td><input name="n_${i}" id="o-n-${i}" value="${esc(x.note)}" aria-label="Pending item ${i}"></td></tr>`; }).join("")}</tbody></table></div>
    <p class="note">In-progress rows without a percentage are saved as 50%. This is recorded in the update log as one opening entry and does not count as a photo update day.</p>`, "opening", "Save opening status", true);
}

/* ---------- actions ---------- */
async function saveEntry(s, i, next, note, file) {
  const prev = s.acts[i], t = today(), pos = file ? await getPos() : null; let photo = null;
  if (file) { const blob = await compress(file, `${s.name} | ${actName(i)} | ${fmtY(t)} ${hhmm()}${pos ? ` | ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}` : ""}`); photo = await store.upload(`sites/${s.id}/photos/${t}/${Date.now()}_${i}.jpg`, blob); }
  const changed = next && (next.s !== prev.s || next.p !== prev.p), patch = { lastUpdate: new Date().toISOString() };
  if (next) { const a = { ...prev, s: next.s, p: next.p, chg: changed ? t : (prev.chg || t) }; if (note) a.note = note; else delete a.note; patch["acts." + i] = a; }
  if (photo) { patch.updDays = uniq([...(s.updDays || []), t]).slice(-90); patch.lastPhotos = [{ url: photo.url, act: i, date: t }, ...(s.lastPhotos || [])].slice(0, 4); }
  await store.patchSite(s.id, patch);
  const u = { ts: new Date().toISOString(), date: t, uid: me.uid, name: me.name, act: i, note: note || "" };
  if (next) u.to = next.s === "C" ? "Completed" : next.s === "W" ? `In progress ${next.p}%` : next.s === "N" ? "Not applicable" : "Yet to start";
  if (photo) u.photo = photo; if (pos) u.pos = pos;
  await store.subAdd(s.id, "updates", u);
}
const H = {
  demo: v => run(() => store.login(v)),
  resetdemo: () => store.reset(),
  eye: (v, b) => { const i = b.parentNode.querySelector("input"); i.type = i.type === "password" ? "text" : "password"; b.setAttribute("aria-label", i.type === "password" ? "Show password" : "Hide password"); },
  userform: () => dlg("Add user", `<div class="form"><label>Full name<input name="name" required></label><label>User ID<input name="userId" required pattern="[A-Za-z0-9._-]{3,30}" autocapitalize="none" spellcheck="false" placeholder="e.g. pmc.ravi"></label><label>Starting password<input name="pw" required minlength="6" autocomplete="off"></label><label>Role<select name="role">${["pmc", "eo", "tm", "admin"].map(r => opt(r, ROLE[r], "pmc")).join("")}</select></label></div><p class="note">User ID: 3 to 30 letters, digits, dot, dash or underscore. Give the ID and password to the user; they can change the password after signing in.</p>`, "adduser", "Create login"),
  pwform: () => dlg("Change password", `<label>Current password<input name="old" type="password" required autocomplete="current-password"></label><label>New password<input name="pw" type="password" required minlength="6" autocomplete="new-password"></label>`, "changepw", "Change password"),
  logout: () => run(() => store.logout()),
  reload: () => location.reload(),
  tab: v => go({ tab: v, siteId: null, letter: null }),
  open: v => go({ tab: "sites", siteId: v, sub: "acts" }),
  opendraw: v => go({ tab: "sites", siteId: v, sub: "draw" }),
  back: () => go({ siteId: null }),
  sub: v => go({ sub: v }),
  week: v => { R.week = addDays(R.week, +v); render(); },
  closedlg: closeDlg,
  siteform: v => siteForm(v),
  actform: v => actForm(+v),
  scopeform: v => scopeForm(+v),
  openform: () => openForm(),
  parsepaste: () => {
    const lines = $("o-paste").value.replace(/\r/g, "").split("\n"); while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    let n = 0; lines.slice(0, ACTS.length).forEach((t, k) => { const r = parseStatus(t.split("\t").pop()); if (!r) return; n++; $("o-s-" + (k + 1)).value = r.s; $("o-p-" + (k + 1)).value = r.s === "W" ? r.p : ""; $("o-n-" + (k + 1)).value = r.note; });
    $("o-msg").textContent = lines.length === ACTS.length ? `Filled ${n} rows. Check them, then save.` : `Found ${lines.length} lines but the template has ${ACTS.length} activities. Filled the first ${n}; check the rows before saving.`;
  },
  herepos: () => run(async () => { const p = await getPos(); if (!p) throw new Error("Location is not available. Allow location access and try again."); $("f-lat").value = p.lat.toFixed(6); $("f-lng").value = p.lng.toFixed(6); }),
  photoform: () => { const s = site(R.siteId); dlg("Add photo", `<label>Activity<select name="i">${ACTS.map((a, k) => opt(k + 1, `${k + 1}. ${a[0]}`, firstOpen(s))).join("")}</select></label><label>Photo<input name="file" type="file" accept="image/*" capture="environment" required></label><label>Note<input name="note"></label>`, "photo", "Upload"); },
  measform: () => dlg("Add measurement", `<label>BOQ item<input name="item" required></label><div class="form"><label>Unit<select name="unit">${["m3", "m2", "m", "nos", "kg"].map(u => opt(u, u, "m3")).join("")}</select></label><label>Nos<input name="n" type="number" step="any" value="1" required></label><label>L<input name="l" type="number" step="any" value="1" required></label><label>B<input name="b" type="number" step="any" value="1" required></label><label>D<input name="d" type="number" step="any" value="1" required></label><label>BOQ qty<input name="boq" type="number" step="any"></label></div><p class="note">Leave a dimension as 1 when it does not apply.</p>`, "meas", "Add"),
  delmeas: v => run(async () => { await store.subDel(R.siteId, "meas", v); await refresh(); }),
  momform: () => dlg("Add MoM point", `<label>Point agreed<input name="t" required></label><div class="form"><label>Owner<select name="o">${["Dealer", "Contractor", "PMC", "BPCL"].map(o => opt(o, o)).join("")}</select></label><label>Target date<input name="d" type="date" value="${addDays(today(), 7)}"></label></div>`, "mom", "Add"),
  closemom: v => run(async () => { await store.subPatch(R.siteId, "mom", v, { open: false, closedBy: me.name, closedOn: today() }); await refresh(); }),
  drawform: v => dlg("Upload " + DRAW_SLOTS.find(d => d[0] === v)[1], `<input type="hidden" name="slot" value="${v}"><label>PDF file<input name="file" type="file" accept="application/pdf" required></label><p class="note">If a drawing already exists, this becomes the next revision and the old one is kept.</p>`, "draw", "Upload"),
  stdform: () => dlg("Add standard drawing", `<label>Title<input name="title" required placeholder="e.g. Canopy foundation detail"></label><label>PDF file<input name="file" type="file" accept="application/pdf" required></label>`, "std", "Upload"),
  review: v => run(async () => { await store.subPatch(R.siteId, "updates", v, { chk: { by: me.name, on: today() } }); await refresh(); }),
  checkin: () => run(async () => {
    const s = site(R.siteId), pos = await getPos(), t = today(), v = { ts: new Date().toISOString(), date: t, uid: me.uid, name: me.name, inAt: hhmm() };
    if (pos) { v.lat = pos.lat; v.lng = pos.lng; if (s.lat != null && s.lng != null) { v.dist = distM(pos, { lat: +s.lat, lng: +s.lng }); v.atSite = v.dist <= SITE_RADIUS_M; } }
    await store.subAdd(s.id, "visits", v); await store.patchSite(s.id, { visitDays: uniq([...(s.visitDays || []), t]).slice(-120) }); await refresh();
    toast(v.atSite === false ? `Checked in, but you are ${v.dist} m from the site` : pos ? "Checked in" : "Checked in without location");
  }),
  checkout: v => dlg("Check out", `<input type="hidden" name="id" value="${v}"><label>Persons present<input name="present" placeholder="Dealer, contractor supervisor"></label><label>Remarks<textarea name="remarks" rows="3"></textarea></label>`, "checkout", "Check out"),
  plan: v => run(async () => { const [id, d] = v.split("|"), s = site(id); await store.patchSite(id, { ["plan." + d]: s.plan && s.plan[d] ? DEL : "planned" }); await refresh(); }),
  saveletter: v => run(async () => {
    const s = site(L.siteId), lb = letterBody(), i = L.act || firstOpen(s);
    if (L.type === "Deviation" && !L.obs.trim()) throw new Error("Enter the observation for a deviation letter");
    const l = { ts: new Date().toISOString(), date: today(), siteId: s.id, siteName: s.name, act: i, type: L.type, to: lb.to, body: lb.text, by: me.name, status: "Draft" };
    const id = await store.topAdd("letters", l); letters = await store.topList("letters");
    if (v === "Issued") await issue(id); L.obs = ""; toast(v === "Issued" ? "Letter issued" : "Draft saved");
  }),
  issueletter: v => run(async () => { await issue(v); toast("Letter issued"); }),
  viewletter: v => { R.letter = v; render(); },
  letterback: () => { R.letter = null; render(); },
  print: () => window.print()
};
async function issue(id) {
  const d = new Date(), fy = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1, n = letters.filter(l => l.status === "Issued").length + 1;
  await store.topPatch("letters", id, { status: "Issued", issued: today(), signName: me.name, signRole: me.role === "admin" || me.role === "eo" ? "Engineering Officer" : "", ref: `${LETTER_PREFIX}/${String(fy).slice(2)}-${String(fy + 1).slice(2)}/${String(n).padStart(3, "0")}` });
  letters = await store.topList("letters");
}
const C = {
  feo: v => { R.fEO = v; render(); },
  role: (v, el) => run(async () => { await store.setUser(el.dataset.v, { role: v }); users = await store.listUsers(); toast("Role updated"); }),
  ltsite: v => { L.siteId = v; L.act = firstOpen(site(v)); render(); },
  lttype: v => { L.type = v; render(); },
  ltact: v => { L.act = +v; render(); },
  ltobs: v => { L.obs = v; render(); }
};
const F = {
  login: f => run(() => store.login(f.uid, f.pw)),
  adduser: f => run(async () => {
    const userId = f.userId.trim().toLowerCase(), old = users.find(u => u.userId === userId && u.role !== "removed");
    const uid = await store.createUser(f.name.trim(), userId, f.pw, f.role);
    if (old) { // same User ID re-issued after the old login was deleted: carry site assignments over
      for (const s of sites) { const p = {}; if (s.pmcUid === old.uid) { p.pmcUid = uid; p.pmcName = f.name.trim(); } if (s.eoUid === old.uid) { p.eoUid = uid; p.eoName = f.name.trim(); } if (Object.keys(p).length) await store.patchSite(s.id, p); }
      await store.setUser(old.uid, { role: "removed" });
    }
    closeDlg(); users = await store.listUsers(); await refresh(); toast(old ? "Login re-issued; site assignments carried over" : "Login created");
  }),
  changepw: f => run(async () => { await store.changePw(f.old, f.pw); closeDlg(); toast("Password changed"); }),
  site: f => run(async () => {
    const eo = users.find(u => u.uid === f.eoUid), pmc = users.find(u => u.uid === f.pmcUid), num = v => v === "" || isNaN(+v) ? null : +v;
    const d = { name: f.name.trim(), place: f.place.trim(), district: f.district, sg: f.sg, eoUid: f.eoUid, eoName: eo ? eo.name : "", soName: f.soName.trim(), pmcUid: f.pmcUid, pmcName: pmc ? pmc.name : "", dealer: f.dealer.trim(), contractor: f.contractor.trim(), wbse: f.wbse.trim(), startDate: f.startDate, targetDays: +f.targetDays || TARGET_DAYS, lat: num(f.lat), lng: num(f.lng) };
    if (f.id) { d.status = f.status; await store.patchSite(f.id, d); }
    else { const id = await store.createSite({ ...d, cat: f.cat, status: "active", acts: blankActs(), plan: {}, updDays: [], visitDays: [], lastPhotos: [], draw: {}, createdAt: new Date().toISOString(), createdBy: me.name }); R.tab = "sites"; R.siteId = id; R.sub = "acts"; }
    closeDlg(); await refresh();
  }),
  act: (f, files) => run(async () => {
    const s = site(R.siteId), i = +f.i, prev = s.acts[i], file = files.file;
    const p = f.s === "C" ? 100 : f.s === "W" ? Math.round(+f.p) : 0;
    if (f.s === "W" && !(p >= 1 && p <= 99)) throw new Error("Enter percent done between 1 and 99");
    if (f.s === "C" && prev.s !== "C" && !file) throw new Error("Add a photo to mark this activity Completed");
    await saveEntry(s, i, { s: f.s, p }, f.note.trim(), file); closeDlg(); await refresh(); toast("Update saved");
  }),
  opening: f => run(async () => {
    const s = site(R.siteId), t = today(), acts = {}; let c = 0;
    ACTS.forEach((a, k) => { const i = k + 1, prev = s.acts[i], st = f["s_" + i], p = st === "C" ? 100 : st === "W" ? Math.min(99, Math.max(1, Math.round(+f["p_" + i]) || 50)) : 0, x = { s: st, p, chg: st !== prev.s || p !== prev.p ? t : (prev.chg || t) }; if (prev.own) x.own = prev.own; const note = (f["n_" + i] || "").trim(); if (note) x.note = note; if (st === "C") c++; acts[i] = x; });
    await store.patchSite(s.id, { acts, lastUpdate: new Date().toISOString() });
    await store.subAdd(s.id, "updates", { ts: new Date().toISOString(), date: t, uid: me.uid, name: me.name, act: 0, to: `Opening status entered: ${c} of ${ACTS.length} completed`, note: "" });
    closeDlg(); await refresh(); toast("Opening status saved");
  }),
  scope: f => run(async () => { const s = site(R.siteId), i = +f.i, x = { ...s.acts[i] }, def = ACTS[i - 1][s.cat === "CC" ? 2 : 3]; if (f.own === def) delete x.own; else x.own = f.own; if (f.na === "1") { x.s = "N"; x.p = 0; } else if (x.s === "N") { x.s = "Y"; x.p = 0; } await store.patchSite(s.id, { ["acts." + i]: x }); closeDlg(); await refresh(); }),
  photo: (f, files) => run(async () => { await saveEntry(site(R.siteId), +f.i, null, f.note.trim(), files.file); closeDlg(); await refresh(); toast("Photo uploaded"); }),
  meas: f => run(async () => { await store.subAdd(R.siteId, "meas", { ts: new Date().toISOString(), date: today(), by: me.name, item: f.item.trim(), unit: f.unit, n: +f.n, l: +f.l, b: +f.b, d: +f.d, boq: +f.boq || 0 }); closeDlg(); await refresh(); }),
  mom: f => run(async () => { await store.subAdd(R.siteId, "mom", { ts: new Date().toISOString(), date: today(), by: me.name, t: f.t.trim(), o: f.o, d: f.d, open: true }); closeDlg(); await refresh(); }),
  draw: (f, files) => run(async () => {
    const s = site(R.siteId), old = s.draw && s.draw[f.slot], rev = old ? old.rev + 1 : 0;
    const up = await store.upload(`sites/${s.id}/drawings/${f.slot}_R${rev}.pdf`, files.file);
    const hist = old ? [...(old.hist || []), { rev: old.rev, date: old.date, url: old.url }] : [];
    await store.patchSite(s.id, { ["draw." + f.slot]: { rev, date: today(), by: me.name, url: up.url, path: up.path, hist } }); closeDlg(); await refresh(); toast("Drawing uploaded as R" + rev);
  }),
  std: (f, files) => run(async () => { const up = await store.upload(`standard-drawings/${Date.now()}_${files.file.name.replace(/[^\w.-]/g, "_")}`, files.file); await store.topAdd("std", { ts: new Date().toISOString(), date: today(), by: me.name, title: f.title.trim(), url: up.url, path: up.path }); closeDlg(); await refresh(); }),
  checkout: f => run(async () => { await store.subPatch(R.siteId, "visits", f.id, { outAt: hhmm(), present: f.present.trim(), remarks: f.remarks.trim() }); closeDlg(); await refresh(); })
};

/* ---------- events ---------- */
document.addEventListener("click", e => {
  const b = e.target.closest("[data-a]"); if (!b) return;
  if (b.tagName !== "BUTTON" && e.target.closest("a,button,input,select,textarea,label")) return;
  const fn = H[b.dataset.a]; if (fn) fn(b.dataset.v, b);
});
document.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.matches("tr[data-a],li[data-a]")) H[e.target.dataset.a](e.target.dataset.v); if (e.key === "Escape") closeDlg(); });
document.addEventListener("change", e => { const c = e.target.dataset.c; if (c && C[c]) C[c](e.target.value, e.target); });
document.addEventListener("submit", e => {
  const form = e.target.closest("form[data-f]"); if (!form) return; e.preventDefault();
  const f = {}, files = {}; new FormData(form).forEach((v, k) => { if (v instanceof File) { if (v.size) files[k] = v; } else f[k] = v; });
  form.querySelectorAll("select[disabled]").forEach(s => f[s.name] = s.value);
  F[form.dataset.f](f, files);
});

/* ---------- start ---------- */
(async () => {
  try { store = await initStore(); } catch (e) { $("full").hidden = false; $("full").innerHTML = `<div class="auth"><div class="dlg"><div class="pad"><h2>Could not connect</h2><p>${esc(e.message)}</p><p class="note">Check firebase-config.js and your network, then reload.</p></div></div></div>`; return; }
  store.onAuth(async p => { me = p; users = []; if (me && me.role !== "pending") { R.tab = "dash"; R.siteId = null; await run(refresh); } else render(); });
})();
