// firebase-config.js  (Firebase v10)

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSy...vYfX",
    authDomain: "farmacia-jerusalen-4009e.firebaseapp.com",
    projectId: "farmacia-jerusalen-4009e",
    storageBucket: "farmacia-jerusalen-4009e.appspot.com",
    messagingSenderId: "206474264820",
    appId: "1:206474264820:web:c24b623787ec2a627a6e61",
    measurementId: "G-7046205N50"
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);


