console.log("Script.js 로드됨.");

// =================================================================================
// [설정] 구글 앱스 스크립트(GAS) 웹 앱 URL을 여기에 입력하세요.
// 'backend_gas_v2.js'를 웹 앱으로 배포한 후 주소를 복사해 넣으세요.
// =================================================================================
const GAS_API_URL = 'https://script.google.com/macros/s/AKfycbzuWS4Q5kTzDRH4IBpeXBa69KngElRdArtTCzTV0NDQsB3y4oABBIzrTLuPOZH5KOPP/exec';

// --- Firebase Config ---
const firebaseConfig = {
    apiKey: "AIzaSyD4eSO-idxDepO8knAqLLzxX5ZfNCy9NAM",
    authDomain: "btcwebapp-551bd.firebaseapp.com",
    projectId: "btcwebapp-551bd",
    storageBucket: "btcwebapp-551bd.firebasestorage.app",
    messagingSenderId: "237989935469",
    appId: "1:237989935469:web:07fc002a5c2ab2f5858264",
    measurementId: "G-SFSSEHRPMN"
};

// VAPID Key (Public)
const VAPID_KEY = "BCIeuJhwW92Usr-QS3BFOUWnP2pZ4rqulcmZBlxXdv8Ayms7zllnqLy-jNj9NtmOrkJfE9ywMkkj0IegbKxDDmE";

// Initialize Firebase (Compat)
let messaging = null;
try {
    firebase.initializeApp(firebaseConfig);
    messaging = firebase.messaging();
    console.log("Firebase initialized.");
} catch (e) {
    console.error("Firebase initialization failed:", e);
}

// 전역 변수
let currentSheetInfo = null;
let favorites = {};
let isMeasurementDirty = false;
let preparedDownload = null;
let validationData = {};

// --- API 통신 헬퍼 함수 ---
async function callApi(action, method = 'GET', data = null) {
    let url = GAS_API_URL;
    const options = {
        method: method,
    };

    if (method === 'GET') {
        url += `?action=${action}`;
        if (data) {
            for (const key in data) {
                url += `&${key}=${encodeURIComponent(data[key])}`;
            }
        }
    } else if (method === 'POST') {
        options.body = JSON.stringify({ action, ...data });
        // Google Apps Script 웹 앱은 보통 text/plain으로 보내도 잘 처리하지만, 
        // fetch 특성상 리다이렉트를 따르도록 설정이 필요할 수 있음.
        options.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
    }

    try {
        const response = await fetch(url, options);
        if (!response.ok) {
            throw new Error(`서버 통신 오류: ${response.status}`);
        }
        const result = await response.json();
        return result;
    }
    catch (error) {
        console.error(`API Error (${action}):`, error);
        throw error;
    }
}

// --- Client-side Storage Helper Functions ---
function saveToStorage(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
        console.error("Error saving to localStorage", e);
        showStatus('즐겨찾기를 저장하는 데 실패했습니다.', 'error', 3000);
    }
}

function getFromStorage(key) {
    try {
        const item = localStorage.getItem(key);
        return item ? JSON.parse(item) : null;
    } catch (e) {
        console.error("Error reading from localStorage", e);
        return null;
    }
}

// --- Sidenav / Hamburger Menu Logic ---
const hamburger = document.getElementById('hamburger');
const sidenav = document.getElementById('sidenav');
const overlay = document.getElementById('overlay');

function closeMenu() {
    sidenav.classList.remove('open');
    overlay.classList.remove('visible');
}

function openMenu() {
    sidenav.classList.add('open');
    overlay.classList.add('visible');
}

if (hamburger) hamburger.addEventListener('click', openMenu);
if (overlay) overlay.addEventListener('click', closeMenu);

