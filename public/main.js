// Spotify Authorization Flow - PKCE
// Reference: https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow

const clientId = '796c2ce655f74db3844a4cf0bc095a39'
// const redirectUrl = 'http://127.0.0.1:3000/';
const redirectUrl = 'https://d1s2ej9uh3i9p2.cloudfront.net/'
const authorizationEndpoint = "https://accounts.spotify.com/authorize";
const tokenEndpoint = "https://accounts.spotify.com/api/token";
const scope = 'user-read-private user-read-email';

const $ = (id) => document.getElementById(id);

// token cache in localStorage
const tokenStore = {
    get access_token() { return localStorage.getItem('access_token') || null; },
    get refresh_token() { return localStorage.getItem('refresh_token') || null; },
    get expires_in() { return parseInt(localStorage.getItem('expires_in') || '0', 10); },
    get expires() { return parseInt(localStorage.getItem('expires') || '0', 10); },

    save(resp) {
        const { access_token, refresh_token, expires_in } = resp;
        if (access_token) localStorage.setItem('access_token', access_token);
        if (refresh_token) localStorage.setItem('refresh_token', refresh_token);
        if (expires_in) {
            localStorage.setItem('expires_in', String(expires_in));
            const expiryMs = Date.now() + expires_in * 1000 - 15_000;
            localStorage.setItem('expires', String(expiryMs));
        }
    },
    clear() {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('expires_in');
        localStorage.removeItem('expires');
        localStorage.removeItem('code_verifier');
    },
    isExpired() {
        const exp = this.expires;
        return !this.access_token || !exp || Date.now() >= exp;
    }
};

//Auth: PKCE flow
async function login() {
    //code verifier & challenge
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const randomValues = crypto.getRandomValues(new Uint8Array(64));
    const code_verifier = Array.from(randomValues).map(x => possible[x % possible.length]).join('');
    const data = new TextEncoder().encode(code_verifier);
    const hashed = await crypto.subtle.digest('SHA-256', data);
    const code_challenge = btoa(String.fromCharCode(...new Uint8Array(hashed)))
        .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

    localStorage.setItem('code_verifier', code_verifier);

    const authUrl = new URL(authorizationEndpoint);
    authUrl.search = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        scope,
        code_challenge_method: 'S256',
        code_challenge,
        redirect_uri: redirectUrl,
    }).toString();

    window.location.href = authUrl.toString();
}

//Token exchange & refresh
async function exchangeCodeForToken(code) {
    const code_verifier = localStorage.getItem('code_verifier') || '';
    const resp = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: clientId,
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUrl,
            code_verifier
        }),
    });
    if (!resp.ok) throw new Error(`Token exchange failed: ${resp.status}`);
    return resp.json();
}

async function refreshAccessToken() {
    if (!tokenStore.refresh_token) throw new Error('No refresh_token available.');
    const resp = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: clientId,
            grant_type: 'refresh_token',
            refresh_token: tokenStore.refresh_token
        }),
    });
    if (!resp.ok) throw new Error(`Refresh failed: ${resp.status}`);
    return resp.json();
}

// API calls
async function getMe() {
    const resp = await fetch('https://api.spotify.com/v1/me', {
        headers: { 'Authorization': `Bearer ${tokenStore.access_token}` }
    });
    if (resp.status === 401) throw new Error('Unauthorized');
    if (!resp.ok) throw new Error(`Failed to fetch user: ${resp.status}`);
    return resp.json();
}
async function getPlaylists() {
    const resp = await fetch('https://api.spotify.com/v1/me/playlists', {
        headers: { 'Authorization': `Bearer ${tokenStore.access_token}` }
    });
    if (resp.status === 401) throw new Error('Unauthorized');
    if (!resp.ok) throw new Error(`Failed to fetch playlists: ${resp.status}`);
    const data = await resp.json();
    return data.items.map(p => ({ name: p.name, id: p.id, tracks: p.tracks.total }));
}

async function getPlaylistTracks(playlistId) {
    const resp = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
        headers: { 'Authorization': `Bearer ${tokenStore.access_token}` }
    });
    if (resp.status === 401) throw new Error('Unauthorized');
    if (!resp.ok) throw new Error(`Failed to fetch tracks: ${resp.status}`);
    const data = await resp.json();
    return data.items.map(item => item.track?.name).filter(Boolean);
}

