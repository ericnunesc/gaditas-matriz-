// firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
    apiKey: "AIzaSyCMTBh3za1b7JGQ9x9ECsG3VJNPF4hiHsI",
    authDomain: "gaditasmatriz.firebaseapp.com",
    projectId: "gaditasmatriz",
    storageBucket: "gaditasmatriz.firebasestorage.app",
    messagingSenderId: "166834416988",
    appId: "1:166834416988:web:2921c95c87c42019282599"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(function(payload) {
    console.log('[SW] Notificação em background:', payload);
    const { title, body, icon } = payload.notification;
    self.registration.showNotification(title, {
        body: body,
        icon: icon || '/gaditasstore.png',
        badge: '/gaditasstore.png',
        vibrate: [200, 100, 200],
        data: payload.data
    });
});

self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    event.waitUntil(
        clients.openWindow('https://gaditas-matriz.vercel.app')
    );
});
