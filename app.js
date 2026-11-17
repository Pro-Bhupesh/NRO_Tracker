import { PHASES, OWN, ACTS, SALES_GROUPS, DISTRICTS, DRAW_SLOTS, TERRITORY, LETTER_PREFIX, TARGET_DAYS, STALL_DAYS, UPDATE_DAYS_PER_WEEK, SITE_RADIUS_M, APP_VERSION, UPDATE_DAY_NEEDS_PHOTO, GANTT, GANTT_DAYS } from "./data.js?v=2.5";
import { DRAW_LIB, DRAW_BASE, ACT_LIB } from "./drawings.js?v=2.5";
import { initStore, DEMO, DEL, blankActs } from "./store.js?v=2.5";

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
const R = { tab: "dash", siteId: null, sub: "acts", week: weekStart(today()), fEO: "", letter: null, q: "", fs: "", fc: "", sort: "name", af: "", dp: [], dq: "" };
const L = { siteId: "", act: 0, type: "Delay", obs: "" };

const isAdmin = () => me.role === "admin";
const isEO = () => me.role === "eo" || me.role === "admin";
const canMake = s => me.role === "admin" || me.role === "pmc"; // makers: any PMC, on any project
const canEdit = () => ["admin", "eo", "pmc"].includes(me.role); // may create and edit projects, scope and timelines
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
const stdSched = start => Object.fromEntries(GANTT.map((g, k) => [k + 1, { ps: addDays(start, g[2] - 1), pe: addDays(start, g[2] + g[1] - 2), p: 0 }]));
const gOver = (s, n) => { const x = (s.sched || {})[n]; return x && x.pe && (x.p || 0) < 100 && x.pe < today() ? diff(today(), x.pe) : 0; };
const stalledList = s => ACTS.map((a, k) => k + 1).filter(i => stalledDays(s, i));
const updInWeek = (s, ws) => uniq((s.updDays || []).filter(d => d >= ws && d <= addDays(ws, 6)));
const drawCount = s => DRAW_SLOTS.filter(d => s.draw && s.draw[d[0]]).length;
function planState(s, d) { if ((s.visitDays || []).includes(d)) return "done"; if (s.plan && s.plan[d]) return d < today() ? "missed" : "planned"; return ""; }

/* ---------- small UI pieces ---------- */
const ICONS = {
  dash: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  sites: '<path d="M3 21h18M5 21V8l7-4 7 4v13M9.5 21v-5h5v5M9 10h.01M15 10h.01M9 13.5h.01M15 13.5h.01"/>',
  visits: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  draw: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
  letters: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  more: '<path d="M4 6h16M4 12h16M4 18h16"/>', plus: '<path d="M12 5v14M5 12h14"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  back: '<path d="m15 18-6-6 6-6"/>', right: '<path d="m9 18 6-6-6-6"/>', down: '<path d="m6 9 6 6 6-6"/>', panel: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
  trend: '<path d="M22 7 13.5 15.5l-5-5L2 17"/><path d="M16 7h6v6"/>', alert: '<path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3z"/><path d="M12 9v4M12 17h.01"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>', camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3z"/><circle cx="12" cy="13" r="3"/>',
  pause: '<circle cx="12" cy="12" r="10"/><path d="M10 15V9M14 15V9"/>', key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>', download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  check: '<path d="M20 6 9 17l-5-5"/>', edit: '<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>', upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>', inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>', folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/>', trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14M10 11v6M14 11v6"/>', sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M2 14h4M10 8h4M18 16h4"/>', clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>'
};
const ic = n => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]}</svg>`;
const chip = (c, t) => `<span class="chip ${c ? "c-" + c : ""}">${esc(t)}</span>`;
const stChip = x => x.s === "C" ? chip("ok", "Completed") : x.s === "W" ? chip("info", "In progress") : x.s === "N" ? chip("", "Not applicable") : chip("", "Not started");
const pm = p => `<div class="pm"><div class="meter" role="img" aria-label="${p} percent"><i style="width:${p}%"></i></div><span>${p}%</span></div>`;
const photoCard = (p, s) => `<a class="ph" href="${esc(p.url)}" target="_blank" rel="noopener"><div class="img"><img src="${esc(p.url)}" alt="" loading="lazy"></div><b>${esc(actName(p.act))}</b><span>${s ? esc(s.name) + " &middot; " : ""}${fmt(p.date)}</span></a>`;
function dots(s, ws) { const u = updInWeek(s, ws); return `<div class="dots" aria-label="${u.length} of ${UPDATE_DAYS_PER_WEEK} update days">${[0, 1, 2, 3, 4, 5, 6].map(k => `<i class="${u.includes(addDays(ws, k)) ? "on" : ""}">${"MTWTFSS"[k]}</i>`).join("")}</div>`; }
let topAct = "", topFab = "";
const head = (crumb, right, fab) => { topAct = right || ""; topFab = fab || ""; return crumb ? `<div class="head">${crumb}</div>` : ""; };
const empty = (icon, title, text, action) => `<div class="empty">${ic(icon)}<b>${esc(title)}</b><p>${esc(text)}</p>${action || ""}</div>`;
const initials = n => (String(n || "").replace(/[^\p{L}\p{N}\s]/gu, "").trim().split(/\s+/).slice(0, 2).map(w => w[0] || "").join("") || "?").toUpperCase();
const opt = (v, t, sel) => `<option value="${esc(v)}"${String(v) === String(sel ?? "") ? " selected" : ""}>${esc(t)}</option>`;
const fchips = (act, cur, items) => `<div class="fchips" role="group">${items.map(([v, t, n]) => `<button class="fchip" aria-pressed="${cur === v}" data-a="${act}" data-v="${v}">${esc(t)}${n !== undefined ? `<i>${n}</i>` : ""}</button>`).join("")}</div>`;
function ring(p, size = 76) { const r = 32, c = 2 * Math.PI * r; return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 76 76" role="img" aria-label="${p} percent complete"><circle cx="38" cy="38" r="${r}" fill="none" stroke="var(--soft)" stroke-width="8"/><circle cx="38" cy="38" r="${r}" fill="none" stroke="var(--blue)" stroke-width="8" stroke-linecap="round" stroke-dasharray="${(c * p / 100).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 38 38)"/><text x="38" y="43" text-anchor="middle" font-size="17" font-weight="700" fill="var(--ink)">${p}%</text></svg>`; }
function toast(msg, bad) { const t = $("toast"); t.textContent = msg; t.className = "toast show" + (bad ? " bad" : ""); clearTimeout(toast.t); toast.t = setTimeout(() => t.className = "toast", 4000); }
function busy(on) { $("busy").hidden = !on; }
/* Dialogs open as a centred modal on desktop and as a bottom sheet on phones. The phone's Back button closes them. */
let ignorePop = false;
const ovlOpen = () => !!$("ovl").firstChild;
function openOvl(html) { $("ovl").innerHTML = html; try { if (!(history.state && history.state.ovl)) history.pushState({ ovl: 1 }, ""); } catch (e) { } }
function dlg(title, body, form, okText = "Save", wide = false) {
  openOvl(`<div class="ovl" data-a="closedlg"><form class="dlg${wide ? " wide" : ""}" data-f="${form}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="dlg-h"><h2>${esc(title)}</h2><button type="button" class="ibtn" data-a="closedlg" aria-label="Close">${ic("x")}</button></div><div class="dlg-b">${body}</div><div class="dlg-f"><button type="button" class="btn ghost" data-a="closedlg">Cancel</button><button class="btn" type="submit">${esc(okText)}</button></div></form></div>`);
  if (matchMedia("(min-width:800px)").matches) { const f = $("ovl").querySelector("input:not([type=hidden]),select,textarea"); if (f) f.focus(); }
}
function sheet(title, items) { openOvl(`<div class="ovl menu-ovl" data-a="closedlg"><div class="dlg menu" role="dialog" aria-modal="true" aria-label="${esc(title)}">${title ? `<div class="menu-h">${title}</div>` : ""}${items.map(m => `<button class="mi ${m[3] || ""}" data-a="${m[0]}"${m[4] ? ` data-v="${m[4]}"` : ""}>${ic(m[1])}<span>${esc(m[2])}</span></button>`).join("")}</div></div>`); }
let confirmFn = null;
function confirmDlg(title, text, okText, fn) { confirmFn = fn; dlg(title, `<p>${esc(text)}</p>`, "confirm", okText); }
function closeDlg() { if (!ovlOpen()) return; $("ovl").innerHTML = ""; try { if (history.state && history.state.ovl) { ignorePop = true; history.back(); } } catch (e) { } }
function labelTables() { document.querySelectorAll("#main table.rt").forEach(t => { const hs = [...t.querySelectorAll("thead th")].map(th => th.textContent.trim()); t.querySelectorAll("tbody tr").forEach(tr => [...tr.children].forEach((td, i) => { if (i && hs[i] && !td.hasAttribute("colspan")) td.dataset.l = hs[i]; })); }); }

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
  if (canEdit() && (R.tab === "users" || !users.length)) users = await store.listUsers();
  if (R.tab === "letters") { letters = await store.topList("letters"); if (!site(L.siteId) && sites[0]) { L.siteId = sites[0].id; L.act = firstOpen(sites[0]); } }
  if (R.tab === "draw") std = await store.topList("std");
  if (R.tab === "visits") { visitsAll = []; for (const s of sites) (await store.subList(s.id, "visits", 10)).forEach(v => visitsAll.push({ ...v, site: s.name })); visitsAll.sort((a, b) => b.ts.localeCompare(a.ts)); }
  if (R.tab === "sites" && R.siteId && site(R.siteId)) {
    const name = { acts: null, photos: "updates", log: "updates", visits: "visits", meas: "meas", mom: "mom", draw: null }[R.sub];
    if (name) (sub[R.siteId] = sub[R.siteId] || {})[name] = await store.subList(R.siteId, name);
  } else if (R.tab === "sites") R.siteId = null;
}
async function go(patch, mode = "push") {
  Object.assign(R, patch);
  try { if (mode === "push") history.pushState({ r: snap() }, ""); else if (mode === "replace") history.replaceState({ r: snap() }, ""); } catch (e) { }
  if (patch.tab !== undefined || patch.siteId !== undefined) { window.scrollTo(0, 0); if (!DEMO && $("main")) $("main").innerHTML = skeleton(); }
  await run(refresh);
}
async function run(fn) { busy(true); try { await fn(); } catch (e) { console.error(e); toast(ERR[e.code] || e.message || String(e), true); } finally { busy(false); render(); } }
const firstOpen = s => ACTS.map((a, k) => k + 1).find(i => "WY".includes(s.acts[i].s)) || 1;

