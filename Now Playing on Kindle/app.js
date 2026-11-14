// ====== CONFIGURATION ======
// IMPORTANT: Replace this with your actual Spotify Client ID from the Developer Dashboard
const CLIENT_ID = '6e3c8d68fdf94f2ebe2b5c847b4f6772';
// The URL where this app is hosted (use http://127.0.0.1:8080/ for local dev, or your Vercel/GitHub pages URL for the final APK)
const REDIRECT_URI = window.location.href.split('#')[0].split('?')[0];
const SCOPES = 'user-read-currently-playing user-read-playback-state user-modify-playback-state';

let accessToken = null;
let currentTrackId = null;
let currentIsPlaying = null;
let currentShuffle = false;
let currentRepeat = 'off';
let lastModeChange = 0;

// ====== CLOCK STATE ======
let isClockMode = false;
let clockStyleIdx = parseInt(localStorage.getItem('clock_style') || '0', 10);
if (Number.isNaN(clockStyleIdx) || clockStyleIdx < 0) clockStyleIdx = 0;
clockStyleIdx = clockStyleIdx % 3;

function isWithinNightSchedule(d = new Date()) {
    const h = d.getHours();
    return h >= 0 && h < 7;
}

let lastScheduleWindow = isWithinNightSchedule();
let isClockDimmed = lastScheduleWindow;
let clockIntervalId = null;
let analogRafId = null;
let analogGeometry = null;
const flipValues = { 'flip-hours': null, 'flip-minutes': null };
const flipTimers = { 'flip-hours': null, 'flip-minutes': null };

// ====== UI ELEMENTS ======
const loginOverlay = document.getElementById('login-overlay');
const loginButton = document.getElementById('login-button');
const albumArt = document.getElementById('album-art');
const backgroundImage = document.getElementById('background-image');
const titleText = document.getElementById('title-text');
const artistText = document.getElementById('artist-text');
const titleWrapper = document.getElementById('title-wrapper');
const artistWrapper = document.getElementById('artist-wrapper');
const titleContainer = document.getElementById('title-container');
const artistContainer = document.getElementById('artist-container');
const contentContainer = document.getElementById('content-container');
const swipeOverlay = document.getElementById('swipe-transition-overlay');
const clockContainer = document.getElementById('clock-container');
const clockFaces = [
    document.getElementById('clock-flip'),
    document.getElementById('clock-minimal'),
    document.getElementById('clock-analog')
];
const minimalTimeEl = document.getElementById('minimal-time');
const analogSvg = document.getElementById('analog-svg');
const analogTicksGroup = document.getElementById('analog-ticks');
const analogHourHand = document.getElementById('analog-hour-hand');
const analogMinuteHand = document.getElementById('analog-minute-hand');
const analogSecondHand = document.getElementById('analog-second-hand');
const analogCenterDot = document.getElementById('analog-center-dot');

// ====== AUTHENTICATION ======
// PKCE Helpers
async function sha256(plain) {
    const encoder = new TextEncoder();
    const data = encoder.encode(plain);
    return window.crypto.subtle.digest('SHA-256', data);
}

function base64encode(input) {
    return btoa(String.fromCharCode(...new Uint8Array(input)))
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
}

function generateRandomString(length) {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const values = crypto.getRandomValues(new Uint8Array(length));
    return values.reduce((acc, x) => acc + possible[x % possible.length], "");
}

async function checkAuth() {
    const urlParams = new URLSearchParams(window.location.search);
    let code = urlParams.get('code');
    
    const scopeVersion = localStorage.getItem('auth_scope_version');
    if (scopeVersion !== '2') {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        localStorage.setItem('auth_scope_version', '2');
    }
    
    accessToken = localStorage.getItem('access_token');

    if (code) {
        let codeVerifier = localStorage.getItem('code_verifier');
        const payload = {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              client_id: CLIENT_ID,
              grant_type: 'authorization_code',
              code: code,
              redirect_uri: REDIRECT_URI,
              code_verifier: codeVerifier,
            }),
        }

        try {
            const tokenResponse = await fetch("https://accounts.spotify.com/api/token", payload);
            const tokenData = await tokenResponse.json();

            if (tokenData.access_token) {
                accessToken = tokenData.access_token;
                localStorage.setItem('access_token', accessToken);
                if (tokenData.refresh_token) {
                    localStorage.setItem('refresh_token', tokenData.refresh_token);
                }
                window.history.replaceState({}, document.title, window.location.pathname);
                loginOverlay.style.display = 'none';
                startPolling();
                return;
            }
        } catch (e) {
            console.error("Token exchange failed", e);
        }
    } 
    
    if (accessToken) {
        loginOverlay.style.display = 'none';
        startPolling();
    } else {
        loginOverlay.style.display = 'flex';
    }
}

