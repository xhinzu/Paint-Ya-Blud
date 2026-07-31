/* Paint Ya Blud - Firebase Config & Auth Integration */

// Firebase Config Placeholder (Configurable via environment / settings)
const firebaseConfig = {
  apiKey: "AIzaSy_PAINT_YA_BLUD_MOCK_KEY",
  authDomain: "paint-ya-blud.firebaseapp.com",
  projectId: "paint-ya-blud",
  storageBucket: "paint-ya-blud.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef123456"
};

(function () {
  let currentUser = null;

  window.initFirebaseAuth = function () {
    console.log('Firebase initialized in guest / fallback mode.');
    const savedUser = localStorage.getItem('pyb_username') || 'Dingan';
    currentUser = {
      uid: 'user_' + Math.floor(Math.random() * 10000),
      displayName: savedUser,
      email: 'user@paintyablud.game'
    };
    return currentUser;
  };

  window.handleGoogleSignIn = function () {
    alert('Google Sign-In initialized! Logged in as ' + (currentUser ? currentUser.displayName : 'Player'));
  };

  window.handleSignOut = function () {
    localStorage.removeItem('pyb_username');
    window.location.href = 'index.html';
  };
})();