/* ---------- views ---------- */
const PIN = '<svg class="pin" viewBox="0 0 48 60" aria-hidden="true"><path d="M24 2C12 2 4 11 4 22c0 14 20 34 20 34s20-20 20-34C44 11 36 2 24 2z" fill="#f5b400"/><circle cx="24" cy="22" r="14" fill="#fff"/><path d="M17 14h9v16h-9zm11 4 3 3v7a1.5 1.5 0 0 1-3 0zM19 16h5v5h-5z" fill="#0a3a8c" fill-rule="evenodd"/></svg>';
const CRANE = '<svg class="crane" viewBox="0 0 220 110" aria-hidden="true"><g fill="none" stroke="#0a3a8c" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M84 96V18m10 78V18M84 18h10M84 34l10-16M84 50l10-16M84 66l10-16M84 82l10-16M60 18h110M89 6l-29 12m29-12 81 12M150 18v22m-6 0h12M70 18v8"/><path d="M20 96V66h34v30M20 76h34M20 86h34M31 66v30M43 66v30" opacity=".75"/><path d="M110 96V60h30v36M110 72h30M110 84h30M125 60v36" opacity=".75"/></g><path d="M8 100c50-10 110 8 204-8" fill="none" stroke="#f5b400" stroke-width="4" stroke-linecap="round"/></svg>';
function vAuth() {
  const fld = (name, type, ph, ic, extra = "") => `<label class="fld"><svg viewBox="0 0 24 24" aria-hidden="true">${ic}</svg><input name="${name}" type="${type}" placeholder="${ph}" aria-label="${ph}" required ${extra}>${type === "password" ? `<button type="button" class="eye" data-a="eye" aria-label="Show password"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5C6 5 2 12 2 12s4 7 10 7 10-7 10-7-4-7-10-7zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm0-2a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/></svg></button>` : ""}</label>`;
  const U = '<path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zm-8 9c0-4 3.6-7 8-7s8 3 8 7z"/>', K = '<path d="M7 10V8a5 5 0 0 1 10 0v2h2v11H5V10zm2 0h6V8a3 3 0 0 0-6 0zm3 4a1.6 1.6 0 0 0-1 2.9V19h2v-2.1A1.6 1.6 0 0 0 12 14z" fill-rule="evenodd"/>';
  return `<div class="auth split"><div class="hero-l">
    <div class="hbrand"><div class="hname"><b>NRO</b> Tracker</div>${PIN}</div>
    <div class="tbe"><span>Track</span><span class="g">Build</span><span>Energise</span></div>
    </div>
    <form class="dlg card" data-f="login"><div class="pad">${CRANE}
    <div class="hname sm"><b>NRO</b> Tracker</div>
    <p class="note center">${TERRITORY}</p>
    ${DEMO ? `<p class="note center">Demo mode: Firebase is not configured yet. There are no sites; anything you add is kept only in this browser. Enter as:</p>
      <div class="row center">${[["admin", "Admin"], ["eo2", "EO"], ["pmc1", "PMC"], ["tm", "TM"]].map(u => `<button type="button" class="btn ghost" data-a="demo" data-v="${u[0]}">${u[1]}</button>`).join("")}</div>
      <p class="note center"><button type="button" class="link" data-a="resetdemo">Reset demo data</button></p>`
      : `${fld("uid", "text", "User ID", U, 'autocomplete="username" autocapitalize="none" spellcheck="false"')}${fld("pw", "password", "Password", K, 'autocomplete="current-password"')}
      <button class="btn wide" type="submit">Sign In</button>
      <p class="note center">Logins are issued by the admin. If you have forgotten your password, ask the admin for a new login.</p>`}
    <p class="note center ver">Version ${APP_VERSION}</p>
  </div></form></div>`;
}
function vPending() { return `<div class="auth"><div class="dlg"><div class="pad"><div class="brand dark"><b>NRO <i>Tracker</i></b><span>${TERRITORY}</span></div><h2>No access</h2><p>${esc(me.name)}, this login has no role at present. Ask the admin to give you access.</p><div class="row"><button class="btn" data-a="reload">Check again</button><button class="btn ghost" data-a="logout">Sign out</button></div></div></div></div>`; }

function attention() {
  let ex = [];const ws = weekStart(today());
  sites.filter(s => s.status !== "commissioned").forEach(s => {
    stalledList(s).forEach(i => ex.push(["bad", s, `${actName(i)}: no progress for ${stalledDays(s, i)} days (${OWN[owner(s, i)]})`]));
    GANTT.forEach((g, k) => { const od = gOver(s, k + 1); if (od) ex.push(["bad", s, `${g[0]}: ${od} days past planned finish`]); });
    Object.keys(s.plan || {}).filter(d => d >= addDays(today(), -14) && planState(s, d) === "missed").forEach(d => ex.push(["bad", s, `Planned visit on ${fmt(d)} was missed`]));
    const u = updInWeek(s, ws).length; if (u < UPDATE_DAYS_PER_WEEK) ex.push(["warn", s, `${u} of ${UPDATE_DAYS_PER_WEEK} update days this week`]);
    DRAW_SLOTS.forEach(d => { if (!(s.draw && s.draw[d[0]])) ex.push(["warn", s, `${d[1]} not uploaded`]); });
    if (!s.sg || !s.soName) ex.push(["warn", s, "Sales group or SO not mapped"]);
  });
  ex.sort((a, b) => (a[0] === "bad" ? 0 : 1) - (b[0] === "bad" ? 0 : 1));
  return ex;
}
/* ---------- project cards, search, filters ---------- */
const SORTS = { name: ["Name", (a, b) => a.name.localeCompare(b.name)], prog: ["Least progress", (a, b) => overall(a) - overall(b)], day: ["Most days elapsed", (a, b) => dayNo(b) - dayNo(a)], risk: ["Most behind", (a, b) => gapOf(a) - gapOf(b)] };
const gapOf = s => s.startDate ? overall(s) - Math.min(100, Math.round(dayNo(s) / (s.targetDays || TARGET_DAYS) * 100)) : 0;
const stKey = s => s.status === "commissioned" ? "done" : (health(s)[0] || "none");
function baseList() { return R.tab === "dash" ? sites.filter(s => s.status !== "commissioned") : sites; }
function filtered() {
  const q = R.q.trim().toLowerCase();
  return baseList().filter(s => (!q || [s.name, s.place, s.district, s.eoName, s.soName, s.contractor, s.dealer, s.wbse].some(v => String(v || "").toLowerCase().includes(q))) && (!R.fs || stKey(s) === R.fs) && (!R.fc || s.cat === R.fc) && (!R.fEO || s.eoName === R.fEO)).sort(SORTS[R.sort][1]);
}
function projectCard(s) {
  const h = health(s), o = overall(s), ws = weekStart(today()), done = s.status === "commissioned";
  return `<article class="pc st-${done ? "ok" : h[0] || "none"}" data-a="open" data-v="${s.id}" tabindex="0" role="link" aria-label="${esc(s.name)}, ${o} percent">
    <div class="pc-top"><div class="pc-t"><h3>${esc(s.name)}</h3><span>${esc(s.place)}${s.district ? ", " + esc(s.district) : ""}</span></div><div class="pc-pct">${o}<i>%</i></div></div>
    <div class="meter lg"><i style="width:${o}%"></i></div>
    <div class="pc-tags"><span class="tag">${s.cat}</span>${done ? chip("ok", "Commissioned") : chip(h[0], h[1])}<span class="pc-day">${ic("clock")}Day ${dayNo(s)} of ${s.targetDays || TARGET_DAYS}</span></div>
    <div class="phases" role="img" aria-label="Phase progress">${PHASES.map((p, pi) => `<i title="${p[0]}: ${phasePct(s, pi) || 0}%"><b style="width:${phasePct(s, pi) || 0}%"></b></i>`).join("")}</div>
    <div class="pc-stats"><div><span>Contractor scope</span><b>${byOwner(s, "C")}%</b></div><div><span>Dealer scope</span><b>${byOwner(s, "D")}%</b></div><div><span>EO</span><b>${esc(s.eoName || "Not mapped")}</b></div><div><span>SO</span><b>${esc(s.soName || "Not mapped")}</b></div></div>
    <div class="pc-foot"><span>Updates this week</span>${dots(s, ws)}</div></article>`;
}
function plistHtml() {
  const list = filtered();
  if (!baseList().length) return empty("sites", "No projects yet", canEdit() ? "Add the first NRO to start tracking its progress." : "Projects will appear here once they are added.", canEdit() ? `<button class="btn" data-a="siteform">${ic("plus")}New NRO</button>` : "");
  return list.length ? `<div class="pgrid">${list.map(projectCard).join("")}</div>` : empty("search", "No matching projects", "Try a different search or clear the filters.", `<button class="btn ghost" data-a="clearf">Clear filters</button>`);
}
function projectTools() {
  const b = baseList(), cnt = k => b.filter(s => stKey(s) === k).length, eos = uniq(b.map(s => s.eoName).filter(Boolean));
  const st = [["", "All", b.length], ["ok", "On track", cnt("ok")], ["warn", "At risk", cnt("warn")], ["bad", "Delayed", cnt("bad")]]; if (R.tab === "sites") st.push(["done", "Commissioned", cnt("done")]);
  return `<div class="tools"><label class="search">${ic("search")}<input type="search" data-i="q" value="${esc(R.q)}" placeholder="Search site, place, EO, SO, contractor" aria-label="Search projects"></label>
    <div class="tools-r"><select data-c="fcat" aria-label="Category">${opt("", "CC and DC", R.fc)}${opt("CC", "CC only", R.fc)}${opt("DC", "DC only", R.fc)}</select>${eos.length > 1 ? `<select data-c="feo" aria-label="EO"><option value="">All EOs</option>${eos.map(e => opt(e, e, R.fEO)).join("")}</select>` : ""}<select data-c="sort" aria-label="Sort by">${Object.keys(SORTS).map(k => opt(k, "Sort: " + SORTS[k][0], R.sort)).join("")}</select></div></div>${fchips("fstat", R.fs, st)}`;
}
const newBtn = () => canEdit() ? `<button class="btn d-only" data-a="siteform">${ic("plus")}New NRO</button>` : "";
const newFab = () => canEdit() ? `<button class="fab" data-a="siteform" aria-label="New NRO">${ic("plus")}<span>New NRO</span></button>` : "";