loginButton.addEventListener('click', async () => {
    if (CLIENT_ID === 'YOUR_SPOTIFY_CLIENT_ID_HERE') {
        alert('Please edit app.js to insert your Spotify Client ID first!');
        return;
    }
    
    const codeVerifier = generateRandomString(64);
    window.localStorage.setItem('code_verifier', codeVerifier);
    const hashed = await sha256(codeVerifier);
    const codeChallenge = base64encode(hashed);

    const authUrl = new URL("https://accounts.spotify.com/authorize");
    const params =  {
      response_type: 'code',
      client_id: CLIENT_ID,
      scope: SCOPES,
      code_challenge_method: 'S256',
      code_challenge: codeChallenge,
      redirect_uri: REDIRECT_URI,
    };
    
    authUrl.search = new URLSearchParams(params).toString();
    window.location.href = authUrl.toString();
});

// ====== API POLLING ======
async function refreshToken() {
    const refresh_token = localStorage.getItem('refresh_token');
    if (!refresh_token) {
        localStorage.removeItem('access_token');
        window.location.reload();
        return false;
    }

    const payload = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          grant_type: 'refresh_token',
          refresh_token: refresh_token,
        }),
    };

    try {
        const response = await fetch("https://accounts.spotify.com/api/token", payload);
        const data = await response.json();
        if (data.access_token) {
            accessToken = data.access_token;
            localStorage.setItem('access_token', accessToken);
            if (data.refresh_token) {
                localStorage.setItem('refresh_token', data.refresh_token);
            }
            return true;
        }
    } catch (e) {
        console.error("Error refreshing token", e);
    }
    
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    window.location.reload();
    return false;
}

async function startPolling() {
    setClockMode(true);
    fetchNowPlaying(); // fetch immediately
    setInterval(fetchNowPlaying, 5000); // then every 5 seconds
}

async function fetchNowPlaying() {
    if (!accessToken) return;

    try {
        const response = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (response.status === 204) {
            // 204 means nothing is playing right now
            if (currentTrackId !== 'none' || currentIsPlaying !== false) {
                currentTrackId = 'none';
                currentIsPlaying = false;
                updateUI('Nothing playing', '', null, false);
            }
            return;
        }

        if (response.status === 401) {
            // Token expired
            const refreshed = await refreshToken();
            if (refreshed) {
                fetchNowPlaying();
            }
            return;
        }

        const data = await response.json();

        if (data && data.item) {
            const isPlaying = data.is_playing;
            const trackName = data.item.name;
            const artistName = data.item.artists.map(a => a.name).join(', ');
            let imageUrl = null;
            if (data.item.album && data.item.album.images.length > 0) {
                imageUrl = data.item.album.images[0].url;
            }

            if (data.item.id !== currentTrackId || isPlaying !== currentIsPlaying) {
                currentTrackId = data.item.id;
                currentIsPlaying = isPlaying;
                updateUI(trackName, artistName, imageUrl, isPlaying);
            }
            
            // Prevent Spotify API propagation delay from overwriting local state mid-cycle
            if (Date.now() - lastModeChange > 4000) {
                currentShuffle = data.shuffle_state;
                currentRepeat = data.repeat_state;
            }
            if (!isClockMode) {
                fadeOutSwipeTransition();
            }
        } else {
            if (currentTrackId !== 'none' || currentIsPlaying !== false) {
                currentTrackId = 'none';
                currentIsPlaying = false;
                updateUI('Nothing playing', '', null, false);
            }
        }
    } catch (e) {
        console.error("Error fetching Spotify data", e);
    }
}