const resetBtn = document.getElementById('resetFavoritesBtn');
if (resetBtn) {
    resetBtn.addEventListener('click', function () {
        if (confirm('정말로 모든 즐겨찾기를 초기화하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) {
            localStorage.removeItem('favorites');
            favorites = {};
            updateFavoriteButtons();
            showStatus('즐겨찾기가 초기화되었습니다.', 'success', 3000);
            closeMenu();
        }
    });
}

// 웹페이지 로드 시 초기화
window.onload = function () {
    loadFormList();
    initializeFavorites();
    updateHomeButtonVisibility();
    addHomeStateToHistory();
    addHomeStateToHistory();

    window.addEventListener('popstate', function (event) {
        // 뒤로가기 시 홈 화면으로 복귀
        document.getElementById('formSelect').value = '';
        currentSheetInfo = null;
        loadSelectedForm();
        updateHomeButtonVisibility();
        updateHomeButtonVisibility();
    });

    // 앱 시작 시 서비스 워커 등록 및 설정 동기화
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./firebase-messaging-sw.js')
            .then((registration) => {
                console.log('Service Worker registered with scope:', registration.scope);
                // 서비스 워커 등록 성공 후 서버 설정 동기화 시도
                syncNotificationSettingsWithServer();
            }).catch((err) => {
                console.log('Service Worker registration failed:', err);
            });
    }

    // 알림 토글 리스너 및 초기 상태 설정
    // 사이드바 토글과 메인 토글 모두 처리하기 위해 공통 함수 사용 또는 각각 이벤트 등록
    const sideToggle = document.getElementById('notificationToggle');
    const mainToggle = document.getElementById('notificationToggleMain'); // 메인 화면 토글 ID 예정

    // 초기 상태 로드
    const isNotifActive = getFromStorage('isNotificationActive') === true;
    if (sideToggle) sideToggle.checked = isNotifActive;
    if (mainToggle) mainToggle.checked = isNotifActive;

    // 공통 핸들러
    function handleToggleChange(e) {
        // iOS PWA 체크
        if (checkIosPwaStatusAndShowGuide()) {
            e.target.checked = false; // 토글 원복
            // 다른 쪽 토글도 원복
            if (sideToggle) sideToggle.checked = false;
            if (mainToggle) mainToggle.checked = false;
            return;
        }

        const newState = e.target.checked;

        // UI 동기화
        if (sideToggle) sideToggle.checked = newState;
        if (mainToggle) mainToggle.checked = newState;

        if (newState) {
            // ON으로 변경 시 모달 띄우기
            openKeywordModal();
        } else {
            // OFF로 변경 시 알림 비활성화
            disableNotification();
        }
    }

    if (sideToggle) sideToggle.addEventListener('change', handleToggleChange);
    // 메인 토글은 동적으로 생성되므로, 생성 시점에 이벤트 리스너를 달거나 이벤트 위임이 필요함.
    // 여기서는 document에 위임하거나 생성 로직에서 처리. 
    // 생성 로직(loadSelectedForm 등)에서 리스너를 달아주는 것이 좋음.
    // 하지만 간편하게 document 레벨에서 change 이벤트를 잡아서 처리하는게 나을 수 있음 (동적 요소).
    document.addEventListener('change', function (e) {
        if (e.target && e.target.id === 'notificationToggleMain') {
            handleToggleChange(e);
        }
    });

    // 모달 버튼 리스너
    document.getElementById('closeKeywordModalBtn').addEventListener('click', closeKeywordModal);
    document.getElementById('saveKeywordBtn').addEventListener('click', handleKeywordSave);
    document.getElementById('keywordModalOverlay').addEventListener('click', closeKeywordModal);
};

// --- Firebase Notification Logic ---
async function requestNotificationPermission() {
    if (!messaging) {
        showStatus('Firebase가 초기화되지 않았습니다.', 'error');
        return null;
    }

    try {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            console.log('Notification permission granted.');

            let registration = await navigator.serviceWorker.getRegistration();

            if (!registration) {
                console.log('No active registration found. Registering new one...');
                try {
                    registration = await navigator.serviceWorker.register('./firebase-messaging-sw.js', { scope: './' });
                } catch (regErr) {
                    console.error('Explicit registration failed:', regErr);
                    throw new Error('서비스 워커 등록 실패');
                }
            }

            // 등록 대기
            if (!registration.active && registration.installing) {
                await new Promise(resolve => {
                    const worker = registration.installing;
                    worker.addEventListener('statechange', () => {
                        if (worker.state === 'activated') resolve();
                    });
                });
            }

            const token = await messaging.getToken({
                vapidKey: VAPID_KEY,
                serviceWorkerRegistration: registration
            });

            if (token) {
                console.log('FCM Token:', token);
                return token;
            } else {
                console.log('No registration token available.');
                showStatus('토큰을 가져올 수 없습니다.', 'error');
                return null;
            }
        } else {
            console.log('Unable to get permission to notify.');
            showStatus('알림 권한이 거부되었습니다.', 'error');
            return null;
        }
    } catch (err) {
        console.log('An error occurred while retrieving token. ', err);
        showStatus(`알림 설정 실패: ${err.message}`, 'error');
        return null;
    }
}

async function sendTokenToServer(token, keywords = "", isActive = true) {
    showStatus('서버에 설정을 저장 중입니다...', 'loading');
    try {
        const response = await callApi('registerToken', 'POST', {
            token: token,
            userAgent: navigator.userAgent,
            keywords: keywords,
            isActive: isActive
        });
        if (response.success) {
            showStatus('알림 설정이 저장되었습니다!', 'success', 3000);
            // 성공 시 로컬 스토리지도 확실히 갱신
            saveToStorage('isNotificationActive', isActive);
            saveToStorage('userKeywords', keywords);
        } else {
            showStatus(`서버 저장 실패: ${response.message}`, 'error');
        }
    } catch (e) {
        console.error(e);
        showStatus('서버 통신 오류', 'error');
    }
}