function vDash() {
  const act = sites.filter(s => s.status !== "commissioned"), n = act.length, ws = weekStart(today());
  const avg = n ? Math.round(act.reduce((a, s) => a + overall(s), 0) / n) : 0;
  let done = 0, planned = 0; act.forEach(s => { for (let k = 0; k < 7; k++) { const st = planState(s, addDays(ws, k)); if (st) planned++; if (st === "done") done++; } });
  const risk = act.filter(s => ["bad", "warn"].includes(health(s)[0])).length, comp = act.filter(s => updInWeek(s, ws).length >= UPDATE_DAYS_PER_WEEK).length, stalled = act.reduce((a, s) => a + stalledList(s).length, 0);
  const ex = attention(), latest = [];
  act.forEach(s => (s.lastPhotos || []).slice(0, 2).forEach(p => latest.push([p, s]))); latest.sort((a, b) => b[0].date.localeCompare(a[0].date));
  const kp = [["sites", "Active NROs", n, `${act.filter(s => s.cat === "CC").length} CC · ${act.filter(s => s.cat === "DC").length} DC`, ""], ["trend", "Average progress", avg + "%", "Weighted by phase", ""], ["alert", "At risk or delayed", risk, risk ? "Behind the target pace" : "All on target pace", risk ? "warn" : "ok"], ["pin", "Visits this week", `${done}/${planned}`, "Done / planned", planned && done < planned ? "" : ""], ["camera", `${UPDATE_DAYS_PER_WEEK}-day update rule`, `${comp}/${n}`, "Sites compliant this week", n && comp < n ? "warn" : "ok"], ["pause", "Stalled activities", stalled, `No change for ${STALL_DAYS}+ days`, stalled ? "bad" : "ok"]];
  return head("", newBtn(), newFab()) + `
  <section class="kpis">${kp.map(k => `<div class="kpi k-${k[4]}"><div class="kpi-i">${ic(k[0])}</div><div><span>${k[1]}</span><b>${k[2]}</b><small>${k[3]}</small></div></div>`).join("")}</section>
  <div class="dash"><section class="col"><div class="sec-h"><h2>Projects</h2><span class="note">${n} active</span></div>${projectTools()}<div id="plist">${plistHtml()}</div></section>
  <aside class="col"><section class="panel"><div class="ptitle"><h2>Needs attention</h2><span class="count ${ex.length ? "bad" : ""}">${ex.length}</span></div><ul class="att">${ex.slice(0, 8).map(e => `<li class="${e[0]}" data-a="open" data-v="${e[1].id}" tabindex="0"><i></i><div><b>${esc(e[1].name)}</b><span>${esc(e[2])}</span></div>${ic("right")}</li>`).join("") || `<li class="none">${empty("check", "All clear", "No stalled work, missed visits or missing drawings.")}</li>`}${ex.length > 8 ? `<li class="none more">and ${ex.length - 8} more across your projects</li>` : ""}</ul></section>
  <section class="panel"><div class="ptitle"><h2>Latest photographs</h2></div><div class="pad">${latest.length ? `<div class="photos">${latest.slice(0, 6).map(x => photoCard(x[0], x[1])).join("")}</div>` : empty("image", "No photos yet", "Photos from PMC updates appear here.")}</div></section></aside></div>`;
}

function vSiteList() { return head("", newBtn(), newFab()) + `${projectTools()}<div id="plist">${plistHtml()}</div>`; }

