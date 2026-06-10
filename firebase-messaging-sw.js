// firebase-messaging-sw.js — também serve como SW do PWA

const CACHE = 'gaditas-v8';
const PRECACHE = [
    './',
    './index.html',
    './app.html',
    './main.js',
    './style.css',
    './manifest.json',
    './gaditasstore.png',
    './filtros-academia.js',
    './gaditas-modal-financeiro.js',
    './gaditas-painel-adm.js',
    './gaditas-contrato.js',
];

self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', e => {
    // Só intercepta GET; deixa Firebase/Firestore passar direto
    if (e.request.method !== 'GET') return;
    const url = e.request.url;
    if (url.includes('firestore.googleapis.com') ||
        url.includes('firebase') ||
        url.includes('googleapis.com') ||
        url.includes('gstatic.com')) return;

    e.respondWith(
        caches.match(e.request).then(cached => {
            const network = fetch(e.request).then(res => {
                if (res && res.status === 200 && res.type === 'basic') {
                    const clone = res.clone();
                    caches.open(CACHE).then(c => c.put(e.request, clone));
                }
                return res;
            }).catch(() => cached);
            return cached || network;
        })
    );
});

// ── Firebase Messaging ──────────────────────────────────────
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