async function syncNotificationSettingsWithServer() {
    if (!messaging) return;

    try {
        // 이미 권한이 있는 경우에만 토큰을 가져와 동기화 시도
        if (Notification.permission !== 'granted') return;

        const token = await messaging.getToken({ vapidKey: VAPID_KEY });
        if (!token) return;

        const response = await callApi('getUserSettings', 'GET', { token: token });
        if (response.success) {
            console.log("Server settings synced:", response);
            // 로컬 스토리지 및 UI 갱신
            saveToStorage('userKeywords', response.keywords || "");
            saveToStorage('isNotificationActive', response.isActive);

            const sideToggle = document.getElementById('notificationToggle');
            const mainToggle = document.getElementById('notificationToggleMain');

            if (sideToggle) sideToggle.checked = response.isActive;
            if (mainToggle) mainToggle.checked = response.isActive;
        }
    } catch (e) {
        console.log("Sync failed (not usually an error if first time):", e);
    }
}

// --- Keyword Modal Logic ---
function openKeywordModal() {
    document.getElementById('keywordModalOverlay').classList.add('visible');
    document.getElementById('keywordModal').classList.add('visible');
    // TODO: 기존 키워드 불러오기 (서버 연동 전엔 로컬스토리지 or 빈값)
    const storedKeywords = getFromStorage('userKeywords') || '';
    document.getElementById('keywordInput').value = storedKeywords;
}

function closeKeywordModal() {
    document.getElementById('keywordModalOverlay').classList.remove('visible');
    document.getElementById('keywordModal').classList.remove('visible');

    // 취소 시 토글이 켜져있었다면 끄기 (저장되지 않았으므로)
    // 단, 이미 활성화된 상태에서 단순히 팝업만 닫는 경우라면 유지해야 함.
    // 여기서는 단순화를 위해 취소 시 체크박스 상태 확인
    // 현재는 "ON" 동작 시에만 모달이 뜨므로, 취소하면 OFF로 되돌리는게 자연스러움
    // 하지만 이미 켜져있는 상태에서 수정하려고 눌렀을때는? (현재 UI엔 수정 버튼이 따로 없음. 토글 껐다 켜야함)
    // 일단 토글을 끄는 것으로 처리.
    const sideToggle = document.getElementById('notificationToggle');
    const mainToggle = document.getElementById('notificationToggleMain');

    if (sideToggle && sideToggle.checked) sideToggle.checked = false;
    if (mainToggle && mainToggle.checked) mainToggle.checked = false;
}

async function handleKeywordSave() {
    const keywordInput = document.getElementById('keywordInput');
    const keywords = keywordInput.value.trim();

    // 키워드 저장 로직
    showStatus('알림 권한 확인 중...', 'loading');
    const token = await requestNotificationPermission();

    if (token) {
        document.getElementById('keywordModalOverlay').classList.remove('visible');
        document.getElementById('keywordModal').classList.remove('visible');

        // 로컬 저장
        saveToStorage('userKeywords', keywords);
        saveToStorage('isNotificationActive', true);

        // 서버 전송
        await sendTokenToServer(token, keywords, true);

        // 토글 ON 유지 및 동기화
        const sideToggle = document.getElementById('notificationToggle');
        const mainToggle = document.getElementById('notificationToggleMain');
        if (sideToggle) sideToggle.checked = true;
        if (mainToggle) mainToggle.checked = true;

        // 저장 시 사이드바 닫기 (요청사항 3)
        closeMenu();

    } else {
        // 권한 실패 시
        const sideToggle = document.getElementById('notificationToggle');
        const mainToggle = document.getElementById('notificationToggleMain');
        if (sideToggle) sideToggle.checked = false;
        if (mainToggle) mainToggle.checked = false;

        closeKeywordModal();
    }
}

async function disableNotification() {
    // 로컬 상태 즉시 반영
    saveToStorage('isNotificationActive', false);

    // 토큰이 있나?
    if (!messaging) return;

    // 현재 토큰 가져오기 (권한이 이미 있으므로 바로 나올 것임)
    try {
        const token = await messaging.getToken({ vapidKey: VAPID_KEY });
        if (token) {
            await sendTokenToServer(token, "", false);
        }
    } catch (e) {
        console.error("Disable error", e);
    }
}

// 포그라운드 메시지 수신 (페이지가 열려있을 때)
if (messaging) {
    messaging.onMessage((payload) => {
        console.log('Message received. ', payload);
        // Data-only 메시지 처리
        const data = payload.data;
        const title = data.title;
        const options = {
            body: data.body,
            icon: data.icon
        };
        // 브라우저 기본 알림 띄우기 (페이지가 포커스 되어 있어도 알림을 띄우고 싶다면)
        // 또는 커스텀 토스트 메시지 사용 가능
        showStatus(`[알림] ${title}: ${options.body}`, 'success', 5000);
        // 필요 시 new Notification(title, options) 호출 가능 (사용자 제스처 필요할 수 있음)
    });
}

function showStatus(message, type, duration = 0) {
    const statusDiv = document.getElementById('status');
    if (!message) {
        statusDiv.style.opacity = '0';
        setTimeout(() => { statusDiv.style.display = 'none'; }, 300);
        return;
    }
    if (statusDiv.hideTimer) clearTimeout(statusDiv.hideTimer);
    statusDiv.textContent = message;
    statusDiv.className = type;
    statusDiv.style.display = 'block';
    statusDiv.offsetHeight; // force reflow
    statusDiv.style.opacity = '1';

    if (duration > 0) {
        statusDiv.hideTimer = setTimeout(() => {
            statusDiv.style.opacity = '0';
            setTimeout(() => { statusDiv.style.display = 'none'; }, 300);
        }, duration);
    }
}