function vSite() {
  const s = site(R.siteId), mk = canMake(s), h = health(s), d = sub[s.id] || {}, o = overall(s), done = s.status === "commissioned";
  const tabs = [["acts", "Activities"], ["gantt", "Bar chart"], ["photos", "Photos"], ["visits", "Visits"], ["meas", "Measurements"], ["mom", "MoM"], ["draw", `Drawings ${drawCount(s)}/${DRAW_SLOTS.length}`], ["log", "Update log"]];
  const target = s.startDate ? addDays(s.startDate, (s.targetDays || TARGET_DAYS) - 1) : "";
  let body = "";
  if (R.sub === "acts") {
    const all = ACTS.map((a, k) => k + 1), cnt = f => all.filter(i => actMatch(s, i, f)).length;
    body = `<div class="acts-tools">${fchips("af", R.af, [["", "All", all.length], ["W", "In progress", cnt("W")], ["Y", "Not started", cnt("Y")], ["C", "Completed", cnt("C")], ["S", "Stalled", cnt("S")]])}${canEdit() ? `<button class="btn ghost sm" data-a="openform">Enter opening status</button>` : ""}</div>
    ${PHASES.map((ph, pi) => { const ids = all.filter(i => ACTS[i - 1][1] === pi), show = ids.filter(i => actMatch(s, i, R.af)), pp = phasePct(s, pi) || 0, dn = ids.filter(i => s.acts[i].s === "C").length, na = ids.filter(i => s.acts[i].s === "N").length;
      if (!show.length) return "";
      return `<details class="phase" ${pp < 100 || R.af ? "open" : ""}><summary><span class="ph-n ${pp === 100 ? "done" : ""}">${pp === 100 ? ic("check") : pi + 1}</span><div class="ph-t"><b>${ph[0]}</b><span>${dn} of ${ids.length - na} completed</span></div>${pm(pp)}${ic("down")}</summary>
      <div class="acts">${show.map(i => { const x = s.acts[i], sd = stalledDays(s, i); return `<div class="act ${mk ? "tap" : ""} s-${x.s}" ${mk ? `data-a="actform" data-v="${i}" tabindex="0" role="button"` : ""}><span class="act-n">${i}</span><div class="act-m"><b>${esc(actName(i))}</b><div class="act-meta"><span class="own o-${owner(s, i)}">${OWN[owner(s, i)]}</span>${x.chg && "CW".includes(x.s) ? `<span>${x.s === "C" ? "Completed" : "Updated"} ${fmt(x.chg)}</span>` : ""}</div>${x.note ? `<p class="act-note">${esc(x.note)}</p>` : ""}${x.s === "W" ? `<div class="meter"><i style="width:${x.p}%"></i></div>` : ""}</div><div class="act-r">${sd ? chip("bad", `Stalled ${sd}d`) : stChip(x)}${x.s === "W" ? `<b>${x.p}%</b>` : ""}${canEdit() ? `<button class="ibtn sm" data-a="scopeform" data-v="${i}" aria-label="Change scope of ${esc(actName(i))}">${ic("sliders")}</button>` : ""}</div></div>`; }).join("")}</div></details>`; }).join("") || empty("search", "No activities in this view", "Choose another filter.")}`;
  }
  if (R.sub === "gantt") body = vGantt(s);
  if (R.sub === "photos") { const ph = (d.updates || []).filter(u => u.photo); body = `<section class="panel"><div class="ptitle"><h2>Photo timeline</h2>${mk ? `<button class="btn sm" data-a="photoform">${ic("camera")}Add photo</button>` : ""}</div><div class="pad">${ph.length ? `<div class="photos">${ph.map(u => `<div class="phw">${photoCard({ url: u.photo.url, act: u.act, date: u.date })}${canEdit() ? `<button class="ph-del" data-a="delphoto" data-v="${u.id}" aria-label="Delete photo of ${esc(actName(u.act))}, ${fmt(u.date)}">${ic("trash")}</button>` : ""}</div>`).join("")}</div>` : empty("image", "No photos yet", "Photos added with progress updates appear here.")}</div></section>`; }
  if (R.sub === "visits") { const open = (d.visits || []).find(v => !v.outAt && v.date === today() && v.uid === me.uid); body = `<section class="panel"><div class="ptitle"><h2>Site visits</h2>${mk ? (open ? `<button class="btn accent sm" data-a="checkout" data-v="${open.id}">Check out</button>` : `<button class="btn sm" data-a="checkin">${ic("pin")}Check in at site</button>`) : ""}</div>${(d.visits || []).length ? `<div class="tw"><table class="rt"><thead><tr><th>Date</th><th>By</th><th>In</th><th>Out</th><th>Location check</th><th>Present</th><th>Remarks</th></tr></thead><tbody>${d.visits.map(v => `<tr><td>${fmtY(v.date)}</td><td>${esc(v.name)}</td><td>${esc(v.inAt)}</td><td>${esc(v.outAt || "Open")}</td><td>${v.atSite === true ? chip("ok", "At site") : v.atSite === false ? chip("bad", `${v.dist} m away`) : chip("", "Not verified")}</td><td>${esc(v.present || "")}</td><td>${esc(v.remarks || "")}</td></tr>`).join("")}</tbody></table></div>` : empty("pin", "No visits recorded", "A visit is recorded when the PMC checks in at site.")}${s.lat == null ? `<p class="hint">Site coordinates are not set, so check-ins cannot be verified. The EO can add them in Edit.</p>` : ""}</section>`; }
  if (R.sub === "meas") body = `<section class="panel"><div class="ptitle"><h2>Measurements</h2>${mk ? `<button class="btn sm" data-a="measform">${ic("plus")}Add</button>` : ""}</div>${(d.meas || []).length ? `<div class="tw"><table class="rt"><thead><tr><th>BOQ item</th><th class="n">Nos</th><th class="n">L</th><th class="n">B</th><th class="n">D</th><th class="n">Measured</th><th class="n">BOQ qty</th><th>Check</th><th></th></tr></thead><tbody>${d.meas.map(m => { const q = m.n * m.l * m.b * m.d; return `<tr><td>${esc(m.item)}</td><td class="n">${m.n}</td><td class="n">${m.l}</td><td class="n">${m.b}</td><td class="n">${m.d}</td><td class="n">${q.toFixed(2)} ${esc(m.unit)}</td><td class="n">${m.boq ? m.boq + " " + esc(m.unit) : ""}</td><td>${!m.boq ? chip("", "No BOQ qty") : q > m.boq ? chip("bad", "Over by " + (q - m.boq).toFixed(2)) : chip("ok", "Within BOQ")}</td><td>${mk ? `<button class="btn ghost sm" data-a="delmeas" data-v="${m.id}">Delete</button>` : ""}</td></tr>`; }).join("")}</tbody></table></div>` : empty("inbox", "No measurements yet", "Measurements are recorded against BOQ items for contractor-scope work.")}</section>`;
  if (R.sub === "mom") body = `<section class="panel"><div class="ptitle"><h2>MoM action points</h2>${mk || isEO() ? `<button class="btn sm" data-a="momform">${ic("plus")}Add point</button>` : ""}</div>${(d.mom || []).length ? `<div class="tw"><table class="rt"><thead><tr><th>Point</th><th>Raised</th><th>Owner</th><th>Target</th><th>Status</th><th></th></tr></thead><tbody>${d.mom.map(m => `<tr><td>${esc(m.t)}</td><td>${fmt(m.date)}</td><td>${esc(m.o)}</td><td>${fmt(m.d)}${m.open && m.d && m.d < today() ? " " + chip("bad", "Overdue") : ""}</td><td>${m.open ? chip("warn", "Open") : chip("ok", "Closed")}</td><td>${m.open && (mk || isEO()) ? `<button class="btn ghost sm" data-a="closemom" data-v="${m.id}">Close</button>` : ""}</td></tr>`).join("")}</tbody></table></div>` : empty("inbox", "No action points yet", "Points agreed with the dealer or contractor are tracked here until closed.")}</section>`;
  if (R.sub === "draw") body = `<section class="panel"><div class="ptitle"><h2>Site-specific drawings</h2></div><ul class="docs">${DRAW_SLOTS.map(([k, n]) => { const x = s.draw && s.draw[k]; return `<li><div class="doc-i ${x ? "" : "miss"}">${ic("draw")}</div><div class="doc-m"><b>${n}</b><span>${x ? `Revision R${x.rev} · ${esc(x.by)}, ${fmt(x.date)}` : "Not uploaded yet"}${x && x.hist && x.hist.length ? " · earlier: " + x.hist.map(o => `<a href="${esc(o.url)}" target="_blank" rel="noopener">R${o.rev}</a>`).join(", ") : ""}</span></div><div class="row">${x && x.url ? `<a class="btn ghost sm" href="${esc(x.url)}" target="_blank" rel="noopener">Open</a>` : ""}${mk ? `<button class="btn sm ${x ? "ghost" : ""}" data-a="drawform" data-v="${k}">${ic("upload")}${x ? "New revision" : "Upload"}</button>` : ""}</div></li>`; }).join("")}</ul></section>`;
  if (R.sub === "log") body = `<section class="panel"><div class="ptitle"><h2>Update log</h2><span class="note">Newest first</span></div>${(d.updates || []).length ? `<div class="tw"><table class="rt"><thead><tr><th>Activity</th><th>Date</th><th>Entry</th><th>Note</th><th>By</th><th>Photo</th><th>EO review</th></tr></thead><tbody>${d.updates.map(u => `<tr><td>${u.act ? u.act + ". " + esc(actName(u.act)) : "All activities"}</td><td>${fmt(u.date)}</td><td>${esc(u.to || "Photo only")}</td><td>${esc(u.note || "")}</td><td>${esc(u.name)}</td><td>${u.photo ? `<a href="${esc(u.photo.url)}" target="_blank" rel="noopener">View</a>` : u.photoDeleted ? `<span class="note">Deleted by ${esc(u.photoDeleted.by)}</span>` : ""}</td><td>${u.chk ? chip("ok", "Reviewed by " + u.chk.by) : isEO() ? `<button class="btn ghost sm" data-a="review" data-v="${u.id}">Mark reviewed</button>` : chip("", "Not reviewed")}</td></tr>`).join("")}</tbody></table></div>` : empty("inbox", "No entries yet", "Every progress update by the PMC is listed here.")}</section>`;
  return head(`<button class="crumb-b d-only" data-a="back">${ic("back")}Projects</button>`, "") + `
    <section class="hero st-${done ? "ok" : h[0] || "none"}"><div class="hero-main">${ring(o)}<div class="hero-t"><h2>${esc(s.name)}</h2><span>${esc(s.place)}${s.district ? ", " + esc(s.district) : ""}</span><div class="pc-tags"><span class="tag">${s.cat}</span>${done ? chip("ok", "Commissioned") : chip(h[0], h[1])}</div></div>${canEdit() ? `<button class="btn ghost sm hero-edit" data-a="siteform" data-v="${s.id}">${ic("edit")}<span>Edit</span></button>` : ""}</div>
    <div class="hero-stats"><div><span>Contractor scope</span><b>${byOwner(s, "C")}%</b><div class="meter"><i style="width:${byOwner(s, "C")}%"></i></div></div><div><span>Dealer scope</span><b>${byOwner(s, "D")}%</b><div class="meter"><i style="width:${byOwner(s, "D")}%"></i></div></div><div><span>Project day</span><b>${dayNo(s)} <small>of ${s.targetDays || TARGET_DAYS}</small></b></div><div><span>Target completion</span><b>${fmtY(target) || "Not set"}</b></div></div>
    <details class="hero-more"><summary>Site details${ic("down")}</summary><div class="facts"><div><span>EO</span>${esc(s.eoName || "Not mapped")}</div><div><span>SO</span>${esc(s.soName || "Not mapped")}</div><div><span>PMC</span>${esc(s.pmcName || "Not assigned")}</div><div><span>Sales group</span>${esc(s.sg || "Not mapped")}</div><div><span>Dealer</span>${esc(s.dealer || "Not entered")}</div><div><span>Contractor</span>${esc(s.contractor || "Not entered")}</div><div><span>WBSE</span>${esc(s.wbse || "Not entered")}</div><div><span>Work started</span>${fmtY(s.startDate) || "Not entered"}</div></div></details></section>
    <section class="stepper" aria-label="Project phases">${PHASES.map((ph, pi) => { const pp = phasePct(s, pi) || 0; return `<div class="stp ${pp === 100 ? "done" : pp > 0 ? "on" : ""}"><span class="stp-d">${pp === 100 ? ic("check") : pi + 1}</span><b>${ph[0]}</b><i>${pp}%</i></div>`; }).join("")}</section>
    <div class="subtabs" role="tablist">${tabs.map(x => `<button role="tab" aria-selected="${R.sub === x[0]}" data-a="sub" data-v="${x[0]}">${x[1]}</button>`).join("")}</div>${body}`;
}
function vGantt(s) {
  const sc = s.sched || {}, ed = canEdit(), t = today(), items = GANTT.map((g, k) => k + 1).filter(n => sc[n] && sc[n].ps && sc[n].pe);
  const btns = ed ? `<div class="row">${s.startDate ? `<button class="btn ghost sm" data-a="stdsched">Standard ${GANTT_DAYS}-day plan</button>` : ""}<button class="btn sm" data-a="planform">${ic("edit")}Edit plan</button></div>` : "";
  if (!items.length) return `<section class="panel"><div class="ptitle"><h2>Bar chart</h2></div>${empty("visits", "No schedule yet", s.startDate ? `Fill the standard ${GANTT_DAYS}-day bar chart from the work start date, ${fmtY(s.startDate)}, then adjust any dates.` : "Set the work start date with Edit to use the standard plan, or enter the dates yourself.", btns)}</section>`;
  const target = s.startDate ? addDays(s.startDate, (s.targetDays || TARGET_DAYS) - 1) : "";
  let lo = items.reduce((m, n) => sc[n].ps < m ? sc[n].ps : m, s.startDate || t), hi = items.reduce((m, n) => sc[n].pe > m ? sc[n].pe : m, target > t ? target : t);
  lo = addDays(lo, -1); hi = addDays(hi, 9);
  const n0 = diff(hi, lo) + 1, off = d => diff(d, lo), anchor = s.startDate || lo, mo = ((off(anchor) % 7) + 7) % 7;
  const ticks = []; for (let k = mo; k < n0; k += 7) { const wk = Math.round((k - off(anchor)) / 7) + 1; ticks.push(`<span style="left:calc(var(--dw)*${k})">${s.startDate && wk >= 1 ? `<b>Week ${wk}</b>` : ""}${fmt(addDays(lo, k))}</span>`); }
  const late = items.filter(n => gOver(s, n)).length, done = items.filter(n => (sc[n].p || 0) >= 100).length;
  const rows = items.map(n => { const g = GANTT[n - 1], x = sc[n], od = gOver(s, n), len = diff(x.pe, x.ps) + 1, p = x.p || 0, cls = p >= 100 ? "done" : od ? "late" : p > 0 ? "on" : "";
    return `<div class="g-row${ed ? " tap" : ""}" ${ed ? `data-a="gitem" data-v="${n}" tabindex="0" role="button" aria-label="${esc(g[0])}: ${fmt(x.ps)} to ${fmt(x.pe)}, ${p} percent${od ? ", " + od + " days late" : ""}. Update"` : ""}><div class="g-name" title="${esc(g[0])}"><i>${n}</i>${esc(g[0])}</div><div class="g-track"><div class="g-bar ${cls}" style="left:calc(var(--dw)*${off(x.ps)});width:calc(var(--dw)*${len})" title="${esc(g[0])}: ${fmt(x.ps)} to ${fmt(x.pe)}, ${len} days, ${p}% done${od ? ", " + od + " days late" : ""}"><b style="width:${p}%"></b></div><span class="g-lab" style="left:calc(var(--dw)*${off(x.ps) + len} + 6px)">${len}d · ${p}%${od ? " · " + od + "d late" : ""}</span></div></div>`; }).join("");
  return `<section class="panel"><div class="ptitle"><h2>Bar chart</h2>${btns}</div>
    <div class="g-sum"><span>${items.length} works</span><span>${done} completed</span>${late ? chip("bad", `${late} overdue`) : chip("ok", "None overdue")}${ed ? `<span class="note">Tap a row to update it</span>` : ""}</div>
    <div class="gantt" role="img" aria-label="Bar chart of ${items.length} works, ${done} completed, ${late} overdue"><div class="g-in" style="--n:${n0};--mo:${mo}">
      <div class="g-row g-head"><div class="g-name">Item of work</div><div class="g-track g-ticks">${ticks.join("")}</div></div>${rows}
      ${t >= lo && t <= hi ? `<div class="g-today" style="left:calc(var(--nw) + var(--dw)*${off(t)} + var(--dw)/2)"><span>Today</span></div>` : ""}${target && target >= lo && target <= hi ? `<div class="g-today tgt" style="left:calc(var(--nw) + var(--dw)*${off(target)} + var(--dw))"><span>Target</span></div>` : ""}
    </div></div>
    <div class="legend"><span><i class="g-k"></i>Planned</span><span><i class="g-k on"></i>Done so far</span><span><i class="g-k done"></i>Completed</span><span><i class="g-k late"></i>Overdue</span></div></section>`;
}
function planForm() {
  const s = site(R.siteId), sc = s.sched || {};
  dlg("Bar chart plan: " + s.name, `<p class="note">Planned start and finish for each item of work. Leave both dates empty to keep an item off the chart.</p>
    <div class="tw plan-tbl"><table><thead><tr><th class="n">No</th><th>Item of work</th><th>Planned start</th><th>Planned finish</th><th class="n">% done</th></tr></thead><tbody>${GANTT.map((g, k) => { const n = k + 1, x = sc[n] || {}; return `<tr><td class="n">${n}</td><td>${esc(g[0])} <span class="note">(std ${g[1]} d)</span></td><td><input type="date" name="ps_${n}" value="${esc(x.ps)}" aria-label="Planned start ${n}"></td><td><input type="date" name="pe_${n}" value="${esc(x.pe)}" aria-label="Planned finish ${n}"></td><td><input type="number" name="p_${n}" min="0" max="100" value="${x.p || 0}" aria-label="Percent done ${n}"></td></tr>`; }).join("")}</tbody></table></div>`, "plan", "Save plan", true);
}
function gItemForm(n) {
  const s = site(R.siteId), g = GANTT[n - 1], x = (s.sched || {})[n] || {};
  dlg(`${n}. ${g[0]}`, `<input type="hidden" name="n" value="${n}"><div class="form">
    <label>Planned start<input name="ps" type="date" value="${esc(x.ps)}"></label><label>Planned finish<input name="pe" type="date" value="${esc(x.pe)}"></label>
    <label>Percent done<input name="p" type="number" min="0" max="100" value="${x.p || 0}" required></label></div>
    <label>Remark<input name="note" value="${esc(x.note)}" placeholder="e.g. waiting for cube test result"></label>
    <p class="note">Standard duration ${g[1]} days.${g[3] ? ` Enclose: ${esc(g[3])}.` : ""} 100% marks the work completed.</p>`, "gitem", "Save");
}
function actMatch(s, i, f) { const x = s.acts[i]; return !f || (f === "S" ? !!stalledDays(s, i) : x.s === f); }