function updateUI(title, artist, imageUrl, isPlaying) {
    if (title === 'Nothing playing' || isPlaying === false) {
        setClockMode(true);
        return; // Skip rest of updates to display bedroom clock
    } else {
        setClockMode(false);
    }

    titleText.innerText = title;
    artistText.innerText = artist;

    if (imageUrl) {
        albumArt.src = imageUrl;
        albumArt.parentElement.style.opacity = "1";
        backgroundImage.src = imageUrl;
    } else {
        albumArt.parentElement.style.opacity = "0";
        albumArt.src = '';
        backgroundImage.src = '';
    }

    // Reset animations
    setupMarquee(titleContainer, titleWrapper, titleText);
    setupMarquee(artistContainer, artistWrapper, artistText);
}

// ====== MARQUEE LOGIC ======
function setupMarquee(container, wrapper, textElement) {
    // Cancel any running animations to prevent ghost scrolling
    if (currentAnimations.has(wrapper)) {
        const anim = currentAnimations.get(wrapper);
        if (anim.type === 'timeout') clearTimeout(anim.id);
        if (anim.type === 'frame') cancelAnimationFrame(anim.id);
        currentAnimations.delete(wrapper);
    }

    // Remove any cloned elements completely
    while (wrapper.children.length > 1) {
        wrapper.removeChild(wrapper.lastChild);
    }

    wrapper.style.transform = 'translate3d(0px, 0, 0)';
    wrapper.style.transition = 'none';

    // Measure
    const containerWidth = container.offsetWidth;
    const textWidth = textElement.offsetWidth - 60; // Subtract the 60px padding added in CSS

    // Determine if we need to scroll
    if (textWidth > containerWidth && containerWidth > 0) {
        // Clone for seamless loop
        const clone = textElement.cloneNode(true);
        wrapper.appendChild(clone);

        // Animate using JS for precise pausing
        animateMarquee(wrapper, textElement.offsetWidth);
    } else {
        // Center text in portrait mode physically if it fits
        const isPortrait = window.matchMedia("(max-aspect-ratio: 3/4)").matches;
        if (isPortrait && containerWidth > 0) {
            const offset = (containerWidth - textWidth) / 2;
            if (offset > 0) {
                wrapper.style.transform = `translate3d(${offset}px, 0, 0)`;
            }
        }
    }
}

// Store active animations
const currentAnimations = new Map();

function animateMarquee(wrapper, scrollWidth) {
    if (currentAnimations.has(wrapper)) {
        const anim = currentAnimations.get(wrapper);
        if (anim.type === 'timeout') clearTimeout(anim.id);
        if (anim.type === 'frame') cancelAnimationFrame(anim.id);
    }

    // Constants to match WPF app
    const initialDelay = 5000;
    const pixelsPerFrame = 0.8;

    let currentX = 0;
    let lastTime = 0;

    function step(timestamp) {
        if (!lastTime) lastTime = timestamp;
        const delta = timestamp - lastTime;
        lastTime = timestamp;
        
        // Scale movement by delta time to keep speed consistent regardless of refresh rate
        const speedMultiplier = delta / 16.66;
        currentX -= (pixelsPerFrame * speedMultiplier);

        if (-currentX >= scrollWidth) {
            // Reset to beginning and pause
            currentX = 0;
            wrapper.style.transform = `translate3d(0px, 0, 0)`;
            lastTime = 0;
            const timeoutId = setTimeout(() => {
                const frameId = requestAnimationFrame(step);
                currentAnimations.set(wrapper, { type: 'frame', id: frameId });
            }, initialDelay);
            currentAnimations.set(wrapper, { type: 'timeout', id: timeoutId });
        } else {
            wrapper.style.transform = `translate3d(${currentX}px, 0, 0)`;
            const frameId = requestAnimationFrame(step);
            currentAnimations.set(wrapper, { type: 'frame', id: frameId });
        }
    }

    // Start with delay
    wrapper.style.transform = `translate3d(0px, 0, 0)`;
    const timeoutId = setTimeout(() => {
        const frameId = requestAnimationFrame(step);
        currentAnimations.set(wrapper, { type: 'frame', id: frameId });
    }, initialDelay);
    currentAnimations.set(wrapper, { type: 'timeout', id: timeoutId });
}

