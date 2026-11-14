// Data layer. Uses Firebase when firebase-config.js is filled in, otherwise a local demo store.
import { firebaseConfig } from "./firebase-config.js";
import { ACTS, ID_DOMAIN } from "./data.js";

export const DEMO = !firebaseConfig.apiKey;
export const DEL = { __del: true }; // pass as a value in a patch to delete that field
// A plain User ID becomes <id>@ID_DOMAIN. If a full email address is typed, it is used as it is.
const idToEmail = id => { const v = String(id).trim().toLowerCase(); return v.includes("@") ? v : `${v}@${ID_DOMAIN}`; };
const SDK = "https://www.gstatic.com/firebasejs/10.14.1/";

export async function initStore() { return DEMO ? localStore() : firebaseStore(); }

/* ---------------- Firebase ---------------- */
async function firebaseStore() {
  const [{ initializeApp, deleteApp }, A, F, S] = await Promise.all([
    import(SDK + "firebase-app.js"), import(SDK + "firebase-auth.js"),
    import(SDK + "firebase-firestore.js"), import(SDK + "firebase-storage.js")]);
  const app = initializeApp(firebaseConfig), auth = A.getAuth(app), db = F.getFirestore(app), st = S.getStorage(app);
  const fix = p => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v === DEL ? F.deleteField() : v]));
  const rows = snap => snap.docs.map(d => ({ id: d.id, ...d.data() }));
  let authCb = null;
  async function profile(u) {
    if (!u) return null;
    const d = await F.getDoc(F.doc(db, "users", u.uid));
    return d.exists() ? { uid: u.uid, ...d.data() } : { uid: u.uid, email: u.email, name: u.displayName || u.email, role: "pending" };
  }
  return {
    onAuth(cb) { authCb = cb; A.onAuthStateChanged(auth, async u => cb(await profile(u))); },
    login: (id, pw) => A.signInWithEmailAndPassword(auth, idToEmail(id), pw),
    // Admin creates a login. A second, temporary app instance is used so the admin stays signed in.
    async createUser(name, userId, pw, role) {
      const sec = initializeApp(firebaseConfig, "user-create-" + Date.now()), sa = A.initializeAuth(sec, { persistence: A.inMemoryPersistence });
      try {
        const c = await A.createUserWithEmailAndPassword(sa, idToEmail(userId), pw);
        await F.setDoc(F.doc(db, "users", c.user.uid), { name, userId: String(userId).trim().toLowerCase(), role, createdAt: new Date().toISOString() });
        return c.user.uid;
      } finally { await A.signOut(sa).catch(() => { }); await deleteApp(sec).catch(() => { }); }
    },
    async changePw(oldPw, newPw) { const u = auth.currentUser; await A.reauthenticateWithCredential(u, A.EmailAuthProvider.credential(u.email, oldPw)); await A.updatePassword(u, newPw); },
    logout: () => A.signOut(auth),
    listUsers: async () => rows(await F.getDocs(F.collection(db, "users"))).map(u => ({ uid: u.id, ...u })),
    setUser: (uid, patch) => F.updateDoc(F.doc(db, "users", uid), patch),
    async listSites(me) {
      const c = F.collection(db, "sites");
      return rows(await F.getDocs(me.role === "pmc" ? F.query(c, F.where("pmcUid", "==", me.uid)) : c));
    },
    createSite: async data => (await F.addDoc(F.collection(db, "sites"), data)).id,
    patchSite: (id, patch) => F.updateDoc(F.doc(db, "sites", id), fix(patch)),
    subList: async (sid, name, n = 200) => rows(await F.getDocs(F.query(F.collection(db, "sites", sid, name), F.orderBy("ts", "desc"), F.limit(n)))),
    subAdd: async (sid, name, doc) => (await F.addDoc(F.collection(db, "sites", sid, name), doc)).id,
    subPatch: (sid, name, id, patch) => F.updateDoc(F.doc(db, "sites", sid, name, id), fix(patch)),
    subDel: (sid, name, id) => F.deleteDoc(F.doc(db, "sites", sid, name, id)),
    topList: async (name, n = 200) => rows(await F.getDocs(F.query(F.collection(db, name), F.orderBy("ts", "desc"), F.limit(n)))),
    topAdd: async (name, doc) => (await F.addDoc(F.collection(db, name), doc)).id,
    topPatch: (name, id, patch) => F.updateDoc(F.doc(db, name, id), fix(patch)),
    async upload(path, blob) {
      const r = S.ref(st, path);
      await S.uploadBytes(r, blob, { contentType: blob.type });
      return { path, url: await S.getDownloadURL(r) };
    }
  };
}