function vVisits() {
  const ws = R.week, days = [0, 1, 2, 3, 4, 5, 6].map(k => addDays(ws, k)), act = sites.filter(s => s.status !== "commissioned");
  return `<section class="panel"><div class="ptitle wk"><button class="ibtn" data-a="week" data-v="-7" aria-label="Previous week">${ic("back")}</button><h2>${fmt(ws)} to ${fmt(days[6])}${ws === weekStart(today()) ? " <span class='note'>This week</span>" : ""}</h2><button class="ibtn" data-a="week" data-v="7" aria-label="Next week">${ic("right")}</button></div>
  ${act.length ? `<div class="plan">${act.map(s => { const u = updInWeek(s, ws).length, can = canMake(s) || isEO(); return `<div class="plan-row"><div class="plan-site"><b>${esc(s.name)}</b><span>${esc(s.pmcName || "PMC not assigned")}</span></div><div class="week">${days.map(d => { const v = planState(s, d); return `<button class="day ${v} ${d === today() ? "now" : ""}" ${can && v !== "done" ? `data-a="plan" data-v="${s.id}|${d}"` : "disabled"} aria-label="${esc(s.name)}, ${fmt(d)}, ${v || "no visit"}"><span>${"SMTWTFS"[dOf(d).getDay()]}</span><b>${dOf(d).getDate()}</b></button>`; }).join("")}</div><div class="plan-upd"><span>Update days</span>${chip(u >= UPDATE_DAYS_PER_WEEK ? "ok" : ws < weekStart(today()) || u === 0 ? "bad" : "warn", `${u} of ${UPDATE_DAYS_PER_WEEK}`)}</div></div>`; }).join("")}</div>
  <div class="legend"><span><i class="planned"></i>Planned</span><span><i class="done"></i>Visited</span><span><i class="missed"></i>Missed</span><span class="note">Tap a day to plan or cancel a visit</span></div>` : empty("visits", "No active projects", "The visit planner fills in once a project is added.")}</section>
  <section class="panel"><div class="ptitle"><h2>Visit record</h2></div>${visitsAll.length ? `<div class="tw"><table class="rt"><thead><tr><th>Site</th><th>Date</th><th>By</th><th>In</th><th>Out</th><th>Location check</th><th>Remarks</th></tr></thead><tbody>${visitsAll.slice(0, 40).map(v => `<tr><td>${esc(v.site)}</td><td>${fmtY(v.date)}</td><td>${esc(v.name)}</td><td>${esc(v.inAt)}</td><td>${esc(v.outAt || "Open")}</td><td>${v.atSite === true ? chip("ok", "At site") : v.atSite === false ? chip("bad", `${v.dist} m away`) : chip("", "Not verified")}</td><td>${esc(v.remarks || "")}</td></tr>`).join("")}</tbody></table></div>` : empty("pin", "No visits recorded", "Check-ins by the PMC are listed here with the location check.")}</section>`;
}