// Handle resizing
window.addEventListener('resize', () => {
    if (titleText.innerText !== "Waiting for Spotify...") {
        setupMarquee(titleContainer, titleWrapper, titleText);
        setupMarquee(artistContainer, artistWrapper, artistText);
    }
    buildAnalogTicks();
    if (isClockMode && clockStyleIdx === 2) {
        renderAnalogHands();
    }
});

// ====== CLOCK LOGIC ======
function applyClockDimState() {
    if (!clockContainer) return;
    if (isClockDimmed) {
        clockContainer.classList.add('clock-dim-red');
    } else {
        clockContainer.classList.remove('clock-dim-red');
    }
}

function toggleClockDim() {
    isClockDimmed = !isClockDimmed;
    applyClockDimState();
}

function applyClockStyle() {
    clockFaces.forEach((face, idx) => {
        if (!face) return;
        if (idx === clockStyleIdx) {
            face.classList.add('active');
        } else {
            face.classList.remove('active');
        }
    });

    if (isClockMode && clockStyleIdx === 0) {
        updateClock(false);
    }

    if (isClockMode && clockStyleIdx === 2) {
        buildAnalogTicks();
        startAnalogAnimation();
    } else {
        stopAnalogAnimation();
    }
}

function setClockMode(enabled) {
    isClockMode = enabled;
    if (enabled) {
        contentContainer.style.display = 'none';
        backgroundImage.style.display = 'none';
        clockContainer.style.display = 'flex';
        applyClockDimState();
        applyClockStyle();
        updateClock(false);
    } else {
        clockContainer.style.display = 'none';
        stopAnalogAnimation();
        contentContainer.style.display = '';
        backgroundImage.style.display = '';
    }
}

function updateFlipUnit(unitId, newVal, animate) {
    const unit = document.getElementById(unitId);
    if (!unit) return;
    const cardTop = unit.querySelector('.flip-card-top span');
    const cardBottom = unit.querySelector('.flip-card-bottom span');
    const leafTop = unit.querySelector('.flip-leaf-top span');
    const leafBottom = unit.querySelector('.flip-leaf-bottom span');

    const prevVal = flipValues[unitId];
    if (prevVal === newVal) return;
    flipValues[unitId] = newVal;

    if (flipTimers[unitId]) {
        clearTimeout(flipTimers[unitId]);
        flipTimers[unitId] = null;
    }

    if (!animate || prevVal === null) {
        unit.classList.remove('flipping');
        cardTop.textContent = newVal;
        cardBottom.textContent = newVal;
        leafTop.textContent = newVal;
        leafBottom.textContent = newVal;
        return;
    }

    unit.classList.remove('flipping');
    cardTop.textContent = newVal;
    leafTop.textContent = prevVal;
    cardBottom.textContent = prevVal;
    leafBottom.textContent = newVal;

    void unit.offsetWidth;
    unit.classList.add('flipping');

    flipTimers[unitId] = setTimeout(() => {
        cardBottom.textContent = newVal;
        leafTop.textContent = newVal;
        unit.classList.remove('flipping');
        flipTimers[unitId] = null;
    }, 520);
}

function updateClock(animate = true) {
    const now = new Date();
    const currentWindow = isWithinNightSchedule(now);
    if (currentWindow !== lastScheduleWindow) {
        lastScheduleWindow = currentWindow;
        isClockDimmed = currentWindow;
        applyClockDimState();
    }

    const hours12 = (now.getHours() % 12) || 12;
    const hoursStr = String(hours12);
    const minutesStr = String(now.getMinutes()).padStart(2, '0');

    if (minimalTimeEl) {
        const timeText = `${hoursStr}:${minutesStr}`;
        if (minimalTimeEl.textContent !== timeText) {
            minimalTimeEl.textContent = timeText;
        }
    }

    const shouldAnimateFlip = animate && isClockMode && clockStyleIdx === 0;
    updateFlipUnit('flip-hours', hoursStr, shouldAnimateFlip);
    updateFlipUnit('flip-minutes', minutesStr, shouldAnimateFlip);
}