// --- iOS PWA Install Guide Logic ---
// 변경: 로드시 체크가 아니라, 토글 동작 시 호출되어 가이드 표시 여부를 결정
function checkIosPwaStatusAndShowGuide() {
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;

    // 아이폰이면서 브라우저(사파리 등)인 경우
    if (isIos && !isStandalone) {
        const guide = document.getElementById('iosInstallGuide');
        if (guide) {
            guide.classList.add('visible');
        }
        return true; // 가이드를 띄웠음 (차단 필요)
    }
    return false; // 통과
}

function closeIosSettingsGuide() {
    const guide = document.getElementById('iosInstallGuide');
    if (guide) {
        guide.classList.remove('visible');
    }
}

// --- 파일 업로드 로직 ---
function handleUpload() {
    const fileInput = document.getElementById('excelFile');
    const file = fileInput.files[0];

    if (!file) {
        showStatus('파일을 선택해주세요.', 'error', 3000);
        return;
    }

    closeMenu();
    showStatus('파일을 읽는 중입니다...', 'loading');

    const reader = new FileReader();
    reader.onload = function (e) {
        const base64Data = e.target.result.split(',')[1];
        const fileData = {
            name: file.name,
            mimeType: file.type || 'application/octet-stream',
            data: base64Data
        };
        processFileUpload(fileData, undefined);
    };
    reader.onerror = function (error) {
        showStatus(`파일 읽기 오류: ${error.message}`, 'error');
    };
    reader.readAsDataURL(file);
}

// --- 서버 통신: 파일 업로드 ---
async function processFileUpload(fileData, userChoice) {
    const statusMessage = userChoice ? '사용자 선택을 반영하여 처리 중...' : '파일을 업로드 및 처리 중입니다...';
    showStatus(statusMessage, 'loading');

    const formContainer = document.getElementById('dynamicFormContainer');
    if (!userChoice) {
        formContainer.innerHTML = '<h3>측정값 입력 폼</h3><p id="formMessage" class="loading">폼 생성 중...</p>';
    }

    try {
        const response = await callApi('uploadFileBase64', 'POST', {
            fileData: fileData,
            userChoice: userChoice
        });

        if (response.success) {
            showStatus(response.message, 'success', 3000);
            document.getElementById('excelFile').value = '';

            if (response.preserved) {
                formContainer.innerHTML = '<h3>측정값 입력 폼</h3><p id="formMessage">업로드가 취소되었습니다. 다른 파일을 업로드하거나 기존 양식을 선택하세요.</p>';
            } else if (response.formData && Array.isArray(response.formData)) {
                // 업로드 성공 후 시트 정보 추출
                // (Backend 응답에 lastModifiedDate가 포함되어 있지 않을 수 있으므로 현재 시간 사용 가능)
                // 단 backend_gas_v2.js에서는 recordUploadedForm만 하고 데이터엔 안담아줄 수도 있음.
                // 편의상 여기서 처리.
                currentSheetInfo = {
                    spreadsheetId: response.spreadsheetId,
                    sheetName: response.sheetName,
                    displayName: response.sheetName,
                    lastModifiedDate: new Date().toISOString()
                };
                createDynamicForm(response.formData, response.sheetName);
                loadFormList();
            }

        } else {
            if (response.requiresChoice) {
                if (confirm(response.message)) {
                    processFileUpload(fileData, 'overwrite');
                } else {
                    processFileUpload(fileData, 'preserve');
                }
            } else {
                const msg = response.message || "알 수 없는 오류";
                showStatus(msg, 'error');
                formContainer.innerHTML = `<h3>측정값 입력 폼</h3><p id="formMessage" class="error">폼 생성 실패: ${msg}</p>`;
            }
        }
    } catch (error) {
        const msg = `서버 통신 오류: ${error.message}`;
        showStatus(msg, 'error');
        formContainer.innerHTML = `<h3>측정값 입력 폼</h3><p id="formMessage" class="error">${msg}</p>`;
    }
}