const libUrl = f => DRAW_BASE + f.split("/").map(encodeURIComponent).join("/");
const libCount = n => n.f ? 1 : n.k.reduce((t, k) => t + libCount(k), 0);
function libFlat() { if (libFlat.c) return libFlat.c; const out = [], walk = (ks, trail) => ks.forEach(x => x.f ? out.push({ ...x, trail }) : walk(x.k, [...trail, x.t])); walk(DRAW_LIB, []); return (libFlat.c = out); }
const libFile = (x, trail) => `<li><div class="doc-i">${ic("draw")}</div><div class="doc-m"><b>${esc(x.t)}</b><span>${trail ? esc(trail.join(" › ")) : ""}${trail && x.d ? " · " : ""}${x.d ? esc(x.d) : ""}</span></div><a class="btn ghost sm" href="${esc(libUrl(x.f))}" target="_blank" rel="noopener">${x.x ? "Download " + x.x : "Open"}</a></li>`;
function libHtml() {
  const q = R.dq.trim().toLowerCase();
  if (q) { const words = q.split(/\s+/), hits = libFlat().filter(x => { const h = (x.t + " " + x.trail.join(" ") + " " + (x.d || "") + " " + x.f).toLowerCase(); return words.every(w => h.includes(w)); });
    return hits.length ? `<ul class="docs">${hits.slice(0, 60).map(x => libFile(x, x.trail)).join("")}</ul>${hits.length > 60 ? `<p class="hint lib-more">Showing 60 of ${hits.length}. Add another word to narrow the list.</p>` : ""}` : empty("search", "No matching drawings", "Try another word, such as tank, culvert or monolith."); }
  const path = []; let node = { k: DRAW_LIB };
  for (const i of R.dp) { if (!node.k || !node.k[i]) break; node = node.k[i]; path.push(node.t); }
  const bc = path.length ? `<nav class="bc" aria-label="Folder path"><button data-a="dpath" data-v="0">All</button>${path.map((t, k) => `<span>›</span>${k === path.length - 1 ? `<b>${esc(t)}</b>` : `<button data-a="dpath" data-v="${k + 1}">${esc(t)}</button>`}`).join("")}</nav>` : "";
  return bc + `<ul class="docs">${node.k.map((x, i) => x.f ? libFile(x) : `<li class="tap" data-a="dopen" data-v="${i}" tabindex="0"><div class="doc-i fold">${ic("folder")}</div><div class="doc-m"><b>${esc(x.t)}</b><span>${libCount(x)} drawings${x.k.some(c => !c.f) ? " · " + x.k.filter(c => !c.f).map(c => esc(c.t)).slice(0, 5).join(", ") + (x.k.filter(c => !c.f).length > 5 ? "…" : "") : ""}</span></div>${ic("right")}</li>`).join("")}</ul>`;
}
function libNav(patch) { Object.assign(R, patch); try { history.pushState({ r: snap() }, ""); } catch (e) { } render(); window.scrollTo(0, 0); }
function vDraw() {
  return `<section class="panel"><div class="ptitle"><h2>Standard drawings</h2><span class="note">${libFlat().length} drawings</span></div>
    <div class="lib-search"><label class="search">${ic("search")}<input type="search" data-i="dq" value="${esc(R.dq)}" placeholder="Search, e.g. 20 KL masonry, culvert, monolith" aria-label="Search standard drawings"></label></div>
    <div id="dlib">${libHtml()}</div></section>
  ${std.length || isEO() ? `<section class="panel"><div class="ptitle"><h2>Added in the app</h2>${isEO() ? `<button class="btn sm" data-a="stdform">${ic("upload")}Add drawing</button>` : ""}</div>${std.length ? `<ul class="docs">${std.map(d => `<li><div class="doc-i">${ic("draw")}</div><div class="doc-m"><b>${esc(d.title)}</b><span>${esc(d.by)}, ${fmtY(d.date)}</span></div><a class="btn ghost sm" href="${esc(d.url)}" target="_blank" rel="noopener">Open</a></li>`).join("")}</ul>` : empty("upload", "Nothing added here", "Use this for a drawing that is not in the standard library.")}</section>` : ""}
  <section class="panel"><div class="ptitle"><h2>Site-specific drawings</h2></div>${sites.length ? `<ul class="docs">${sites.map(s => `<li class="tap" data-a="opendraw" data-v="${s.id}" tabindex="0"><div class="doc-m"><b>${esc(s.name)}</b><div class="slots">${DRAW_SLOTS.map(([k, n]) => { const x = s.draw && s.draw[k]; return chip(x ? "ok" : "bad", n.replace(" layout", "") + (x ? " R" + x.rev : " missing")); }).join("")}</div></div>${ic("right")}</li>`).join("")}</ul>` : empty("sites", "No projects", "Each project has slots for RO, electrical and foundation layouts.")}</section>`;
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
  if (R.letter) { const l = letters.find(x => x.id === R.letter); if (l) return head(`<button class="crumb-b d-only" data-a="letterback">${ic("back")}Letters</button>`, `<button class="btn" data-a="print">Print or save as PDF</button>`) + `<div class="letter print">${esc(letterFull(l))}</div>`; }
  const s = site(L.siteId), vis = letters.filter(l => site(l.siteId)), lb = letterBody();
  const form = !s ? empty("sites", "No projects available", "Letters are drafted against a project activity.") : `<div class="form">
      <label>Site<select data-c="ltsite">${sites.map(x => opt(x.id, x.name, L.siteId)).join("")}</select></label>
      <label>Type<select data-c="lttype">${opt("Delay", "Delay", L.type)}${opt("Deviation", "Deviation from standard", L.type)}</select></label>
      <label class="full">Activity<select data-c="ltact">${ACTS.map((a, k) => "CN".includes(s.acts[k + 1].s) ? "" : opt(k + 1, `${k + 1}. ${a[0]} (${OWN[owner(s, k + 1)]})${stalledDays(s, k + 1) ? " - stalled" : ""}`, L.act)).join("")}</select></label>
      ${L.type === "Deviation" ? `<label class="full">Observation<textarea data-c="ltobs" rows="3" placeholder="What was found against the drawing">${esc(L.obs)}</textarea></label>` : ""}</div>
      <div class="row">${me.role !== "tm" ? `<button class="btn ghost" data-a="saveletter" data-v="Draft">Save as draft</button>` : ""}${isEO() ? `<button class="btn" data-a="saveletter" data-v="Issued">Issue letter</button>` : ""}</div>
      <p class="hint">${isEO() ? "Issuing gives the letter a reference number and your name." : "The PMC can save a draft. The EO issues it."}</p>`;
  return `<div class="grid two"><section class="panel"><div class="ptitle"><h2>New letter</h2></div><div class="pad">${form}</div></section>${lb ? `<section class="panel"><div class="ptitle"><h2>Preview</h2></div><div class="letter flat">${esc(lb.text)}</div></section>` : ""}</div>
  <section class="panel"><div class="ptitle"><h2>Letter log</h2><span class="note">${vis.length} letters</span></div>${vis.length ? `<div class="tw"><table class="rt"><thead><tr><th>Subject</th><th>Ref</th><th>Date</th><th>Site</th><th>To</th><th>Type</th><th>Status</th><th></th></tr></thead><tbody>${vis.map(l => `<tr><td>${esc(actName(l.act))}</td><td>${esc(l.ref || "Not issued")}</td><td>${fmtY(l.issued || l.date)}</td><td>${esc(l.siteName)}</td><td>${esc(l.to)}</td><td>${esc(l.type)}</td><td>${l.status === "Issued" ? chip("ok", "Issued") : chip("warn", "Draft by " + l.by)}</td><td><div class="row"><button class="btn ghost sm" data-a="viewletter" data-v="${l.id}">View</button>${l.status !== "Issued" && isEO() ? `<button class="btn sm" data-a="issueletter" data-v="${l.id}">Issue</button>` : ""}</div></td></tr>`).join("")}</tbody></table></div>` : empty("letters", "No letters yet", "Delay and deviation letters to dealers and contractors are logged here.")}</section>`;
}

function vUsers() {
  const list = users.filter(u => u.role !== "removed").sort((a, b) => a.name.localeCompare(b.name));
  return head("", `<button class="btn d-only" data-a="userform">${ic("plus")}Add user</button>`, `<button class="fab" data-a="userform" aria-label="Add user">${ic("plus")}<span>Add user</span></button>`) + `<section class="panel"><ul class="people">${list.map(u => { const st = sites.filter(s => s.pmcUid === u.uid || s.eoUid === u.uid); return `<li><span class="avatar">${esc(initials(u.name))}</span><div class="doc-m"><b>${esc(u.name)}${u.uid === me.uid ? " <span class='note'>(you)</span>" : ""}</b><span>${esc(u.userId || "")}${st.length ? " · " + st.map(s => esc(s.name)).join(", ") : ""}</span></div>${u.uid === me.uid ? `<span class="role r-${u.role}">${ROLE[u.role]}</span>` : `<select class="role-sel r-${u.role}" data-c="role" data-v="${u.uid}" aria-label="Role for ${esc(u.name)}">${Object.keys(ROLE).map(r => opt(r, ROLE[r], u.role)).join("")}</select>`}</li>`; }).join("")}</ul></section>
  <p class="hint">You create every login here and hand the User ID and starting password to the person. Set a role to No access to block a login. Every PMC can create projects and update any project.</p>`;
}