function buildAnalogTicks() {
    if (!analogSvg || !analogTicksGroup) return;
    const W = window.innerWidth || 800;
    const H = window.innerHeight || 600;
    analogSvg.setAttribute('viewBox', `0 0 ${W} ${H}`);

    const cx = W / 2;
    const cy = H / 2;
    const padding = 20;
    const rx = Math.max(40, W / 2 - padding);
    const ry = Math.max(40, H / 2 - padding);
    const cr = Math.min(rx, ry) * 0.22;
    const ix = rx - cr;
    const iy = ry - cr;

    const minRadius = Math.max(30, Math.min(rx, ry) - 28);
    analogGeometry = { cx, cy, minRadius };

    const hourWidth = Math.max(6, Math.round(minRadius * 0.038));
    const minuteWidth = Math.max(4, Math.round(minRadius * 0.022));
    analogHourHand.setAttribute('stroke-width', String(hourWidth));
    analogMinuteHand.setAttribute('stroke-width', String(minuteWidth));
    analogSecondHand.setAttribute('stroke-width', '2');
    analogCenterDot.setAttribute('cx', String(cx));
    analogCenterDot.setAttribute('cy', String(cy));
    analogCenterDot.setAttribute('r', String(Math.max(5, Math.round(minRadius * 0.028))));

    const svgNS = 'http://www.w3.org/2000/svg';
    while (analogTicksGroup.firstChild) {
        analogTicksGroup.removeChild(analogTicksGroup.firstChild);
    }

    for (let i = 0; i < 60; i++) {
        const theta = (i * 6) * Math.PI / 180;
        const dx = Math.sin(theta);
        const dy = -Math.cos(theta);
        const ax = Math.abs(dx);
        const ay = Math.abs(dy);

        let t = 0;
        let hitEdge = false;

        if (ax > 1e-6) {
            const tv = rx / ax;
            if (tv * ay <= iy + 1e-6) {
                t = tv;
                hitEdge = true;
            }
        }
        if (!hitEdge && ay > 1e-6) {
            const th = ry / ay;
            if (th * ax <= ix + 1e-6) {
                t = th;
                hitEdge = true;
            }
        }
        if (!hitEdge) {
            const b = ax * ix + ay * iy;
            const c = ix * ix + iy * iy - cr * cr;
            t = b + Math.sqrt(Math.max(0, b * b - c));
        }

        const isMajor = (i % 5 === 0);
        const tickLen = isMajor ? 22 : 12;
        const x1 = cx + t * dx;
        const y1 = cy + t * dy;
        const x2 = cx + (t - tickLen) * dx;
        const y2 = cy + (t - tickLen) * dy;

        const line = document.createElementNS(svgNS, 'line');
        line.setAttribute('x1', x1.toFixed(2));
        line.setAttribute('y1', y1.toFixed(2));
        line.setAttribute('x2', x2.toFixed(2));
        line.setAttribute('y2', y2.toFixed(2));
        line.setAttribute('stroke-width', isMajor ? '4.5' : '2');
        line.setAttribute('class', isMajor ? 'analog-tick analog-tick-major' : 'analog-tick analog-tick-minor');
        analogTicksGroup.appendChild(line);
    }
}

function setHandCoords(lineEl, cx, cy, angleRad, startOffset, endOffset) {
    const dx = Math.sin(angleRad);
    const dy = -Math.cos(angleRad);
    lineEl.setAttribute('x1', (cx + startOffset * dx).toFixed(2));
    lineEl.setAttribute('y1', (cy + startOffset * dy).toFixed(2));
    lineEl.setAttribute('x2', (cx + endOffset * dx).toFixed(2));
    lineEl.setAttribute('y2', (cy + endOffset * dy).toFixed(2));
}