/* ---------------- Local demo store ---------------- */
const KEY = "nro-tracker-demo-v3";
const iso = d => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
const ago = n => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };

function seed() {
  const users = {
    admin: { name: "Admin (you)", userId: "admin", role: "admin" },
    eo2: { name: "Second EO", userId: "eo.demo", role: "eo" },
    pmc1: { name: "PMC Consultant", userId: "pmc.demo", role: "pmc" },
    tm: { name: "Territory Manager", userId: "tm.demo", role: "tm" }
  };
  const sites = {}, subs = {};
  return { users, sites, subs, tops: { letters: [], std: [] }, session: null };
}

function localStore() {
  let db;
  try { db = JSON.parse(localStorage.getItem(KEY)); } catch (e) { db = null; }
  if (!db) db = seed();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* storage full or blocked: keep in memory */ } };
  const uid = () => "x" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const setPath = (obj, path, v) => { const ks = path.split("."); let o = obj; while (ks.length > 1) { const k = ks.shift(); o = o[k] = o[k] || {}; } if (v === DEL) delete o[ks[0]]; else o[ks[0]] = v; };
  const apply = (obj, patch) => Object.entries(patch).forEach(([k, v]) => setPath(obj, k, v));
  const sub = (sid, name) => { db.subs[sid] = db.subs[sid] || {}; return db.subs[sid][name] = db.subs[sid][name] || []; };
  const byTs = a => [...a].sort((x, y) => (y.ts || "").localeCompare(x.ts || ""));
  const clone = x => JSON.parse(JSON.stringify(x));
  let cb = () => {};
  const me = () => db.session ? { uid: db.session, ...db.users[db.session] } : null;
  return {
    onAuth(f) { cb = f; f(me()); },
    async login(id) { const u = Object.keys(db.users).find(k => k === id || db.users[k].userId === String(id).trim().toLowerCase()); if (!u || db.users[u].role === "removed") throw new Error("Wrong User ID or password"); db.session = u; save(); cb(me()); },
    async createUser(name, userId, pw, role) { userId = String(userId).trim().toLowerCase(); if (Object.values(db.users).some(u => u.userId === userId && u.role !== "removed")) { const e = new Error("taken"); e.code = "auth/email-already-in-use"; throw e; } const id = uid(); db.users[id] = { name, userId, role }; save(); return id; },
    async changePw() { },
    async logout() { db.session = null; save(); cb(null); },
    async listUsers() { return Object.entries(db.users).map(([k, u]) => ({ uid: k, ...u })); },
    async setUser(id, patch) { Object.assign(db.users[id], patch); save(); },
    async listSites(m) { return clone(Object.entries(db.sites).map(([id, s]) => ({ id, ...s })).filter(s => m.role !== "pmc" || s.pmcUid === m.uid)); },
    async createSite(data) { const id = uid(); db.sites[id] = clone(data); save(); return id; },
    async patchSite(id, patch) { apply(db.sites[id], clone(patch)); Object.entries(patch).forEach(([k, v]) => { if (v === DEL) setPath(db.sites[id], k, DEL); }); save(); },
    async subList(sid, name, n = 200) { return clone(byTs(sub(sid, name)).slice(0, n)); },
    async subAdd(sid, name, doc) { const id = uid(); sub(sid, name).push({ id, ...clone(doc) }); save(); return id; },
    async subPatch(sid, name, id, patch) { apply(sub(sid, name).find(x => x.id === id), patch); save(); },
    async subDel(sid, name, id) { db.subs[sid][name] = sub(sid, name).filter(x => x.id !== id); save(); },
    async topList(name, n = 200) { return clone(byTs(db.tops[name] || []).slice(0, n)); },
    async topAdd(name, doc) { const id = uid(); (db.tops[name] = db.tops[name] || []).push({ id, ...clone(doc) }); save(); return id; },
    async topPatch(name, id, patch) { apply(db.tops[name].find(x => x.id === id), patch); save(); },
    async upload(path, blob) {
      if (blob.type.startsWith("image/")) return { path, url: await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob); }) };
      return { path, url: URL.createObjectURL(blob) };
    },
    reset() { localStorage.removeItem(KEY); location.reload(); }
  };
}
export const blankActs = () => Object.fromEntries(ACTS.map((a, k) => [k + 1, { s: "Y", p: 0 }]));
