// Single source of truth for the backend base URL.
const params = new URLSearchParams(window.location.search);
const forceRemote = params.get('api') === 'remote';
const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

export const API_BASE_URL = (isLocal && !forceRemote)
    ? 'http://localhost:8080'
    : 'https://mvfm.pythonanywhere.com';

// All backend calls go through the versioned /api/v2 prefix.
export const API_V2 = `${API_BASE_URL}/api/v2`;