function renderAnalogHands() {
    if (!analogGeometry) buildAnalogTicks();
    if (!analogGeometry) return;

    const { cx, cy, minRadius } = analogGeometry;
    const now = new Date();
    const ms = now.getMilliseconds();
    const sec = now.getSeconds() + ms / 1000;
    const min = now.getMinutes() + sec / 60;
    const hr = (now.getHours() % 12) + min / 60;

    const hrAngle = (hr * 30) * Math.PI / 180;
    const minAngle = (min * 6) * Math.PI / 180;
    const secAngle = (sec * 6) * Math.PI / 180;

    setHandCoords(analogHourHand, cx, cy, hrAngle, 0, minRadius * 0.56);
    setHandCoords(analogMinuteHand, cx, cy, minAngle, 0, minRadius * 0.88);
    setHandCoords(analogSecondHand, cx, cy, secAngle, -minRadius * 0.18, minRadius * 0.94);
}

function startAnalogAnimation() {
    if (analogRafId !== null) return;
    function frame() {
        if (!isClockMode || clockStyleIdx !== 2) {
            analogRafId = null;
            return;
        }
        renderAnalogHands();
        analogRafId = requestAnimationFrame(frame);
    }
    renderAnalogHands();
    analogRafId = requestAnimationFrame(frame);
}

function stopAnalogAnimation() {
    if (analogRafId !== null) {
        cancelAnimationFrame(analogRafId);
        analogRafId = null;
    }
}

function resumeSpotifyFromClock() {
    spotifyAction('play', 'PUT');
    if (currentTrackId && currentTrackId !== 'none' && titleText.innerText !== 'Waiting for Spotify...') {
        currentIsPlaying = true;
        updateUI(titleText.innerText, artistText.innerText, backgroundImage.src, true);
    }
}

function initClock() {
    buildAnalogTicks();
    applyClockDimState();
    applyClockStyle();
    updateClock(false);
    if (!clockIntervalId) {
        clockIntervalId = setInterval(() => updateClock(true), 1000);
    }
}

initClock();

// Run auth check on load
checkAuth();

// ====== INTERACTION AND PLAYBACK CONTROL ======
function fadeOutSwipeTransition() {
    if (isProcessingSwipe) {
        isProcessingSwipe = false;
        
        // FADE OUT: animate opacity only
        swipeOverlay.style.transition = 'opacity 0.3s ease-out';
        swipeOverlay.style.opacity = '0';
        
        // Reset transform invisibly after fade out is fully done (plus safety buffer)
        setTimeout(() => {
            if (swipeOverlay.style.opacity === '0') {
                swipeOverlay.style.transition = 'none';
                swipeOverlay.style.transform = 'translateX(100%)';
            }
        }, 450);
    }
}