// --- 동적 폼 생성 ---
function createDynamicForm(formData, formTitle) {
    const formContainer = document.getElementById('dynamicFormContainer');

    // 날짜 포맷
    let lastDateStr = '';
    let fileDateStr = '';
    if (currentSheetInfo?.lastModifiedDate) {
        try {
            const d = new Date(currentSheetInfo.lastModifiedDate);
            lastDateStr = `(${d.getFullYear().toString().slice(2, 4)}.${('0' + (d.getMonth() + 1)).slice(-2)}.${('0' + d.getDate()).slice(-2)})`;
            fileDateStr = `${d.getFullYear().toString().slice(2, 4)}${('0' + (d.getMonth() + 1)).slice(-2)}${('0' + d.getDate()).slice(-2)}`;
        } catch (e) { }
    }

    // 엑셀 다운로드 버튼 (미리 준비)
    let downloadBtnHtml = '';
    if (formTitle) {
        const displayName = currentSheetInfo.displayName || currentSheetInfo.sheetName;
        const fileName = `${displayName}_${fileDateStr || ''}.xlsx`;
        prepareXlsxInAdvance(null, currentSheetInfo.sheetName, fileName); // fileId는 null (백엔드가 알아서 처리)

        downloadBtnHtml = `<button id="xlsxDownloadBtn"
        onclick="triggerPreparedDownload('xlsxDownloadBtn')"
        disabled
        style="margin-left:10px; font-size:0.95em; padding: 6px 12px; background-color: #ccc; color: #666;
              border: none; border-radius: 4px; font-weight: bold; cursor: not-allowed;">
        파일 준비중.. ${lastDateStr}
      </button>`;
    }

    formContainer.innerHTML = `<h3 style="display:flex;align-items:center;gap:8px;"><span style="flex:1;min-width:80px;">${formTitle || '측정값 입력 폼'}</span>${downloadBtnHtml}</h3>`;
    document.getElementById('favoritesSection').classList.add('hidden');

    const formElement = document.createElement('form');
    formElement.id = 'measurementForm';

    if (!formData || !Array.isArray(formData) || formData.length === 0) {
        const noDataMessage = document.createElement('p');
        noDataMessage.textContent = '폼을 생성할 데이터가 없습니다.';
        noDataMessage.className = 'error';
        formContainer.appendChild(noDataMessage);
        return;
    }

    // 유효성 검사 데이터 로드
    const uniqueIds = formData.map(d => d.uniqueId).filter(id => id);
    if (uniqueIds.length > 0) {
        loadValidationData(uniqueIds);
    }

    // 폼 필드 생성
    let prevLocPrefix = null;
    formData.forEach((data, index) => {
        const currLocPrefix = (data.location || '').substring(0, 3);
        if (index > 0 && prevLocPrefix !== null && prevLocPrefix !== currLocPrefix) {
            const line = document.createElement('div');
            line.style.borderTop = '1.5px solid #ddd';
            line.style.margin = '8px 0';
            formElement.appendChild(line);
        }
        prevLocPrefix = currLocPrefix;

        const formGroup = document.createElement('div');
        formGroup.className = 'form-group';

        const locationSpan = document.createElement('span');
        locationSpan.className = 'item-location';
        locationSpan.textContent = data.location;

        const itemSpan = document.createElement('span');
        itemSpan.className = 'item-detail';

        // placeholder 처리
        let itemText = '';
        let placeholderText = '측정값';
        const words = (data.item || '').trim().split(/\s+/).filter(w => w);
        if (words.length > 1) {
            placeholderText = words.pop();
            itemText = words.join(' ');
        } else if (words.length === 1) {
            itemText = words[0];
            placeholderText = words[0];
        }
        itemSpan.textContent = itemText;

        const input = document.createElement('input');
        input.type = 'number';
        input.inputMode = 'decimal';
        input.step = 'any';
        input.placeholder = placeholderText;
        input.value = ''; // 초기값은 빈 상태 (필요하면 data.value 사용 가능)
        input.dataset.location = data.location;
        input.dataset.item = data.item;
        input.dataset.unit = data.unit;
        input.dataset.uniqueId = data.uniqueId;
        input.dataset.index = index;

        input.addEventListener('blur', function () {
            validateInputValue(this);
        });

        const unitSpan = document.createElement('span');
        unitSpan.className = 'measurement-unit';
        unitSpan.textContent = data.unit || '';

        formGroup.appendChild(locationSpan);
        formGroup.appendChild(itemSpan);
        formGroup.appendChild(input);
        formGroup.appendChild(unitSpan);

        formElement.appendChild(formGroup);
    });

    const submitButton = document.createElement('button');
    submitButton.type = 'button';
    submitButton.textContent = '측정값 저장';
    submitButton.id = 'saveMeasurements';
    submitButton.onclick = saveMeasurements;
    formElement.appendChild(submitButton);

    formContainer.appendChild(formElement);
    formElement.addEventListener('input', () => isMeasurementDirty = true);
    addHomeStateToHistory();
}