/* ---------- shell ---------- */
const TITLES = { dash: "Overview", sites: "Projects", visits: "Site visits", draw: "Drawings", letters: "Letters", users: "Users" };
let navMini = false, lastKey = ""; try { navMini = localStorage.getItem("nro-nav-mini") === "1"; } catch (e) { }
const skeleton = () => `<div class="skel-row">${"<div class='skel k'></div>".repeat(4)}</div><div class="skel b"></div><div class="skel b"></div>`;
function render() {
  const app = $("app"), full = $("full");
  if (!me || me.role === "pending") { app.hidden = true; full.hidden = false; $("fab").innerHTML = ""; full.innerHTML = me ? vPending() : vAuth(); return; }
  app.hidden = false; full.hidden = true; full.innerHTML = ""; app.classList.toggle("mini", navMini);
  const inSite = R.tab === "sites" && R.siteId && site(R.siteId), inLetter = R.tab === "letters" && R.letter, more = ["draw", "letters", "users"].includes(R.tab);
  const tabs = [["dash", "Overview", ""], ["sites", "Projects", ""], ["visits", "Visits", ""], ["draw", "Drawings", "d-only"], ["letters", "Letters", "d-only"]]; if (isAdmin()) tabs.push(["users", "Users", "d-only"]);
  $("nav").innerHTML = tabs.map(t => `<button class="${t[2]}" ${R.tab === t[0] ? 'aria-current="page"' : ""} data-a="tab" data-v="${t[0]}" title="${t[1]}"><span class="ni">${ic(t[0])}</span><span class="nl">${t[1]}</span></button>`).join("") + `<button class="m-only" ${more ? 'aria-current="page"' : ""} data-a="more"><span class="ni">${ic("more")}</span><span class="nl">More</span></button>`;
  topAct = ""; topFab = "";
  const html = R.tab === "dash" ? vDash() : R.tab === "sites" ? (inSite ? vSite() : vSiteList()) : R.tab === "visits" ? vVisits() : R.tab === "draw" ? vDraw() : R.tab === "letters" ? vLetters() : vUsers();
  $("top").innerHTML = `${inSite || inLetter ? `<button class="ibtn m-only" data-a="${inLetter ? "letterback" : "back"}" aria-label="Back">${ic("back")}</button>` : ""}<h1>${inSite ? "Project" : inLetter ? "Letter" : TITLES[R.tab]}</h1>${DEMO ? `<span class="demo-tag">Demo</span>` : ""}${topAct}<button class="avatar m-only" data-a="profile" aria-label="Account menu">${esc(initials(me.name))}</button>`;
  $("foot").innerHTML = `<button class="profile" data-a="profile" title="Account"><span class="avatar">${esc(initials(me.name))}</span><div><b>${esc(me.name)}</b><span>${ROLE[me.role]}</span></div>${ic("down")}</button><button class="collapse" data-a="navtoggle" title="Collapse menu">${ic("panel")}<span>Collapse</span></button>`;
  const m = $("main");
  m.innerHTML = html; $("fab").innerHTML = topFab;
  const key = [R.tab, R.siteId, R.sub, R.letter].join("|"); if (key !== lastKey) { lastKey = key; m.classList.remove("enter"); void m.offsetWidth; m.classList.add("enter"); }
  labelTables();
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
    <div class="row"><button type="button" class="btn ghost sm" data-a="herepos">Use my current location</button></div>
    ${id ? "" : `<p class="note">Saving copies the ${ACTS.length}-activity template with the ${"CC or DC"} scope owners and sets every activity to Yet to start.</p>`}`, "site", id ? "Save" : "Create project");
}
function actForm(i) {
  const s = site(R.siteId), x = s.acts[i];
  dlg(`${i}. ${actName(i)}`, `<input type="hidden" name="i" value="${i}"><div class="form">
    <label>Status<select name="s">${opt("Y", "Yet to start", x.s)}${opt("W", "In progress", x.s)}${opt("C", "Completed", x.s)}${opt("N", "Not applicable", x.s)}</select></label>
    <label>Percent done (when in progress)<input name="p" type="number" min="1" max="99" value="${x.s === "W" ? x.p : ""}"></label></div>
    <label>Pending item or remark<input name="note" value="${esc(x.note)}" placeholder="e.g. chamber cover pending"></label>
    ${ACT_LIB[i] ? `<button type="button" class="btn ghost sm lib-link" data-a="libgo" data-v="${esc(ACT_LIB[i])}">${ic("folder")}Standard drawings: ${esc(ACT_LIB[i])}</button>` : ""}
    <label>Photo (optional)<input name="file" type="file" accept="image/*" capture="environment"></label>
    <p class="note">${UPDATE_DAY_NEEDS_PHOTO ? `A photo is optional, but only entries with a photo count towards the ${UPDATE_DAYS_PER_WEEK}-day rule.` : `A photo is optional. Any saved update counts towards the ${UPDATE_DAYS_PER_WEEK}-day rule.`}</p>`, "act", "Save update");
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
    <div class="row"><button type="button" class="btn ghost sm" data-a="parsepaste">Fill the table from pasted text</button><span class="note" id="o-msg">Or set each row by hand below.</span></div>
    <div class="tw" style="max-height:50vh;overflow:auto;border:1px solid var(--line);border-radius:6px"><table><thead><tr><th class="n">No</th><th>Activity</th><th>Scope</th><th>Status</th><th>%</th><th>Pending item</th></tr></thead><tbody>${ACTS.map((a, k) => { const i = k + 1, x = s.acts[i]; return `<tr><td class="n">${i}</td><td>${esc(a[0])}</td><td>${OWN[owner(s, i)]}</td><td><select name="s_${i}" id="o-s-${i}" aria-label="Status ${i}">${opt("Y", "Yet to start", x.s)}${opt("W", "In progress", x.s)}${opt("C", "Completed", x.s)}${opt("N", "Not applicable", x.s)}</select></td><td><input name="p_${i}" id="o-p-${i}" type="number" min="1" max="99" value="${x.s === "W" ? x.p : ""}" aria-label="Percent ${i}"></td><td><input name="n_${i}" id="o-n-${i}" value="${esc(x.note)}" aria-label="Pending item ${i}"></td></tr>`; }).join("")}</tbody></table></div>
    <p class="note">In-progress rows without a percentage are saved as 50%. This is recorded in the update log as one opening entry and does not count as a photo update day.</p>`, "opening", "Save opening status", true);
}

