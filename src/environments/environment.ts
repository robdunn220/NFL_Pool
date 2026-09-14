/**
 * Firebase + app configuration.
 *
 * Fill in `firebase` with the web config from your Firebase project:
 *   Firebase console -> Project settings -> General -> "Your apps" -> SDK setup and configuration.
 *
 * `adminEmails` gates the admin UI on the client. The Firestore security rules use the
 * `config/app` document instead — see firestore.rules and the Admin page's "Initialize" action.
 */
export const environment = {
  production: false,
  adminEmails: ['robertdunn220@gmail.com'],
  /** Base URL for the callable HTTPS functions, used by the Admin page's manual sync buttons. */
  functionsBaseUrl: 'https://us-central1-TODO.cloudfunctions.net',
  firebase: {
    apiKey: 'TODO',
    authDomain: 'TODO.firebaseapp.com',
    projectId: 'TODO',
    storageBucket: 'TODO.firebasestorage.app',
    messagingSenderId: 'TODO',
    appId: 'TODO',
  },
};