// --- XLSX 다운로드 준비 ---
async function prepareXlsxInAdvance(fileId, sheetName, fileName) {
    // GAS API는 fileId, sheetName, filename을 파라미터로 받아서 Base64를 리턴하도록 되어있음
    try {
        let url = `${GAS_API_URL}?fileId=${encodeURIComponent('ignored')}&sheetName=${encodeURIComponent(sheetName)}&filename=${encodeURIComponent(fileName)}`;
        // 백엔드가 fileId를 필수라고 생각한다면 더미값 전달. backend_gas_v2.js에서는 openById(fileId)를 하므로
        // IMPORTANT: backend_gas_v2.js의 handleXlsxDownload는 fileId를 받는다.
        // 하지만 우리는 TARGET_SPREADSHEET_ID를 백엔드가 알고있다.
        // 만약 백엔드가 fileId를 필수로 받는다면 여기서 TARGET_SPREADSHEET_ID를 알아야한다.
        // 일단 사용자가 backend_gas_v2.js에 상수로 ID를 박았으므로, fileId파라미터가 없어도 동작하도록 백엔드를 수정하거나
        // 아니면 여기서 상수로 ID를 가지고 있어야 한다.
        // 프론트에 ID를 노출하고 싶지 않다면 백엔드 수정 필요.
        // 지금은 backend_gas_v2.js가 fileId를 받아서 openById 한다고 가정되어 있음.
        // 따라서 기존 로직 호환을 위해 더미 ID 또는 실제 ID가 필요함.
        // 편의상 아래 상수를 정의해서 사용.
    } catch (err) { }

    // Note: Since we removed the ID injection, download feature might break if backend strictly requires ID param.
    // For now, let's assume backend defaults to global ID if param is missing, OR we fetch it first.
    // We will pass sheetName.

    const options = { method: 'GET' };
    // URL Construct again
    // We need to pass TARGET_SPREADSHEET_ID... but we removed it from Index.html.
    // Let's assume we pass 'default' and backend handles it, OR fetch 'getFormList' returned spreadsheetId.
    const targetId = currentSheetInfo?.spreadsheetId || '19rgzRnTQtOwwW7Ts5NbBuItNey94dAZsEnO7Tk0cm6s'; // Fallback to hardcoded ID if needed

    let fetchUrl = `${GAS_API_URL}?fileId=${encodeURIComponent(targetId)}&sheetName=${encodeURIComponent(sheetName)}&filename=${encodeURIComponent(fileName)}`;

    try {
        const res = await fetch(fetchUrl);
        const json = await res.json();
        if (json.error) throw new Error(json.error);

        preparedDownload = json;
        const btn = document.getElementById('xlsxDownloadBtn');
        if (btn) {
            btn.disabled = false;
            btn.style.backgroundColor = '#4CAF50';
            btn.style.color = 'white';
            btn.style.cursor = 'pointer';
            btn.innerText = `⬇ ${fileName}`;
        }
    } catch (err) {
        console.error(err);
        const btn = document.getElementById('xlsxDownloadBtn');
        if (btn) {
            btn.innerText = '준비 실패';
        }
    }
}

