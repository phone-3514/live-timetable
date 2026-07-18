import { initializeApp } from "firebase/app";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentSingleTabManager,
} from "firebase/firestore";

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
};

// Collaboration is opt-in per browser session (see useCollabRoom) — a
// missing config just means nobody on this build has set up a Firebase
// project yet, which is the expected state until the user completes the
// setup steps in the README. Failing loudly here would break the whole
// (otherwise fully offline-capable) app for every visitor who never
// touches real-time collaboration.
export const isFirebaseConfigured = Boolean(firebaseConfig.projectId);

const firebaseApp = isFirebaseConfigured ? initializeApp(firebaseConfig) : null;

// persistentLocalCache gives the SDK an IndexedDB-backed offline cache —
// this is what makes the optimistic UI updates in useFirestoreDocSync
// "free": a local write lands in this cache (and reaches onSnapshot
// listeners) immediately, before the round trip to Firestore's servers
// completes. persistentSingleTabManager skips the multi-tab leader
// election overhead this app doesn't need — each collaborator is one
// person in one tab, not one person juggling several tabs on the same
// room.
export const db = firebaseApp
  ? initializeFirestore(firebaseApp, {
      localCache: persistentLocalCache({ tabManager: persistentSingleTabManager({}) }),
    })
  : null;
