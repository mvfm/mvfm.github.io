let apiPromise = null;

function loadYouTubeAPI() {
    if (window.YT?.Player) return Promise.resolve(window.YT);
    if (apiPromise) return apiPromise;
    apiPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        const previousReady = window.onYouTubeIframeAPIReady;
        const cleanup = () => {
            clearTimeout(timer);
            if (window.onYouTubeIframeAPIReady === ready) {
                window.onYouTubeIframeAPIReady = previousReady;
            }
        };
        const fail = () => {
            cleanup();
            script.remove();
            apiPromise = null;
            reject(new Error('YouTube player API failed to load'));
        };
        const ready = () => {
            cleanup();
            resolve(window.YT);
            previousReady?.();
        };
        const timer = setTimeout(fail, 15000);
        window.onYouTubeIframeAPIReady = ready;
        script.src = 'https://www.youtube.com/iframe_api';
        script.async = true;
        script.onerror = fail;
        document.head.appendChild(script);
    });
    return apiPromise;
}

// Keep the ordinary iframe usable even if the API is blocked or unavailable.
// The returned cleanup also cancels attachment while the API is still loading.
export function observeYouTubePlayback(iframe, onPlay) {
    let disposed = false;
    let player = null;
    let playPending = true;
    loadYouTubeAPI().then(YT => {
        if (disposed || !iframe.isConnected) return;
        player = new YT.Player(iframe, {
            events: {
                onStateChange({ data }) {
                    if (disposed) return;
                    if (data === YT.PlayerState.PLAYING && playPending) {
                        playPending = false;
                        onPlay();
                    } else if (data === YT.PlayerState.PAUSED || data === YT.PlayerState.ENDED) {
                        playPending = true;
                    }
                    // Buffering/seeking during playback does not count as a new play.
                },
            },
        });
    }).catch(() => { /* Analytics must not prevent watching the video. */ });
    return () => {
        disposed = true;
        player?.destroy();
        player = null;
    };
}