//UI handling
function setStatus(msg) { if ($('status')) $('status').textContent = msg || ''; }
function show(obj) { return JSON.stringify(obj, null, 2); }


if ($('getPlaylistsBtn')) {
    $('getPlaylistsBtn').addEventListener('click', async () => {
        try {
            const playlists = await getPlaylists();
            const listBox = $('playlistsBox');
            listBox.innerHTML = '';
            playlists.forEach(p => {
                const li = document.createElement('li');
                li.textContent = `${p.name} (${p.tracks} tracks)`;

                li.style.cursor = 'pointer';
                li.addEventListener('click', async () => {
                    try {
                        setStatus(`Fetching tracks for ${p.name}...`);
                        const tracks = await getPlaylistTracks(p.id);

                        const tracksBox = $('tracksBox');
                        tracksBox.innerHTML = '';

                        tracks.forEach(t => {
                            const trackLi = document.createElement('li');
                            trackLi.textContent = t;
                            tracksBox.appendChild(trackLi);
                        });

                        setStatus(`Showing ${tracks.length} tracks from "${p.name}"`);
                    } catch (err) {
                        setStatus(err.message);
                    }
                });

                listBox.appendChild(li);
            });

        } catch (err) {
            setStatus(`Error: ${err.message}`);
        }
    });
}

async function onLogin() {
    setStatus('Redirecting to Spotify…');
    await login();
}
async function onLogout() {
    tokenStore.clear();
    setStatus('Logged out.');

    if ($('loginBtn')) $('loginBtn').disabled = false;
    if ($('logoutBtn')) $('logoutBtn').disabled = true;

    const url = new URL(window.location.href);
    url.search = '';
    window.history.replaceState({}, document.title, url.toString());
    window.location.reload();
}

async function onRefresh() {
    try {
        setStatus('Refreshing token…');
        const t = await refreshAccessToken();
        tokenStore.save(t);
        setStatus('Token refreshed.');
        await showUserIfPossible();
    } catch (e) {
        setStatus(e.message);
    }
}

// --- Core flow on page load
async function init() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (code) {
        try {
            setStatus('Exchanging code for token…');
            const token = await exchangeCodeForToken(code);
            tokenStore.save(token);

            const url = new URL(window.location.href);
            url.searchParams.delete('code');
            url.searchParams.delete('state');
            window.history.replaceState({}, document.title, url.toString());
            setStatus('Logged in.');
        } catch (e) {
            setStatus(e.message);
        }
    }

    if (tokenStore.access_token && tokenStore.isExpired() && tokenStore.refresh_token) {
        try {
            setStatus('Refreshing expired token…');
            const t = await refreshAccessToken();
            tokenStore.save(t);
            setStatus('Token refreshed.');
        } catch (e) {
            setStatus(`Auto-refresh failed: ${e.message}`);
        }
    }

    await showUserIfPossible();

    if ($('loginBtn')) $('loginBtn').addEventListener('click', onLogin);
    if ($('logoutBtn')) $('logoutBtn').addEventListener('click', onLogout);

    if (!tokenStore.access_token) {
        if ($('loginBtn')) $('loginBtn').disabled = false;
        if ($('logoutBtn')) $('logoutBtn').disabled = true;
    }
}

async function showUserIfPossible() {
    if (!tokenStore.access_token) {
        if ($('loginBtn')) $('loginBtn').disabled = false;
        if ($('logoutBtn')) $('logoutBtn').disabled = true;
        return;
    }

    try {
        const me = await getMe();

        if ($('loginBtn')) $('loginBtn').disabled = true;
        if ($('logoutBtn')) $('logoutBtn').disabled = false;

        setStatus(`Hello, ${me.display_name || me.id}!`);
    } catch (e) {
        setStatus(e.message);

        if ($('loginBtn')) $('loginBtn').disabled = false;
        if ($('logoutBtn')) $('logoutBtn').disabled = true;
    }
}

document.addEventListener('DOMContentLoaded', init);