async function spotifyAction(endpoint, method = 'POST') {
    if (!accessToken) return;
    try {
        const response = await fetch(`https://api.spotify.com/v1/me/player/${endpoint}`, {
            method: method,
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (response.status === 401) {
            const refreshed = await refreshToken();
            if (refreshed) spotifyAction(endpoint, method);
            return;
        }
        if (response.status === 403 || response.status === 404) {
            console.log(`Action ${endpoint} failed. Note: Spotify requires an active device and Spotify Premium for remote control.`);
        }
        // Force an immediate poll to update UI visually
        setTimeout(fetchNowPlaying, 500); 
    } catch (e) {
        console.error("Playback action failed", e);
    }
}

function togglePlayPause() {
    if (currentIsPlaying === null) return;
    if (currentIsPlaying) {
        spotifyAction('pause', 'PUT');
        currentIsPlaying = false; 
        updateUI(titleText.innerText, artistText.innerText, backgroundImage.src, false);
    } else {
        spotifyAction('play', 'PUT');
        currentIsPlaying = true;
        updateUI(titleText.innerText, artistText.innerText, backgroundImage.src, true);
    }
}

let touchStartX = 0;
let touchStartY = 0;
let touchTime = 0;
let lastTouchEnd = 0;
let isDragging = false;
let isProcessingSwipe = false;
let touchSwipeDirection = null;
let maxTouches = 0;

function abortSwipe(diffX) {
    if (!isDragging && swipeOverlay.style.opacity !== '1') return;
    isDragging = false;
    isProcessingSwipe = false;
    
    // BOUNCE BACK: physically slide back to the edge it came from
    swipeOverlay.style.transition = 'transform 0.3s ease-out';
    if (diffX > 0 || (diffX === 0 && swipeOverlay.style.transform.includes('-'))) {
        swipeOverlay.style.transform = 'translateX(-100%)';
    } else {
        swipeOverlay.style.transform = 'translateX(100%)';
    }
    
    setTimeout(() => {
        swipeOverlay.style.opacity = '0';
        swipeOverlay.style.transition = 'none';
    }, 350);
}

document.addEventListener('touchstart', (e) => {
    if (loginOverlay.style.display !== 'none' || isProcessingSwipe) return;
    
    if (!isDragging) {
        // Initialize new gesture regardless of how many fingers landed first
        touchStartX = e.touches[0].screenX;
        touchStartY = e.touches[0].screenY;
        touchTime = Date.now();
        isDragging = true;
        touchSwipeDirection = null;
        maxTouches = e.touches.length;
        
        swipeOverlay.style.transition = 'none';
        swipeOverlay.style.transform = 'translateX(100%)';
        swipeOverlay.style.opacity = '1';
    } else {
        // Update max touches if more fingers land mid-gesture
        if (e.touches.length > maxTouches) {
            maxTouches = e.touches.length;
        }
    }
});

document.addEventListener('touchmove', (e) => {
    // Disable drag logic if they are using 2 fingers
    if (!isDragging || isProcessingSwipe || maxTouches >= 2) return;
    
    const currentX = e.changedTouches[0].screenX;
    const currentY = e.changedTouches[0].screenY;
    const diffX = currentX - touchStartX;
    const diffY = currentY - touchStartY;
    
    if (!touchSwipeDirection) {
        if (Math.abs(diffX) > 10 || Math.abs(diffY) > 10) {
            touchSwipeDirection = Math.abs(diffX) > Math.abs(diffY) ? 'horizontal' : 'vertical';
        }
    }
    
    if (touchSwipeDirection === 'horizontal') {
        if (diffX > 0) {
            swipeOverlay.style.transform = `translateX(calc(-100% + ${diffX}px))`;
        } else {
            swipeOverlay.style.transform = `translateX(calc(100% + ${diffX}px))`;
        }
    }
});

document.addEventListener('touchend', (e) => {
    if (!isDragging) return;
    
    // Wait until ALL fingers are off the screen before processing the gesture
    if (e.touches.length > 0) return;
    
    isDragging = false;
    lastTouchEnd = Date.now();
    
    const diffX = e.changedTouches[0].screenX - touchStartX;
    const diffY = e.changedTouches[0].screenY - touchStartY;
    const time = Date.now() - touchTime;
    
    if (maxTouches >= 2) {
        // Handle multi-finger tap
        if (time < 500) {
            if (isClockMode) {
                toggleClockDim();
            } else {
                cyclePlaybackMode();
            }
            swipeOverlay.style.opacity = '0';
            swipeOverlay.style.transform = 'translateX(100%)';
        } else {
            abortSwipe(0);
        }
        return;
    }
    
    if (Math.abs(diffX) > 50 && Math.abs(diffX) > Math.abs(diffY)) {
        isProcessingSwipe = true;
        swipeOverlay.style.transition = 'transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        swipeOverlay.style.transform = 'translateX(0)';
        
        if (isClockMode) {
            setTimeout(() => {
                if (diffX < 0) {
                    clockStyleIdx = (clockStyleIdx + 1) % 3;
                } else {
                    clockStyleIdx = (clockStyleIdx + 2) % 3;
                }
                localStorage.setItem('clock_style', String(clockStyleIdx));
                applyClockStyle();
                fadeOutSwipeTransition();
            }, 300);
        } else {
            if (diffX > 0) spotifyAction('previous'); 
            else spotifyAction('next');
            
            setTimeout(() => {
                if (isProcessingSwipe) fadeOutSwipeTransition();
            }, 3000);
        }
    } else {
        if (Math.abs(diffX) > 10) {
            abortSwipe(diffX);
        } else {
            swipeOverlay.style.opacity = '0';
            swipeOverlay.style.transform = 'translateX(100%)';
            if (time < 300) {
                if (isClockMode) {
                    resumeSpotifyFromClock();
                } else {
                    togglePlayPause();
                }
            }
        }
    }
});

document.addEventListener('touchcancel', (e) => {
    if (!isDragging || e.touches.length > 0) return;
    
    let diffX = 0;
    if (e.changedTouches && e.changedTouches.length > 0) {
        diffX = e.changedTouches[0].screenX - touchStartX;
    }
    abortSwipe(diffX);
});

// For PC testing or generic taps not caught by touch events
document.addEventListener('click', (e) => {
    if (loginOverlay.style.display !== 'none') return;
    if (Date.now() - lastTouchEnd < 500) return; // Prevent ghost clicks from touch firing twice
    
    if (isClockMode) {
        resumeSpotifyFromClock();
    } else {
        togglePlayPause();
    }
});

let popupTimeout = null;
function showStatusPopup(iconHtml) {
    const popup = document.getElementById('status-popup');
    popup.innerHTML = iconHtml;
    
    if (iconHtml.includes('</svg><svg')) {
        popup.style.gap = '10px';
    } else {
        popup.style.gap = '0px';
    }
    
    popup.style.transition = 'none';
    popup.style.opacity = '1';
    
    if (popupTimeout) clearTimeout(popupTimeout);
    popupTimeout = setTimeout(() => {
        popup.style.transition = 'opacity 0.3s ease-out';
        popup.style.opacity = '0';
    }, 1000);
}

function cyclePlaybackMode() {
    lastModeChange = Date.now();
    let stateIdx = 0;
    
    if (!currentShuffle && currentRepeat === 'off') stateIdx = 0; // none
    else if (currentShuffle && currentRepeat === 'off') stateIdx = 1; // shuffle
    else if (currentShuffle && currentRepeat === 'context') stateIdx = 2; // shuffle and loop
    else if (!currentShuffle && currentRepeat === 'context') stateIdx = 3; // loop
    else stateIdx = 0; // fallback

    stateIdx = (stateIdx + 1) % 4;
    
    let targetShuffle = false;
    let targetRepeat = 'off';
    let iconHtml = '';

    const iconShuffle = `<svg viewBox="0 0 24 24"><path d="M10.59,9.17L5.41,4 4,5.41l5.17,5.17 1.42,-1.41zM14.5,4l2.04,2.04L4,18.59 5.41,20 17.96,7.46 20,9.5V4h-5.5zm.33,9.41l-1.41,1.41 3.13,3.13L14.5,20H20v-5.5l-2.04,2.04-3.13-3.13z"/></svg>`;
    const iconLoop = `<svg viewBox="0 0 24 24"><path d="M7,7h10v3l4,-4 -4,-4v3H5v6h2V7zm10,10H7v-3l-4,4 4,4v-3h12v-6h-2v4z"/></svg>`;
    const iconDash = `<svg viewBox="0 0 24 24"><path d="M4,11h16v2H4z"/></svg>`;

    switch(stateIdx) {
        case 0:
            targetShuffle = false; targetRepeat = 'off';
            iconHtml = iconDash;
            break;
        case 1:
            targetShuffle = true; targetRepeat = 'off';
            iconHtml = iconShuffle;
            break;
        case 2:
            targetShuffle = true; targetRepeat = 'context';
            iconHtml = iconShuffle + iconLoop;
            break;
        case 3:
            targetShuffle = false; targetRepeat = 'context';
            iconHtml = iconLoop;
            break;
    }
    
    if (targetShuffle !== currentShuffle) {
        spotifyAction(`shuffle?state=${targetShuffle}`, 'PUT');
        currentShuffle = targetShuffle;
    }
    if (targetRepeat !== currentRepeat) {
        spotifyAction(`repeat?state=${targetRepeat}`, 'PUT');
        currentRepeat = targetRepeat;
    }

    showStatusPopup(iconHtml);
}