/* ---------- actions ---------- */
async function saveEntry(s, i, next, note, file, plan) {
  const prev = s.acts[i], t = today(), pos = file ? await getPos() : null; let photo = null;
  if (file) { const blob = await compress(file, `${s.name} | ${actName(i)} | ${fmtY(t)} ${hhmm()}${pos ? ` | ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}` : ""}`); photo = await store.upload(`sites/${s.id}/photos/${t}/${Date.now()}_${i}.jpg`, blob); }
  const changed = next && (next.s !== prev.s || next.p !== prev.p), patch = { lastUpdate: new Date().toISOString() };
  if (next) {
    const a = { ...prev, s: next.s, p: next.p, chg: changed ? t : (prev.chg || t) }; if (note) a.note = note; else delete a.note;
    if ("WC".includes(a.s)) { if (!a.as) a.as = t; } else delete a.as; // actual start: first day it left "not started"
    if (a.s === "C") { if (!a.ae) a.ae = t; } else delete a.ae;       // actual finish: day it was marked Completed
    if (plan) { if (plan.ps && plan.pe) { a.ps = plan.ps; a.pe = plan.pe; } else { delete a.ps; delete a.pe; } }
    patch["acts." + i] = a;
  }
  if (photo || (next && !UPDATE_DAY_NEEDS_PHOTO)) patch.updDays = uniq([...(s.updDays || []), t]).slice(-90);
  if (photo) { patch.lastPhotos = [{ url: photo.url, act: i, date: t }, ...(s.lastPhotos || [])].slice(0, 4); }
  await store.patchSite(s.id, patch);
  const u = { ts: new Date().toISOString(), date: t, uid: me.uid, name: me.name, act: i, note: note || "" };
  if (next) u.to = next.s === "C" ? "Completed" : next.s === "W" ? `In progress ${next.p}%` : next.s === "N" ? "Not applicable" : "Yet to start";
  if (photo) u.photo = photo; if (pos) u.pos = pos;
  await store.subAdd(s.id, "updates", u);
}
let installEvt = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; if (me && me.role !== "pending") render(); });
window.addEventListener("appinstalled", () => { installEvt = null; if (me) render(); });
const H = {
  install: async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice.catch(() => { }); installEvt = null; render(); },
  demo: v => run(() => store.login(v)),
  resetdemo: () => store.reset(),
  eye: (v, b) => { const i = b.parentNode.querySelector("input"); i.type = i.type === "password" ? "text" : "password"; b.setAttribute("aria-label", i.type === "password" ? "Show password" : "Hide password"); },
  userform: () => dlg("Add user", `<div class="form"><label>Full name<input name="name" required></label><label>User ID<input name="userId" required pattern="[A-Za-z0-9._\\-]{3,30}" autocapitalize="none" spellcheck="false" placeholder="e.g. pmc.ravi"></label><label>Starting password<input name="pw" required minlength="6" autocomplete="off"></label><label>Role<select name="role">${["pmc", "eo", "tm", "admin"].map(r => opt(r, ROLE[r], "pmc")).join("")}</select></label></div><p class="note">User ID: 3 to 30 letters, digits, dot, dash or underscore. Give the ID and password to the user; they can change the password after signing in.</p>`, "adduser", "Create login"),
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
    else { const id = await store.createSite({ ...d, cat: f.cat, status: "active", acts: blankActs(), sched: f.startDate ? stdSched(f.startDate) : {}, plan: {}, updDays: [], visitDays: [], lastPhotos: [], draw: {}, createdAt: new Date().toISOString(), createdBy: me.name }); R.tab = "sites"; R.siteId = id; R.sub = "acts"; }
    closeDlg(); await refresh();
  }),
  act: (f, files) => run(async () => {
    const s = site(R.siteId), i = +f.i, prev = s.acts[i], file = files.file;
    const p = f.s === "C" ? 100 : f.s === "W" ? Math.round(+f.p) : 0;
    if (f.s === "W" && !(p >= 1 && p <= 99)) throw new Error("Enter percent done between 1 and 99");
    await saveEntry(s, i, { s: f.s, p }, f.note.trim(), file); closeDlg(); await refresh(); toast("Update saved");
  }),
  opening: f => run(async () => {
    const s = site(R.siteId), t = today(), acts = {}; let c = 0;
    ACTS.forEach((a, k) => { const i = k + 1, prev = s.acts[i], st = f["s_" + i], p = st === "C" ? 100 : st === "W" ? Math.min(99, Math.max(1, Math.round(+f["p_" + i]) || 50)) : 0, x = { s: st, p, chg: st !== prev.s || p !== prev.p ? t : (prev.chg || t) }; if (prev.own) x.own = prev.own; if (prev.ps) { x.ps = prev.ps; x.pe = prev.pe; } const note = (f["n_" + i] || "").trim(); if (note) x.note = note; if (st === "C") c++; acts[i] = x; });
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

/* ---------- navigation, menus, filters ---------- */
const snap = () => ({ tab: R.tab, siteId: R.siteId, sub: R.sub, letter: R.letter, dp: R.dp.slice() });
function navTo(patch) { const wasOpen = ovlOpen(); if (wasOpen) $("ovl").innerHTML = ""; return go(patch, wasOpen ? "replace" : "push"); }
Object.assign(H, {
  tab: v => { R.q = ""; R.fs = ""; R.fc = ""; R.fEO = ""; R.af = ""; R.dq = ""; navTo({ tab: v, siteId: null, letter: null, dp: [] }); },
  open: v => { R.af = ""; navTo({ tab: "sites", siteId: v, sub: "acts", letter: null }); },
  opendraw: v => navTo({ tab: "sites", siteId: v, sub: "draw", letter: null }),
  back: () => navTo({ siteId: null }),
  sub: v => go({ sub: v }, "replace"),
  viewletter: v => navTo({ letter: v }),
  letterback: () => navTo({ letter: null }),
  more: () => sheet("", [["tab", "draw", "Drawings", R.tab === "draw" ? "on" : "", "draw"], ["tab", "letters", "Letters", R.tab === "letters" ? "on" : "", "letters"]].concat(isAdmin() ? [["tab", "users", "Users", R.tab === "users" ? "on" : "", "users"]] : [])),
  profile: () => sheet(`<span class="avatar">${esc(initials(me.name))}</span><div><b>${esc(me.name)}</b><span>${ROLE[me.role]}${me.userId ? " · " + esc(me.userId) : ""} · v${APP_VERSION}</span></div>`, [["pwform", "key", "Change password"]].concat(installEvt ? [["install", "download", "Install app"]] : [], [["logout", "logout", "Sign out", "danger"]])),
  logout: () => { $("ovl").innerHTML = ""; run(() => store.logout()); },
  navtoggle: () => { navMini = !navMini; try { localStorage.setItem("nro-nav-mini", navMini ? "1" : "0"); } catch (e) { } render(); },
  fstat: v => { R.fs = v; render(); },
  af: v => { R.af = v; render(); },
  clearf: () => { R.q = ""; R.fs = ""; R.fc = ""; R.fEO = ""; render(); },
  delmeas: v => confirmDlg("Delete measurement?", "This measurement will be removed from the site record. This cannot be undone.", "Delete", async () => { await store.subDel(R.siteId, "meas", v); await refresh(); toast("Measurement deleted"); })
});
Object.assign(H, {
  planform: () => planForm(),
  gitem: v => gItemForm(+v),
  stdsched: () => { const s = site(R.siteId), has = Object.keys(s.sched || {}).length, apply = async () => { const sc = s.sched || {}, std = stdSched(s.startDate), out = {}; GANTT.forEach((g, k) => { const n = k + 1; out[n] = { ...(sc[n] || {}), ps: std[n].ps, pe: std[n].pe, p: (sc[n] || {}).p || 0 }; }); await store.patchSite(s.id, { sched: out }); R.sub = "gantt"; await refresh(); toast("Standard plan applied"); };
    if (has) confirmDlg("Replace planned dates?", `All 21 items get the standard dates counted from ${fmtY(s.startDate)}. Percent done and remarks are kept.`, "Replace dates", apply); else run(apply); },
  dopen: v => libNav({ dp: [...R.dp, +v] }),
  dpath: v => libNav({ dp: R.dp.slice(0, +v) }),
  libgo: v => { const i = DRAW_LIB.findIndex(x => x.t === v); R.dq = ""; navTo({ tab: "draw", siteId: null, letter: null, dp: i < 0 ? [] : [i] }); },
  delphoto: v => confirmDlg("Delete this photo?", "The photo is removed from the site record and from storage. The update entry stays in the log. This cannot be undone.", "Delete photo", async () => {
    const s = site(R.siteId), u = ((sub[s.id] || {}).updates || []).find(x => x.id === v); if (!u || !u.photo) return;
    await store.removeFile(u.photo.path);
    await store.subPatch(s.id, "updates", v, { photo: DEL, photoDeleted: { by: me.name, on: today() } });
    await store.patchSite(s.id, { lastPhotos: (s.lastPhotos || []).filter(p => p.url !== u.photo.url) });
    await refresh(); toast("Photo deleted");
  })
});
F.plan = f => run(async () => {
  const s = site(R.siteId), sc = s.sched || {}, out = {};
  for (let n = 1; n <= GANTT.length; n++) { const ps = f["ps_" + n], pe = f["pe_" + n], p = Math.round(+f["p_" + n] || 0);
    if ((ps || pe) && !(ps && pe)) throw new Error(`Item ${n}: enter both dates, or leave both empty`);
    if (ps && pe < ps) throw new Error(`Item ${n}: finish cannot be before start`);
    if (p < 0 || p > 100) throw new Error(`Item ${n}: percent done must be 0 to 100`);
    if (ps) out[n] = { ...(sc[n] || {}), ps, pe, p }; }
  await store.patchSite(s.id, { sched: out }); closeDlg(); R.sub = "gantt"; await refresh(); toast("Plan saved");
});
F.gitem = f => run(async () => {
  const s = site(R.siteId), n = +f.n, p = Math.round(+f.p);
  if (!f.ps || !f.pe) throw new Error("Enter both planned dates");
  if (f.pe < f.ps) throw new Error("Planned finish cannot be before planned start");
  if (!(p >= 0 && p <= 100)) throw new Error("Percent done must be 0 to 100");
  const x = { ...((s.sched || {})[n] || {}), ps: f.ps, pe: f.pe, p }; if (f.note.trim()) x.note = f.note.trim(); else delete x.note;
  if (p >= 100 && !x.done) x.done = today(); if (p < 100) delete x.done;
  await store.patchSite(s.id, { ["sched." + n]: x }); closeDlg(); await refresh(); toast("Saved");
});
Object.assign(C, { fcat: v => { R.fc = v; render(); }, sort: v => { R.sort = v; render(); }, feo: v => { R.fEO = v; render(); } });
F.confirm = () => { const fn = confirmFn; confirmFn = null; closeDlg(); if (fn) run(fn); };
window.addEventListener("popstate", e => {
  if (ignorePop) { ignorePop = false; return; }
  if (ovlOpen()) { $("ovl").innerHTML = ""; return; }
  if (!me || me.role === "pending") return;
  const r = e.state && e.state.r; if (r) go(r, "pop");
});
document.addEventListener("input", e => { if (e.target.dataset.i === "dq") { R.dq = e.target.value; const el = $("dlib"); if (el) el.innerHTML = libHtml(); } if (e.target.dataset.i === "q") { R.q = e.target.value; const el = $("plist"); if (el) el.innerHTML = plistHtml(); } });

/* ---------- events ---------- */
document.addEventListener("click", e => {
  const b = e.target.closest("[data-a]"); if (!b) return;
  if (b.classList.contains("ovl")) { if (e.target === b) closeDlg(); return; }
  if (b.tagName !== "BUTTON" && e.target.closest("a,button,input,select,textarea,label,summary")) return;
  const fn = H[b.dataset.a]; if (fn) fn(b.dataset.v, b);
});
document.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.matches("[data-a][tabindex]")) H[e.target.dataset.a](e.target.dataset.v); if (e.key === "Escape") closeDlg(); });
document.addEventListener("change", e => { const c = e.target.dataset.c; if (c && C[c]) C[c](e.target.value, e.target); });
document.addEventListener("submit", e => {
  const form = e.target.closest("form[data-f]"); if (!form) return; e.preventDefault();
  const f = {}, files = {}; new FormData(form).forEach((v, k) => { if (v instanceof File) { if (v.size) files[k] = v; } else f[k] = v; });
  form.querySelectorAll("select[disabled]").forEach(s => f[s.name] = s.value);
  F[form.dataset.f](f, files);
});

/* ---------- start ---------- */
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  // When a new version takes over from an older one, reload once so the new screens show straight away.
  const hadController = !!navigator.serviceWorker.controller; let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(r => r.update()).catch(() => { });
}
(async () => {
  try { store = await initStore(); } catch (e) { $("full").hidden = false; $("full").innerHTML = `<div class="auth"><div class="dlg"><div class="pad"><h2>Could not connect</h2><p>${esc(e.message)}</p><p class="note">Check firebase-config.js and your network, then reload.</p></div></div></div>`; return; }
  store.onAuth(async p => { me = p; users = []; if (me && me.role !== "pending") { R.tab = "dash"; R.siteId = null; try { history.replaceState({ r: snap() }, ""); } catch (e) { } await run(refresh); } else render(); });
})();
