// ====== CONFIGURATION ======
// IMPORTANT: Replace this with your actual Spotify Client ID from the Developer Dashboard
const CLIENT_ID = '6e3c8d68fdf94f2ebe2b5c847b4f6772';
// The URL where this app is hosted (use http://127.0.0.1:8080/ for local dev, or your Vercel/GitHub pages URL for the final APK)
const REDIRECT_URI = window.location.href.split('#')[0].split('?')[0];
const SCOPES = 'user-read-currently-playing user-read-playback-state';

let accessToken = null;
let currentTrackId = null;

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
            updateUI('Nothing playing', '', null, null);
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

            if (data.item.id !== currentTrackId) {
                currentTrackId = data.item.id;
                updateUI(trackName, artistName, imageUrl, isPlaying);
            } else {
                // just update play state if needed, though this UI doesn't strictly show play/pause
            }
        }
    } catch (e) {
        console.error("Error fetching Spotify data", e);
    }
}


function updateUI(title, artist, imageUrl, isPlaying) {
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
    // Remove duplication if exists
    const children = Array.from(wrapper.children);
    if (children.length > 1) {
        wrapper.removeChild(children[1]);
    }

    wrapper.style.transform = 'translateX(0)';
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
                wrapper.style.transform = `translateX(${offset}px)`;
            }
        }
    }
}

// Store active animations
const currentAnimations = new Map();

function animateMarquee(wrapper, scrollWidth) {
    if (currentAnimations.has(wrapper)) {
        clearTimeout(currentAnimations.get(wrapper));
    }

    // Constants to match WPF app
    const initialDelay = 5000;
    const pixelsPerFrame = 0.8;
    const msPerFrame = 16;

    let currentX = 0;

    function step() {
        currentX -= pixelsPerFrame;

        if (-currentX >= scrollWidth) {
            // Reset to beginning and pause
            currentX = 0;
            wrapper.style.transform = `translateX(0px)`;
            const timeoutId = setTimeout(step, initialDelay);
            currentAnimations.set(wrapper, timeoutId);
        } else {
            wrapper.style.transform = `translateX(${currentX}px)`;
            const timeoutId = setTimeout(step, msPerFrame);
            currentAnimations.set(wrapper, timeoutId);
        }
    }

    // Start with delay
    wrapper.style.transform = `translateX(0px)`;
    const timeoutId = setTimeout(step, initialDelay);
    currentAnimations.set(wrapper, timeoutId);
}

// Handle resizing
window.addEventListener('resize', () => {
    if (titleText.innerText !== "Waiting for Spotify...") {
        setupMarquee(titleContainer, titleWrapper, titleText);
        setupMarquee(artistContainer, artistWrapper, artistText);
    }
});

// Run auth check on load
checkAuth();
