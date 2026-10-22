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
  adminEmails: ['robertdunn220@gmail.com', 'donhamm@bellsouth.net'],
  /** Base URL for the callable HTTPS functions, used by the Admin page's manual sync buttons. */
  functionsBaseUrl: 'https://us-central1-nflpool-9c7b2.cloudfunctions.net',
  firebase: {
    apiKey: 'AIzaSyDP6pOVNydohjMNvUTOKnu8f6udeYp4cWA',
    authDomain: 'nflpool-9c7b2.firebaseapp.com',
    projectId: 'nflpool-9c7b2',
    storageBucket: 'nflpool-9c7b2.firebasestorage.app',
    messagingSenderId: '673874904331',
    appId: '1:673874904331:web:ffe891a3508cfeb7e30e0e',
  },
};
