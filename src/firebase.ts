import { initializeApp } from "firebase/app";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
} from "firebase/firestore";
import { getDatabase } from "firebase/database";

// Firebase's web "config" (apiKey included) is not a secret — it just
// identifies which project a client talks to. Access control lives
// entirely in firestore.rules, not in hiding these values, which is why
// it's fine for them to be baked into a public static build the way
// every VITE_-prefixed env var is (see .env.example and the README setup
// section this ships with). This app has no server to keep real secrets
// on, by design — see feedback_no-backend-static-spa in project memory.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  // Only needed for Realtime Database (live cursors/presence — see
  // useLivePresence). Firestore (persistent bands/timetable data) doesn't
  // use this field at all.
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
};

// Collaboration is opt-in per browser session (see useCollabRoom) — a
// missing config just means nobody on this build has set up a Firebase
// project yet, which is the expected state until the user completes the
// setup steps in the README. Failing loudly here would break the whole
// (otherwise fully offline-capable) app for every visitor who never
// touches real-time collaboration.
export const isFirebaseConfigured = Boolean(firebaseConfig.projectId);
// Separate from isFirebaseConfigured: Firestore (persistent data) and
// RTDB (live cursors) are configured independently, since databaseURL is
// its own env var (see .env.example) that can end up unset even when
// projectId etc. are set — e.g. a GitHub Actions deploy where the
// VITE_FIREBASE_DATABASE_URL secret hasn't been added yet. getDatabase()
// throws a *fatal, uncatchable-by-try/catch* error on a missing/malformed
// databaseURL (confirmed live — see project memory), which crashed the
// entire app with no Error Boundary to stop it. Never call getDatabase()
// without checking this first.
const isRtdbConfigured = Boolean(firebaseConfig.databaseURL);

console.log("[firebase] 1. Loading config — Firestore configured:", isFirebaseConfigured, "RTDB configured:", isRtdbConfigured);

const firebaseApp = isFirebaseConfigured ? initializeApp(firebaseConfig) : null;

// persistentLocalCache gives the SDK an IndexedDB-backed offline cache —
// this is what makes the optimistic UI updates in useFirestoreDocSync
// "free": a local write lands in this cache (and reaches onSnapshot
// listeners) immediately, before the round trip to Firestore's servers
// completes. persistentSingleTabManager skips the multi-tab leader
// election overhead this app doesn't need — each collaborator is one
// person in one tab, not one person juggling several tabs on the same
// room.
// ignoreUndefinedProperties: without this, setDoc/updateDoc THROWS
// ("Unsupported field value: undefined") the instant any nested object in
// the payload has an explicit `undefined` field — and Band does, routinely:
// parseBands.ts's raw-text-paste parser always includes `parseWarning` and
// `durationMinutes` as keys even when nothing was detected (both typed as
// `T | undefined` and returned via shorthand, so an unset one is `undefined`
// as a *value*, not an absent key). Every band parsed that way broke the
// ENTIRE room sync — not just that band, not just its part/grade — because
// useCollabRoom writes the whole bands/days array as one document, so one
// undefined field anywhere in it failed the whole write, silently (see the
// error-logging note on useFirestoreDocSync's catch). Confirmed against the
// real project: identical payload succeeds with this flag, fails without it.
console.log("[firebase] 2. Initializing Firestore…");
export const db = firebaseApp
  ? initializeFirestore(firebaseApp, {
      localCache: persistentLocalCache({ tabManager: persistentSingleTabManager({}) }),
      ignoreUndefinedProperties: true,
    })
  : null;
console.log("[firebase] 2. Firestore ready:", db !== null);

// Realtime Database, used only for ephemeral collaborative state (live
// cursors, drag-in-progress locks — see useLivePresence) that's cheap to
// lose and never needs Firestore's offline persistence or structured
// queries. Firestore stays the source of truth for actual timetable data;
// this is deliberately a second, narrower-purpose Firebase product, not a
// replacement — see the Firestore-vs-RTDB comparison in project memory
// for why persistent data went to Firestore in the first place.
console.log("[firebase] 3. Initializing Realtime Database…");
export const rtdb = firebaseApp && isRtdbConfigured ? getDatabase(firebaseApp) : null;
console.log("[firebase] 3. RTDB ready:", rtdb !== null);