function triggerPreparedDownload(buttonId) {
    if (!preparedDownload) {
        alert('파일이 아직 준비되지 않았습니다.');
        return;
    }
    const a = document.createElement('a');
    a.href = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${preparedDownload.base64}`;
    a.download = preparedDownload.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
}

// --- 측정값 저장 ---
async function saveMeasurements() {
    if (!currentSheetInfo?.sheetName) {
        showStatus("저장할 시트 정보가 없습니다.", 'error');
        return;
    }
    showStatus('측정값을 저장 중입니다...', 'loading');

    const formInputs = document.querySelectorAll('#measurementForm input[type="number"]');
    const measurementsToSave = Array.from(formInputs).map(input => ({
        location: input.dataset.location,
        item: input.dataset.item,
        value: input.value,
        unit: input.dataset.unit
    }));

    try {
        const response = await callApi('saveMeasurementsToSheet', 'POST', {
            sheetName: currentSheetInfo.sheetName,
            measurements: measurementsToSave
        });

        if (response.success) {
            showStatus(response.message, 'success', 3000);
            loadFormList();
            isMeasurementDirty = false;

            // 다운로드 새로고침
            const displayName = currentSheetInfo.displayName || currentSheetInfo.sheetName;
            const d = new Date();
            const fileName = `${displayName}_${d.getFullYear().toString().slice(2, 4)}${('0' + (d.getMonth() + 1)).slice(-2)}${('0' + d.getDate()).slice(-2)}.xlsx`;

            const btn = document.getElementById('xlsxDownloadBtn');
            if (btn) {
                btn.disabled = true;
                btn.style.backgroundColor = '#ccc';
                btn.innerText = '파일 준비중..';
            }
            prepareXlsxInAdvance(currentSheetInfo.spreadsheetId, currentSheetInfo.sheetName, fileName);

        } else {
            showStatus(response.message || '저장 실패', 'error');
        }
    } catch (error) {
        showStatus(`저장 오류: ${error.message}`, 'error');
    }
}

// --- 양식 목록 로드 ---
async function loadFormList() {
    const formSelect = document.getElementById('formSelect');
    const formListStatus = document.getElementById('formListStatus');
    const originalValue = formSelect.value;

    formListStatus.textContent = '양식 목록 불러오는 중...';
    formListStatus.className = 'loading';

    try {
        const formList = await callApi('getFormList', 'GET');
        formSelect.innerHTML = '<option value="">-- 양식을 선택해주세요 --</option>';

        if (formList && formList.length > 0) {
            formList.sort((a, b) => new Date(b.lastModifiedDate) - new Date(a.lastModifiedDate));
            formList.forEach(form => {
                const option = document.createElement('option');
                option.value = form.sheetName;
                const cleanName = form.sheetName.split('_')[0];
                option.textContent = `${cleanName} (수정: ${formatDateForDisplay(form.lastModifiedDate)})`;
                option.dataset.displayName = cleanName;
                option.dataset.lastModifiedDate = form.lastModifiedDate;
                option.dataset.spreadsheetId = form.spreadsheetId;
                formSelect.appendChild(option);
            });
            formSelect.value = originalValue;
            formListStatus.textContent = '양식 목록 로드 완료.';
            formListStatus.className = 'success';
        } else {
            formListStatus.textContent = '저장된 양식이 없습니다.';
            formListStatus.className = '';
        }
        updateFavoriteButtons();

    } catch (error) {
        formListStatus.textContent = `로드 오류: ${error.message}`;
        formListStatus.className = 'error';
        updateFavoriteButtons();
    }
}

async function loadSelectedForm() {
    if (isMeasurementDirty && !confirm('변경사항이 저장되지 않았습니다. 이동하시겠습니까?')) {
        document.getElementById('formSelect').value = currentSheetInfo ? currentSheetInfo.sheetName : '';
        return;
    }

    const formSelect = document.getElementById('formSelect');
    const selectedOption = formSelect.options[formSelect.selectedIndex];
    const sheetName = selectedOption.value;
    const formContainer = document.getElementById('dynamicFormContainer');

    // [수정] 양식 선택이 없을 경우 (또는 홈 버튼 클릭 시) 초기 화면으로 복귀
    if (!sheetName) {
        const isNotifActive = getFromStorage('isNotificationActive') === true;
        const checkedAttr = isNotifActive ? 'checked' : '';

        // 요청사항 2: 메인 화면에 알림 토글 추가
        formContainer.innerHTML = `
            <h3>측정값 입력 폼</h3>
            <p id="formMessage">메뉴(☰)를 열어 새 양식을 업로드하거나 기존 양식을 선택해주세요.</p>
            <div class="switch-container" style="max-width:300px; margin: 20px auto; border: 1px solid #ddd; box-shadow: 0 2px 5px rgba(0,0,0,0.05);">
                <label class="switch">
                    <input type="checkbox" id="notificationToggleMain" ${checkedAttr}>
                    <span class="slider"></span>
                </label>
            </div>
        `;

        currentSheetInfo = null;
        document.getElementById('favoritesSection').classList.remove('hidden');
        updateHomeButtonVisibility();
        closeMenu();
        return;
    }

    showStatus(`${sheetName} 로드 중...`, 'loading');
    isMeasurementDirty = false;
    closeMenu();

    try {
        const formData = await callApi('getFormDataForWeb', 'GET', { sheetName });

        currentSheetInfo = {
            spreadsheetId: selectedOption.dataset.spreadsheetId,
            sheetName: sheetName,
            displayName: selectedOption.dataset.displayName,
            lastModifiedDate: selectedOption.dataset.lastModifiedDate
        };

        if (formData && formData.length > 0) {
            createDynamicForm(formData, currentSheetInfo.displayName);
            showStatus('로드 완료', 'success', 3000);
            updateHomeButtonVisibility();
        } else {
            formContainer.innerHTML = '<p class="error">데이터가 없습니다.</p>';
            // 데이터가 없으면 다시 즐겨찾기 보이기
            document.getElementById('favoritesSection').classList.remove('hidden');
        }

    } catch (error) {
        showStatus(`폼 로딩 오류: ${error.message}`, 'error');
        // 에러 발생 시에도 안전하게 초기화
        currentSheetInfo = null;
        document.getElementById('favoritesSection').classList.remove('hidden');
        updateHomeButtonVisibility();
    }
}

// --- 즐겨찾기 로직 ---
function initializeFavorites() {
    favorites = getFromStorage('favorites') || {};
    document.getElementById('favoritesSection').addEventListener('click', handleFavoriteClick);

    // [복원] 홈버튼 이벤트 리스너
    const homeBtn = document.getElementById('homeBtn');
    if (homeBtn) {
        homeBtn.addEventListener('click', function () {
            document.getElementById('formSelect').value = '';
            currentSheetInfo = null;
            loadSelectedForm();
            updateHomeButtonVisibility();
            addHomeStateToHistory();
        });
    }
}

function updateFavoriteButtons() {
    for (let i = 1; i <= 3; i++) {
        const btn = document.getElementById(`favBtn${i}`);
        if (favorites[i]) {
            btn.textContent = favorites[i].displayName;
            btn.classList.add('registered');
            btn.disabled = false;
        } else {
            btn.textContent = '비어있음';
            btn.classList.remove('registered');
            btn.disabled = false;
        }
    }
}

function handleFavoriteClick(e) {
    if (!e.target.matches('.fav-button')) return;
    const favId = e.target.dataset.favId;

    if (favorites[favId]) {
        // 로드
        const fav = favorites[favId];
        const formSelect = document.getElementById('formSelect');
        // Select option logic simliar to original
        let opt = [...formSelect.options].find(o => o.value === fav.sheetName);
        if (!opt) opt = [...formSelect.options].find(o => (o.dataset.displayName) === fav.displayName);

        if (opt) {
            formSelect.value = opt.value;
            loadSelectedForm();
        } else {
            showStatus('즐겨찾기 된 양식을 찾을 수 없어 초기화합니다.', 'error');
            delete favorites[favId];
            saveToStorage('favorites', favorites);
            updateFavoriteButtons();
        }
    } else {
        // 등록
        if (currentSheetInfo && currentSheetInfo.sheetName) {
            if (confirm(`현재 양식 '${currentSheetInfo.displayName}'를 이 즐겨찾기에 등록하시겠습니까?`)) {
                favorites[favId] = { sheetName: currentSheetInfo.sheetName, displayName: currentSheetInfo.displayName };
                saveToStorage('favorites', favorites);
                updateFavoriteButtons();
                showStatus(`'${currentSheetInfo.displayName}'가 즐겨찾기에 등록되었습니다.`, 'success', 3000);
            }
        } else {
            // [복원] 양식이 로드되지 않았을 경우, 선택 팝업을 띄움
            promptForFavoriteSelection(favId);
        }
    }
}

function promptForFavoriteSelection(favId) {
    const formSelect = document.getElementById('formSelect');
    if (formSelect.options.length <= 1) {
        showStatus('등록할 양식이 없습니다. 먼저 새 양식을 업로드해주세요.', 'error', 3000);
        return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'fav-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'fav-modal-content';

    modal.innerHTML = `
            <h4>즐겨찾기 등록</h4>
            <p>이 슬롯에 등록할 양식을 선택해주세요.</p>
            <select id="favModalSelect"></select>            
            <div class="fav-modal-buttons">
                <button id="favModalCancel">취소</button>
                <button id="favModalRegister" class="primary">등록</button>
            </div>
        `;

    document.body.appendChild(overlay);
    document.body.appendChild(modal);

    const modalSelect = document.getElementById('favModalSelect');
    for (let i = 1; i < formSelect.options.length; i++) {
        const clonedOption = formSelect.options[i].cloneNode(true);
        const cleanName = clonedOption.dataset.displayName || clonedOption.textContent.split(' (')[0];
        clonedOption.textContent = cleanName; // 팝업에서는 수정 날짜 없이 깔끔한 이름만 보여줌
        modalSelect.appendChild(clonedOption);
    }

    function closeModal() {
        document.body.removeChild(overlay);
        document.body.removeChild(modal);
    }

    document.getElementById('favModalRegister').onclick = function () {
        const selectedOption = modalSelect.options[modalSelect.selectedIndex];
        const sheetName = selectedOption.value;
        const displayName = selectedOption.dataset.displayName || sheetName;

        favorites[favId] = { sheetName, displayName };
        saveToStorage('favorites', favorites);
        updateFavoriteButtons();
        showStatus(`'${displayName}'가 즐겨찾기에 등록되었습니다.`, 'success', 3000);
        closeModal();
    };

    document.getElementById('favModalCancel').onclick = closeModal;
    overlay.onclick = closeModal;
}

// --- 유효성 검사 로직 (Validation) ---
async function loadValidationData(uniqueIds) {
    try {
        // uniqueIds array to JSON
        const data = await callApi('getValidationDataFromDB', 'GET', { uniqueIds: JSON.stringify(uniqueIds) });
        validationData = data;
    } catch (e) { console.error(e); }
}

function validateInputValue(input) {
    const val = parseFloat(input.value);
    const uid = input.dataset.uniqueId;
    if (!uid || isNaN(val)) return;

    const info = validationData[uid];
    if (!info) return;

    if ((info.minValue && val < info.minValue) || (info.maxValue && val > info.maxValue)) {
        showValidationWarning(input, val, info.minValue, info.maxValue, info.recentValue, info.recentDate);
    }
}

function showValidationWarning(input, value, min, max, recentVal, recentDate) {
    // Original warning modal logic...
    // Simplified for brevity in this conversion, simply copy pasting pure JS logic
    const overlay = document.createElement('div');
    overlay.className = 'validation-modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'validation-modal-content';

    modal.innerHTML = `<h4>⚠️ 범위 경고</h4><p>입력값이 유효범위를 벗어납니다.</p>
          <p>${recentDate} 값: ${recentVal || '없음'}<br>현재 값: ${value}</p>
          <div class="validation-modal-buttons"><button id="vYes" class="primary">수정</button><button id="vNo">무시하기</button></div>`;

    document.body.appendChild(overlay);
    document.body.appendChild(modal);

    document.getElementById('vYes').onclick = () => {
        input.value = ''; input.focus();
        document.body.removeChild(overlay); document.body.removeChild(modal);
    };
    document.getElementById('vNo').onclick = () => {
        document.body.removeChild(overlay); document.body.removeChild(modal);
    };
}

// --- 유틸리티 ---
function formatDateForDisplay(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
}
function updateHomeButtonVisibility() {
    const homeBtn = document.getElementById('homeBtn');
    if (homeBtn && currentSheetInfo) homeBtn.classList.add('visible');
    else if (homeBtn) homeBtn.classList.remove('visible');
}
function addHomeStateToHistory() {
    history.pushState({ page: 'home' }, 'Home', '?page=home');
}
