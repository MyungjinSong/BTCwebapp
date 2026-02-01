// firebase-messaging-sw.js
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js');

const firebaseConfig = {
    apiKey: "AIzaSyD4eSO-idxDepO8knAqLLzxX5ZfNCy9NAM",
    authDomain: "btcwebapp-551bd.firebaseapp.com",
    projectId: "btcwebapp-551bd",
    storageBucket: "btcwebapp-551bd.firebasestorage.app",
    messagingSenderId: "237989935469",
    appId: "1:237989935469:web:07fc002a5c2ab2f5858264",
    measurementId: "G-SFSSEHRPMN"
};

firebase.initializeApp(firebaseConfig);

const messaging = firebase.messaging();

// 백그라운드 메시지 수신 처리
messaging.onBackgroundMessage((payload) => {
    console.log('[firebase-messaging-sw.js] Received background message ', payload);
    // Data-only 메시지 처리
    const data = payload.data;
    const notificationTitle = data.title;
    const notificationOptions = {
        body: data.body,
        icon: data.icon || '/icon.png',
        data: { url: data.url }
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
});

// 알림 클릭 시 동작 처리
self.addEventListener('notificationclick', function (event) {
    console.log('[firebase-messaging-sw.js] Notification click received.');

    event.notification.close();

    // 데이터에서 URL 가져오기 (FCM data payload or fcm_options)
    // payload.data.url or event.notification.data.url
    let clickUrl = null;
    if (event.notification.data && event.notification.data.url) {
        clickUrl = event.notification.data.url;
    } else if (event.notification.data && event.notification.data.FCM_MSG && event.notification.data.FCM_MSG.notification && event.notification.data.FCM_MSG.notification.click_action) {
        clickUrl = event.notification.data.FCM_MSG.notification.click_action;
    } else {
        clickUrl = 'https://myungjinsong.github.io/btc_webapp/'; // 기본 URL
    }

    event.waitUntil(
        clients.matchAll({ type: 'window' }).then(windowClients => {
            // 이미 열린 탭이 있으면 포커스
            for (var i = 0; i < windowClients.length; i++) {
                var client = windowClients[i];
                if (client.url === clickUrl && 'focus' in client) {
                    return client.focus();
                }
            }
            // 없으면 새 창 열기
            if (clients.openWindow) {
                return clients.openWindow(clickUrl);
            }
        })
    );
});
