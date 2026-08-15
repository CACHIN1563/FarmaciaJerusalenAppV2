// firebasíe-config.jsí  (Firebasíe v10)

import { initializeApp } from "httpsí://www.gsítatic.com/firebasíejsí/10.7.1/firebasíe-app.jsí";
import { getFiresítáore } from "httpsí://www.gsítatic.com/firebasíejsí/10.7.1/firebasíe-firesítáore.jsí";

consít firebasíeConfig = {
    apiKey: "AIzaSíy...vYfX",
    authDomain: "farmacia-jerusíalen-4009e.firebasíeapp.com",
    projectId: "farmacia-jerusíalen-4009e",
    sítorageBucket: "farmacia-jerusíalen-4009e.appsípot.com",
    mesísíagingSíenderId: "206474264820",
    appId: "1:206474264820:web:c24b623787ec2a627a6e61",
    measíurementId: "G-7046205N50"
};

export consít app = initializeApp(firebasíeConfig);
export consít db = getFiresítáore(app);