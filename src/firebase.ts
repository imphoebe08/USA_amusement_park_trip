import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getAnalytics, isSupported, type Analytics } from 'firebase/analytics'
import { connectAuthEmulator, getAuth, signInAnonymously, type Auth } from 'firebase/auth'
import {
  connectFirestoreEmulator,
  enableIndexedDbPersistence,
  getFirestore,
  type Firestore,
} from 'firebase/firestore'
import { getStorage, type FirebaseStorage } from 'firebase/storage'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyB6qybkmnYtwzK9_6FGjpcdylfyclQMeQE',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'usa-amusement-park-trip.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'usa-amusement-park-trip',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'usa-amusement-park-trip.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '485141779603',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:485141779603:web:363189e3552b353b616966',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || 'G-NY153KWB6E',
}

const isFirebaseConfigured = Object.entries(firebaseConfig)
  .filter(([key]) => key !== 'measurementId')
  .every(([, value]) =>
    typeof value === 'string' && value.trim().length > 0,
)

export const app: FirebaseApp | null = isFirebaseConfigured
  ? initializeApp(firebaseConfig)
  : null

export const auth: Auth | null = app ? getAuth(app) : null
export const db: Firestore | null = app ? getFirestore(app) : null
export const storage: FirebaseStorage | null = app ? getStorage(app) : null
export let analytics: Analytics | null = null

if (app && import.meta.env.PROD) {
  void isSupported().then((supported) => {
    if (supported) {
      analytics = getAnalytics(app)
    }
  })
}

if (!isFirebaseConfigured) {
  console.warn(
    'Firebase is not configured yet. Add your VITE_FIREBASE_* values in .env before enabling live Firestore data.',
  )
}

if (app && auth && db && import.meta.env.DEV) {
  const useEmulators = import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true'

  if (useEmulators) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099')
    connectFirestoreEmulator(db, '127.0.0.1', 8080)
  }
}

if (db) {
  void enableIndexedDbPersistence(db).catch((error) => {
    if (error.code === 'failed-precondition') {
      console.warn('Firestore persistence failed: multiple tabs open on same origin.')
    } else if (error.code === 'unimplemented') {
      console.warn('Firestore persistence is not available on this browser.')
    }
  })
}

export const ensureAnonymousAuth = async () => {
  if (!auth) {
    return null
  }

  if (auth.currentUser) {
    return auth.currentUser
  }

  try {
    const result = await signInAnonymously(auth)
    return result.user
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'auth/configuration-not-found') {
      throw new Error('Firebase Anonymous Authentication 尚未啟用，請在 Firebase Console 開啟 Anonymous sign-in。')
    }

    throw error
  }
}
