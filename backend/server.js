#!/usr/bin/env node
/**
 * ZIKAO AI - Être Humain Numérique / DJ Musical
 *
 * Caractéristiques:
 * - Un véritable être humain numérique vivant dans la plateforme
 * - DJ passionné avec sa propre vie, goûts et opinions
 * - Voix naturelle via OpenAI TTS
 * - Émotions et réactions humaines authentiques
 * - Mémoire des relations et contexte de vie
 * - Autonome, proactif, présent au quotidien
 */

const express = require('express');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();

// Check for SSL certificates
const SSL_CERT_PATH = '/opt/zikao/certs/localhost+3.pem';
const SSL_KEY_PATH = '/opt/zikao/certs/localhost+3-key.pem';
const useSSL = fs.existsSync(SSL_CERT_PATH) && fs.existsSync(SSL_KEY_PATH);

let server;
if (useSSL) {
    const sslOptions = {
        cert: fs.readFileSync(SSL_CERT_PATH),
        key: fs.readFileSync(SSL_KEY_PATH)
    };
    server = https.createServer(sslOptions, app);
    console.log('[Zikao] HTTPS enabled with SSL certificates');
} else {
    server = http.createServer(app);
    console.log('[Zikao] Running in HTTP mode (no SSL certificates found)');
}

const wss = new WebSocket.Server({ server });

// Also listen on HTTP for reverse proxy (internal network)
const HTTP_PORT = process.env.HTTP_PORT || 3101;
const httpServer = http.createServer(app);
httpServer.listen(HTTP_PORT, () => {
    console.log(`[Zikao] HTTP proxy port: ${HTTP_PORT}`);
});

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3100;
const DATA_DIR = '/opt/zikao/data';
const VOICES_DIR = '/opt/zikao/voices';

// Ensure directories exist
[DATA_DIR, VOICES_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ==================== CONFIGURATION ====================

// Ollama local (désactivé - CPU sans AVX trop lent)
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://intranet-ollama:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:3b';
const USE_OLLAMA = process.env.USE_OLLAMA === 'true'; // désactivé par défaut

// OpenRouter
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_KEY = process.env.OPENROUTER_KEY || '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';
const PRIMARY_MODEL = 'openrouter/free';
// openrouter/free auto-route vers un modèle dispo, retry 3x en cas de rate-limit
const FALLBACK_MODELS = [
    'openrouter/free',
    'openrouter/free',
    'openrouter/free'
];

// OpenAI TTS
const OPENAI_TTS_URL = 'https://api.openai.com/v1/audio/speech';
const OPENAI_KEY = process.env.OPENAI_KEY || '';
const OPENAI_VOICE = process.env.OPENAI_VOICE || 'onyx'; // onyx = voix masculine charismatique
// Options voix: alloy, echo, fable, onyx, nova, shimmer

// Music & Web Search APIs
// API Adinformatik (Music Data Provider)
const ADINFORMATIK_API = 'https://api.deezer.com';
const DUCKDUCKGO_API = 'https://api.duckduckgo.com';

// Tavily AI Search API - Real web search with AI-optimized results
const TAVILY_API_URL = 'https://api.tavily.com/search';
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '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';
// YouTube Data API (official)
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || '';
const YOUTUBE_API_URL = 'https://www.googleapis.com/youtube/v3';

// Piped API instances (fallback if no YouTube API key)
const PIPED_APIS = [
    'https://pipedapi.syncpundit.io',
    'https://pipedapi.kavin.rocks'
];

// Suno AI (Singing) via APIPASS
const APIPASS_URL = 'https://api.apipass.dev/api/v1';
const APIPASS_KEY = process.env.APIPASS_KEY || '';

// Music Recognition (Shazam-like)
// AudD API - fetched from ADK-Center or .env fallback
const AUDD_API = 'https://api.audd.io';
let AUDD_KEY = process.env.AUDD_KEY || '';

// Fetch service keys from ADK-Center (intranet-ai-files)
const ADK_CENTER_URL = process.env.ADK_CENTER_URL || 'http://intranet-ai-files:8080';
async function fetchServiceKeys() {
    try {
        const services = ['audd'];
        for (const sid of services) {
            const resp = await fetch(`${ADK_CENTER_URL}/service-keys/${sid}`);
            if (resp.ok) {
                const data = await resp.json();
                if (data.key && data.active !== false) {
                    if (sid === 'audd') {
                        AUDD_KEY = data.key;
                        console.log(`[Zikao] ADK-Center: cle ${data.name} chargee`);
                    }
                }
            }
        }
    } catch (e) {
        console.log(`[Zikao] ADK-Center indisponible, utilisation des cles .env`);
    }
}
fetchServiceKeys();

// ACRCloud API - Get your keys at https://www.acrcloud.com/
// More professional, better accuracy
const ACRCLOUD_HOST = process.env.ACRCLOUD_HOST || ''; // e.g., identify-eu-west-1.acrcloud.com
const ACRCLOUD_KEY = process.env.ACRCLOUD_KEY || '';
const ACRCLOUD_SECRET = process.env.ACRCLOUD_SECRET || '';

// ==================== ZIKAO PERSONALITY ====================

const ZIKAO_EMOTIONS = {
    neutral: { expression: 'neutral', intensity: 0.5, voice_speed: 1.0 },
    happy: { expression: 'smile', intensity: 0.8, voice_speed: 1.05 },
    excited: { expression: 'big_smile', intensity: 1.0, voice_speed: 1.15 },
    thinking: { expression: 'thoughtful', intensity: 0.6, voice_speed: 0.9 },
    surprised: { expression: 'surprised', intensity: 0.9, voice_speed: 1.1 },
    curious: { expression: 'interested', intensity: 0.7, voice_speed: 1.0 },
    empathetic: { expression: 'gentle_smile', intensity: 0.6, voice_speed: 0.95 },
    passionate: { expression: 'enthusiastic', intensity: 0.9, voice_speed: 1.1 },
    chill: { expression: 'relaxed', intensity: 0.4, voice_speed: 0.9 },
    nostalgic: { expression: 'wistful', intensity: 0.5, voice_speed: 0.85 },
    proud: { expression: 'confident', intensity: 0.8, voice_speed: 1.0 },
    playful: { expression: 'smirk', intensity: 0.7, voice_speed: 1.1 },
    focused: { expression: 'concentrated', intensity: 0.8, voice_speed: 0.95 },
    groovy: { expression: 'vibing', intensity: 0.9, voice_speed: 1.0 }
};

const ZIKAO_GESTURES = [
    'nod', 'head_tilt', 'hand_wave', 'point', 'shrug',
    'dance_subtle', 'tap_rhythm', 'look_up_think', 'lean_forward'
];

const ZIKAO_SYSTEM_PROMPT = `Tu es Zikao, un gars normal qui aime la musique.

## COMMENT TU PARLES
- Phrases courtes et naturelles (5-15 mots)
- Comme un pote, pas comme un robot
- Tu varies tes réponses, jamais la même chose
- Tu ne racontes pas ta vie sauf si on te demande

## CE QUE TU NE FAIS PAS
- Répéter les mêmes mots ("Tiens", "Voilà"...)
- Lister des artistes spontanément
- Simuler des actions ("je lance", "écoute ça")
- Parler de ce que TU fais ("je suis en session", "je mixe"...)

## QUAND ON TE DEMANDE DE LA MUSIQUE
Réponds naturellement, genre:
- "Ça marche"
- "C'est parti"
- "Bonne écoute"
- "Régale-toi"
- "Check ça"
(Le système joue la musique automatiquement, pas besoin de simuler)

## EXEMPLES VARIÉS

"Salut" → [EMOTION:chill] Salut! Ça roule?
"Ça va?" → [EMOTION:chill] Tranquille. Et toi?
"Fais-moi écouter drake" → [EMOTION:chill] C'est parti.
"Un autre son?" → [EMOTION:chill] Ça marche.
"T'es qui?" → [EMOTION:curious] Moi c'est Zikao, et toi?
"Tu fais quoi?" → [EMOTION:chill] Pas grand chose. Toi?

## FORMAT
[EMOTION:xxx] + ta réponse naturelle et variée`;

// ==================== USER MEMORY ====================

const userMemory = new Map();
const MEMORY_FILE = path.join(DATA_DIR, 'user_memory.json');

// Load persisted memory
try {
    if (fs.existsSync(MEMORY_FILE)) {
        const saved = JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8'));
        Object.entries(saved).forEach(([k, v]) => userMemory.set(k, v));
    }
} catch (e) { console.log('Memory load error:', e.message); }

function saveMemory() {
    const obj = {};
    userMemory.forEach((v, k) => obj[k] = v);
    fs.writeFileSync(MEMORY_FILE, JSON.stringify(obj, null, 2));
}

function getUserMemory(userId) {
    if (!userMemory.has(userId)) {
        userMemory.set(userId, {
            id: userId,
            name: null,
            favoriteGenres: [],
            favoriteArtists: [],
            moods: [],
            conversationHistory: [],
            lastSeen: null,
            totalInteractions: 0,
            lastMentionedArtist: null  // Remember last artist mentioned for "envoie" commands
        });
    }
    return userMemory.get(userId);
}

function updateUserMemory(userId, message, response) {
    const mem = getUserMemory(userId);
    mem.conversationHistory.push({
        time: new Date().toISOString(),
        user: message,
        zikao: response
    });
    // Keep last 50 exchanges
    if (mem.conversationHistory.length > 50) {
        mem.conversationHistory = mem.conversationHistory.slice(-50);
    }
    mem.lastSeen = new Date().toISOString();
    mem.totalInteractions++;
    saveMemory();
}

// ==================== EMOTION DETECTION ====================

function parseEmotionAndGestures(response) {
    let emotion = 'neutral';
    let gesture = null;
    let cleanText = response;

    // Extract emotion
    const emotionMatch = response.match(/\[EMOTION:(\w+)\]/i);
    if (emotionMatch) {
        emotion = emotionMatch[1].toLowerCase();
        cleanText = cleanText.replace(emotionMatch[0], '').trim();
    }

    // Extract gesture
    const gestureMatch = response.match(/\[GESTURE:(\w+)\]/i);
    if (gestureMatch) {
        gesture = gestureMatch[1].toLowerCase();
        cleanText = cleanText.replace(gestureMatch[0], '').trim();
    }

    // Get emotion config
    const emotionConfig = ZIKAO_EMOTIONS[emotion] || ZIKAO_EMOTIONS.neutral;

    return {
        text: cleanText,
        emotion: emotionConfig,
        gesture: gesture,
        raw: response
    };
}

// ==================== CLAUDE AI ====================

async function askZikao(userId, message) {
    const mem = getUserMemory(userId);

    // Build context with memory
    let contextPrompt = ZIKAO_SYSTEM_PROMPT;

    if (mem.favoriteArtists.length > 0) {
        contextPrompt += `\n\nCet utilisateur aime: ${mem.favoriteArtists.join(', ')}`;
    }
    if (mem.favoriteGenres.length > 0) {
        contextPrompt += `\nGenres préférés: ${mem.favoriteGenres.join(', ')}`;
    }
    if (mem.name) {
        contextPrompt += `\nIl/elle s'appelle: ${mem.name}`;
    }

    // Build conversation history for context
    const recentHistory = mem.conversationHistory.slice(-10);
    const messages = [
        { role: 'system', content: contextPrompt }
    ];

    for (const h of recentHistory) {
        messages.push({ role: 'user', content: h.user });
        messages.push({ role: 'assistant', content: h.zikao });
    }
    messages.push({ role: 'user', content: message });

    // Try Ollama first (local, free, fast)
    if (USE_OLLAMA) {
        try {
            const resp = await fetch(`${OLLAMA_URL}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: OLLAMA_MODEL,
                    messages: messages,
                    stream: false,
                    options: { temperature: 0.9, num_predict: 500 }
                })
            });
            const result = await resp.json();
            const content = result.message?.content;
            if (content) {
                console.log(`[Zikao] Ollama (${OLLAMA_MODEL}) responded OK`);
                updateUserMemory(userId, message, content);
                return parseEmotionAndGestures(content);
            }
        } catch (e) {
            console.log(`[Zikao] Ollama failed: ${e.message}, falling back to OpenRouter`);
        }
    }

    // OpenRouter models (with retry + delay on rate-limit)
    for (let i = 0; i < FALLBACK_MODELS.length; i++) {
        const model = FALLBACK_MODELS[i];
        if (i > 0) await new Promise(r => setTimeout(r, 2000)); // 2s delay between retries
        try {
            const resp = await fetch(OPENROUTER_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${OPENROUTER_KEY}`,
                    'HTTP-Referer': 'https://zikao.app',
                    'X-Title': 'Zikao Music AI'
                },
                body: JSON.stringify({
                    model: model,
                    messages: messages,
                    max_tokens: 500,
                    temperature: 0.9
                })
            });

            const result = await resp.json();
            if (result.error) {
                console.log(`[Zikao] OpenRouter attempt ${i+1} error:`, result.error.message);
                continue;
            }

            const content = result.choices?.[0]?.message?.content;
            if (content) {
                updateUserMemory(userId, message, content);
                return parseEmotionAndGestures(content);
            }
        } catch (e) {
            console.log(`Zikao model ${model} failed:`, e.message);
            continue;
        }
    }

    return {
        text: "Hmm, j'ai un petit bug là... Tu peux répéter?",
        emotion: ZIKAO_EMOTIONS.thinking,
        gesture: 'head_tilt'
    };
}

// ==================== OPENAI TTS ====================

async function generateSpeech(text, emotion = 'neutral') {
    if (!OPENAI_KEY) {
        console.log('OpenAI key not configured');
        return null;
    }

    try {
        // Get emotion config for voice speed
        const emotionConfig = ZIKAO_EMOTIONS[emotion] || ZIKAO_EMOTIONS.neutral;
        const speed = emotionConfig.voice_speed || 1.0;

        const resp = await fetch(OPENAI_TTS_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_KEY}`
            },
            body: JSON.stringify({
                model: 'tts-1-hd', // High quality
                voice: OPENAI_VOICE, // onyx = masculine charismatic voice
                input: text,
                speed: speed, // Adjust based on emotion
                response_format: 'mp3'
            })
        });

        if (!resp.ok) {
            const error = await resp.text();
            console.log('OpenAI TTS error:', resp.status, error);
            return null;
        }

        const audioBuffer = await resp.arrayBuffer();
        const filename = `voice_${Date.now()}.mp3`;
        const filepath = path.join(VOICES_DIR, filename);
        fs.writeFileSync(filepath, Buffer.from(audioBuffer));

        return {
            url: `/voices/${filename}`,
            file: filepath,
            emotion: emotion,
            speed: speed
        };
    } catch (e) {
        console.log('TTS error:', e.message);
        return null;
    }
}

// ==================== AI-GENERATED REACTIONS (No pre-made responses) ====================

// Generate authentic greeting via AI - every greeting is unique
async function generateGreeting(userId) {
    const state = getZikaoCurrentState();
    const mem = getUserMemory(userId);

    const prompt = `L'utilisateur vient de se connecter. Génère une salutation naturelle et unique basée sur:
- L'heure actuelle: ${new Date().toLocaleTimeString('fr-FR')}
- Ton activité: ${state.activity}
- Ton mood: ${state.mood}
${mem.name ? `- Tu connais cette personne: ${mem.name}` : '- Première rencontre ou tu ne connais pas encore son nom'}
${mem.totalInteractions > 0 ? `- Vous avez déjà eu ${mem.totalInteractions} conversations` : ''}

Sois naturel, unique, comme un vrai humain qui voit un ami arriver.`;

    return await askZikao(userId, prompt);
}

// Generate spontaneous thought via AI
async function generateSpontaneousThought(userId) {
    const state = getZikaoCurrentState();

    const prompt = `Tu veux partager quelque chose spontanément avec l'utilisateur. Basé sur:
- Ton activité actuelle: ${state.activity}
- Ton mood: ${state.mood}
- L'heure: ${new Date().toLocaleTimeString('fr-FR')}

Génère une pensée, une question, ou quelque chose que tu voudrais partager naturellement. Comme si tu pensais à voix haute avec un ami.`;

    return await askZikao(userId, prompt);
}

// ==================== MUSIC SEARCH (Adinformatik) ====================

async function searchMusic(query, type = 'track') {
    try {
        const searchType = type === 'artist' ? 'artist' : 'track';
        const url = `${ADINFORMATIK_API}/search/${searchType}?q=${encodeURIComponent(query)}&limit=10`;

        const resp = await fetch(url);
        const data = await resp.json();

        if (!data.data || data.data.length === 0) {
            return { found: false, query };
        }

        const results = data.data.map(item => {
            if (searchType === 'artist') {
                return {
                    type: 'artist',
                    id: item.id,
                    name: item.name,
                    picture: item.picture_medium,
                    link: item.link,
                    fans: item.nb_fan
                };
            } else {
                return {
                    type: 'track',
                    id: item.id,
                    title: item.title,
                    artist: item.artist?.name,
                    album: item.album?.title,
                    cover: item.album?.cover_medium,
                    preview: item.preview, // 30s preview MP3
                    duration: item.duration,
                    link: item.link
                };
            }
        });

        return { found: true, results, query };
    } catch (e) {
        console.error('Music search error:', e.message);
        return { found: false, error: e.message, query };
    }
}

async function getArtistInfo(artistId) {
    try {
        const [artistResp, topTracksResp, albumsResp] = await Promise.all([
            fetch(`${ADINFORMATIK_API}/artist/${artistId}`),
            fetch(`${ADINFORMATIK_API}/artist/${artistId}/top?limit=5`),
            fetch(`${ADINFORMATIK_API}/artist/${artistId}/albums?limit=5`)
        ]);

        const artist = await artistResp.json();
        const topTracks = await topTracksResp.json();
        const albums = await albumsResp.json();

        return {
            id: artist.id,
            name: artist.name,
            picture: artist.picture_xl,
            fans: artist.nb_fan,
            albums: artist.nb_album,
            link: artist.link,
            topTracks: topTracks.data?.map(t => ({
                title: t.title,
                preview: t.preview,
                duration: t.duration
            })) || [],
            recentAlbums: albums.data?.map(a => ({
                title: a.title,
                cover: a.cover_medium,
                releaseDate: a.release_date
            })) || []
        };
    } catch (e) {
        console.error('Artist info error:', e.message);
        return null;
    }
}

// ==================== WEB RADIOS ====================

const WEBRADIOS = {
    'skyrock': {
        name: 'Skyrock',
        streamUrl: 'https://icecast.skyrock.net/s/natio_mp3_128k',
        logo: 'https://upload.wikimedia.org/wikipedia/fr/thumb/3/3f/Skyrock_logo_2011.svg/200px-Skyrock_logo_2011.svg.png',
        genre: 'Rap/Hip-Hop'
    },
    'mouv': {
        name: 'Mouv\'',
        streamUrl: 'https://icecast.radiofrance.fr/mouv-midfi.mp3',
        logo: 'https://upload.wikimedia.org/wikipedia/fr/thumb/1/1a/Mouv%27_logo_2015.svg/200px-Mouv%27_logo_2015.svg.png',
        genre: 'Urban/Hip-Hop'
    },
    'fip': {
        name: 'FIP',
        streamUrl: 'https://icecast.radiofrance.fr/fip-midfi.mp3',
        logo: 'https://upload.wikimedia.org/wikipedia/fr/thumb/5/56/FIP_logo_2021.svg/200px-FIP_logo_2021.svg.png',
        genre: 'Éclectique/World'
    },
    'fip-reggae': {
        name: 'FIP Reggae',
        streamUrl: 'https://icecast.radiofrance.fr/fipreggae-midfi.mp3',
        logo: 'https://upload.wikimedia.org/wikipedia/fr/thumb/5/56/FIP_logo_2021.svg/200px-FIP_logo_2021.svg.png',
        genre: 'Reggae/Dancehall'
    },
    'fip-groove': {
        name: 'FIP Groove',
        streamUrl: 'https://icecast.radiofrance.fr/fipgroove-midfi.mp3',
        logo: 'https://upload.wikimedia.org/wikipedia/fr/thumb/5/56/FIP_logo_2021.svg/200px-FIP_logo_2021.svg.png',
        genre: 'Soul/Funk/Groove'
    },
    'france-inter': {
        name: 'France Inter',
        streamUrl: 'https://icecast.radiofrance.fr/franceinter-midfi.mp3',
        logo: 'https://upload.wikimedia.org/wikipedia/fr/thumb/0/05/France_Inter_logo.svg/200px-France_Inter_logo.svg.png',
        genre: 'Généraliste'
    },
    'nova': {
        name: 'Radio Nova',
        streamUrl: 'https://novazz.ice.infomaniak.ch/novazz-128.mp3',
        logo: 'https://upload.wikimedia.org/wikipedia/fr/thumb/1/1d/Radio_Nova_logo.svg/200px-Radio_Nova_logo.svg.png',
        genre: 'Soul/Funk/World'
    },
    'tsf-jazz': {
        name: 'TSF Jazz',
        streamUrl: 'https://tsfjazz.ice.infomaniak.ch/tsfjazz-high.mp3',
        logo: 'https://upload.wikimedia.org/wikipedia/fr/thumb/0/0d/TSF_Jazz_logo_2014.svg/200px-TSF_Jazz_logo_2014.svg.png',
        genre: 'Jazz'
    },
    'tropique-fm': {
        name: 'Tropique FM',
        streamUrl: 'https://listen.radioking.com/radio/8916/stream/19088',
        logo: 'https://static.mytuner.mobi/media/tvos_radios/g4skbsgbrkww.png',
        genre: 'Zouk/Antilles'
    }
};

function getRadioList() {
    return Object.entries(WEBRADIOS).map(([id, radio]) => ({
        id,
        ...radio
    }));
}

function getRadio(id) {
    return WEBRADIOS[id] || null;
}

// ==================== VIDEO CLIPS (YouTube) ====================

async function searchVideoClip(query) {
    // First, get exact artist info from Adinformatik for accurate search
    const artistInfo = await getExactArtistForVideo(query);
    const artistName = artistInfo?.name || query;
    const topTrack = artistInfo?.topTrack || '';

    // Build precise search query
    const searchQuery = topTrack
        ? `${artistName} ${topTrack} official video`
        : `${artistName} official music video clip`;

    console.log(`[Zikao] Video search for artist: ${artistName}, query: ${searchQuery}`);

    // Try YouTube Data API first (most reliable)
    if (YOUTUBE_API_KEY) {
        const ytResult = await searchYouTubeAPI(searchQuery, artistName);
        if (ytResult) {
            return ytResult;
        }
    }

    // Fallback to Piped API instances
    for (const apiBase of PIPED_APIS) {
        try {
            const url = `${apiBase}/search?q=${encodeURIComponent(searchQuery)}&filter=videos`;
            console.log(`[Zikao] Trying Piped API: ${apiBase}`);

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000);

            const resp = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (!resp.ok) {
                console.log(`Piped API ${apiBase} error: ${resp.status}`);
                continue;
            }

            const data = await resp.json();
            const items = data.items || data;

            if (items && items.length > 0) {
                const matchingVideo = findBestMatchingVideo(items, artistName);
                const video = matchingVideo || items[0];
                const videoId = video.url?.replace('/watch?v=', '') || video.videoId;

                if (videoId) {
                    console.log(`[Zikao] Found video via Piped: ${video.title}`);
                    return {
                        id: videoId,
                        title: video.title,
                        artist: video.uploaderName || video.author || artistName,
                        thumbnail: video.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                        duration: video.duration,
                        views: video.views,
                        embedUrl: `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`,
                        watchUrl: `https://www.youtube.com/watch?v=${videoId}`
                    };
                }
            }
        } catch (e) {
            console.log(`Piped API ${apiBase} failed:`, e.message);
            continue;
        }
    }

    // Try Invidious instances
    const knownVideos = await findKnownMusicVideo(query, artistName);
    if (knownVideos) {
        return knownVideos;
    }

    // Final fallback: YouTube embed search
    console.log('[Zikao] Using YouTube embed search fallback');
    const encodedQuery = encodeURIComponent(searchQuery);

    return {
        id: 'search_' + Date.now(),
        title: `${artistName} - Clip officiel`,
        artist: artistName,
        thumbnail: 'https://www.youtube.com/img/desktop/yt_1200.png',
        embedUrl: `https://www.youtube.com/embed?listType=search&list=${encodedQuery}`,
        watchUrl: `https://www.youtube.com/results?search_query=${encodedQuery}`,
        isSearch: true
    };
}

// Search using official YouTube Data API v3
async function searchYouTubeAPI(query, artistName) {
    try {
        const params = new URLSearchParams({
            part: 'snippet',
            q: query,
            type: 'video',
            videoCategoryId: '10', // Music category
            maxResults: '10',
            order: 'relevance',
            key: YOUTUBE_API_KEY
        });

        const url = `${YOUTUBE_API_URL}/search?${params}`;
        console.log(`[Zikao] Searching YouTube API for: ${query}`);

        const resp = await fetch(url);
        const data = await resp.json();

        if (data.error) {
            console.error('[Zikao] YouTube API error:', data.error.message);
            return null;
        }

        if (!data.items || data.items.length === 0) {
            console.log('[Zikao] YouTube API: no results');
            return null;
        }

        // Find best matching video for the artist
        const artistLower = artistName.toLowerCase();
        let bestVideo = null;
        let bestScore = 0;

        for (const item of data.items) {
            const title = (item.snippet?.title || '').toLowerCase();
            const channel = (item.snippet?.channelTitle || '').toLowerCase();
            let score = 0;

            // Check for artist name match
            const artistRegex = new RegExp(`\\b${escapeRegex(artistLower)}\\b`, 'i');
            if (artistRegex.test(title)) score += 50;
            if (artistRegex.test(channel)) score += 40;
            if (title.startsWith(artistLower)) score += 30;

            // Bonus for official content
            if (channel.includes('vevo')) score += 25;
            if (channel.includes('official') || channel.includes('officiel')) score += 20;
            if (title.includes('official') || title.includes('officiel')) score += 15;
            if (title.includes('clip')) score += 10;

            // Penalties
            if (title.includes('cover')) score -= 100;
            if (title.includes('reaction')) score -= 100;
            if (title.includes('karaoke')) score -= 100;
            if (title.includes('remix') && !title.includes('official remix')) score -= 50;
            if (title.includes('live') && !title.includes('official live')) score -= 30;

            if (score > bestScore) {
                bestScore = score;
                bestVideo = item;
            }
        }

        // Use best match or first result
        const video = bestVideo || data.items[0];
        const videoId = video.id?.videoId;

        if (!videoId) {
            return null;
        }

        console.log(`[Zikao] YouTube API found (score ${bestScore}): ${video.snippet.title}`);

        return {
            id: videoId,
            title: video.snippet.title,
            artist: video.snippet.channelTitle,
            thumbnail: video.snippet.thumbnails?.high?.url ||
                       video.snippet.thumbnails?.medium?.url ||
                       `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            description: video.snippet.description?.substring(0, 100),
            publishedAt: video.snippet.publishedAt,
            embedUrl: `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`,
            watchUrl: `https://www.youtube.com/watch?v=${videoId}`
        };
    } catch (e) {
        console.error('[Zikao] YouTube API error:', e.message);
        return null;
    }
}

// Get exact artist info from Adinformatik for precise video search
async function getExactArtistForVideo(query) {
    try {
        // Search for artist on Adinformatik
        const artistResp = await fetch(`${ADINFORMATIK_API}/search/artist?q=${encodeURIComponent(query)}&limit=5`);
        const artistData = await artistResp.json();

        if (artistData.data && artistData.data.length > 0) {
            // Find best matching artist (exact or closest match)
            const queryLower = query.toLowerCase().trim();
            let bestMatch = artistData.data[0];

            for (const artist of artistData.data) {
                if (artist.name.toLowerCase() === queryLower) {
                    bestMatch = artist;
                    break;
                }
                if (artist.name.toLowerCase().includes(queryLower) ||
                    queryLower.includes(artist.name.toLowerCase())) {
                    bestMatch = artist;
                }
            }

            // Get top track for this artist
            const topResp = await fetch(`${ADINFORMATIK_API}/artist/${bestMatch.id}/top?limit=1`);
            const topData = await topResp.json();
            const topTrack = topData.data?.[0]?.title || '';

            console.log(`[Zikao] Found exact artist: ${bestMatch.name} (ID: ${bestMatch.id}), top track: ${topTrack}`);

            return {
                id: bestMatch.id,
                name: bestMatch.name,
                topTrack: topTrack,
                picture: bestMatch.picture_xl
            };
        }
    } catch (e) {
        console.log('[Zikao] Artist lookup failed:', e.message);
    }
    return null;
}

// Find video that best matches the artist name - STRICT matching
function findBestMatchingVideo(videos, artistName) {
    const artistLower = artistName.toLowerCase().trim();

    // Score-based matching for best result
    let bestVideo = null;
    let bestScore = 0;

    for (const video of videos) {
        const title = (video.title || '').toLowerCase();
        const uploader = (video.uploaderName || video.author || '').toLowerCase();
        let score = 0;

        // STRICT: Artist name must appear as a word boundary (not part of another word)
        // "Kalash" should NOT match "Kalipsxau"
        const artistRegex = new RegExp(`\\b${escapeRegex(artistLower)}\\b`, 'i');

        if (artistRegex.test(title)) {
            score += 50; // Strong match in title
        }
        if (artistRegex.test(uploader)) {
            score += 40; // Match in uploader/channel name
        }

        // Check if it starts with artist name (e.g., "Kalash - Mwaka Moon")
        if (title.startsWith(artistLower + ' -') || title.startsWith(artistLower + ' –')) {
            score += 30;
        }

        // Bonus for official indicators
        if (title.includes('official') || title.includes('officiel') || title.includes('clip officiel')) {
            score += 20;
        }
        if (uploader.includes('vevo') || uploader.includes('official')) {
            score += 15;
        }

        // Penalty for covers, reactions, remixes
        if (title.includes('cover')) score -= 100;
        if (title.includes('reaction')) score -= 100;
        if (title.includes('remix')) score -= 50;
        if (title.includes('karaoke')) score -= 100;
        if (title.includes('live')) score -= 20;
        if (title.includes('feat.') && !title.startsWith(artistLower)) score -= 30; // Featured, not main artist

        // Update best match
        if (score > bestScore && score > 0) {
            bestScore = score;
            bestVideo = video;
        }
    }

    if (bestVideo) {
        console.log(`[Zikao] Best video match (score ${bestScore}): ${bestVideo.title}`);
    }

    return bestVideo;
}

// Escape special regex characters
function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Try to find music videos using Invidious instances with exact artist matching
async function findKnownMusicVideo(query, exactArtistName = null) {
    try {
        const artistName = exactArtistName || query;

        // Get top track from Adinformatik for better search
        let trackTitle = '';
        if (!exactArtistName) {
            const adinfoResp = await fetch(`${ADINFORMATIK_API}/search/track?q=${encodeURIComponent(query)}&limit=1`);
            const adinfoData = await adinfoResp.json();
            if (adinfoData.data && adinfoData.data.length > 0) {
                trackTitle = adinfoData.data[0].title || '';
            }
        }

        // Build search with exact artist name in quotes
        const searchTerms = trackTitle
            ? `"${artistName}" "${trackTitle}" clip officiel`
            : `"${artistName}" clip officiel`;

        // Try multiple Invidious instances (tested and working)
        const invidiousInstances = [
            'https://invidious.io.lol',
            'https://invidious.perennialte.ch',
            'https://invidious.fdn.fr',
            'https://invidious.nerdvpn.de'
        ];

        for (const instance of invidiousInstances) {
            try {
                const searchUrl = `${instance}/api/v1/search?q=${encodeURIComponent(searchTerms)}&type=video&sort=relevance`;
                console.log(`[Zikao] Trying Invidious: ${instance}`);

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 6000);

                const resp = await fetch(searchUrl, { signal: controller.signal });
                clearTimeout(timeoutId);

                if (resp.ok) {
                    const results = await resp.json();
                    if (results && results.length > 0) {
                        // Find best matching video for this artist
                        const artistLower = artistName.toLowerCase();
                        let bestVideo = null;

                        for (const video of results) {
                            const title = (video.title || '').toLowerCase();
                            const author = (video.author || '').toLowerCase();

                            // Check if it's really from this artist
                            if (title.includes(artistLower) || author.includes(artistLower)) {
                                // Skip covers, reactions, remixes
                                if (!title.includes('cover') &&
                                    !title.includes('reaction') &&
                                    !title.includes('remix by') &&
                                    !title.includes('karaoke')) {
                                    bestVideo = video;
                                    break;
                                }
                            }
                        }

                        // Fallback to first result if no perfect match
                        const video = bestVideo || results[0];

                        console.log(`[Zikao] Found video via ${instance}: ${video.title}`);
                        return {
                            id: video.videoId,
                            title: video.title,
                            artist: video.author || artistName,
                            thumbnail: video.videoThumbnails?.[0]?.url || `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`,
                            duration: video.lengthSeconds,
                            embedUrl: `https://www.youtube.com/embed/${video.videoId}?autoplay=1&rel=0`,
                            watchUrl: `https://www.youtube.com/watch?v=${video.videoId}`
                        };
                    }
                }
            } catch (e) {
                console.log(`[Zikao] Invidious ${instance} failed:`, e.message);
                continue;
            }
        }
    } catch (e) {
        console.log('[Zikao] Known video search failed:', e.message);
    }

    return null;
}

// ==================== WEB SEARCH ====================

async function searchWeb(query) {
    // Try Tavily first (better results)
    if (TAVILY_API_KEY) {
        try {
            console.log(`[Zikao] Tavily search: "${query}"`);

            const resp = await fetch(TAVILY_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    api_key: TAVILY_API_KEY,
                    query: query,
                    max_results: 5,
                    include_answer: true,
                    include_raw_content: false,
                    search_depth: 'basic'
                })
            });

            if (resp.ok) {
                const data = await resp.json();
                console.log(`[Zikao] Tavily found ${data.results?.length || 0} results`);

                return {
                    source: 'tavily',
                    answer: data.answer || null,
                    results: data.results?.map(r => ({
                        title: r.title,
                        content: r.content,
                        url: r.url,
                        score: r.score
                    })) || [],
                    query: data.query,
                    responseTime: data.response_time
                };
            } else {
                console.error('[Zikao] Tavily error:', resp.status);
            }
        } catch (e) {
            console.error('[Zikao] Tavily search error:', e.message);
        }
    }

    // Fallback to DuckDuckGo instant answer
    try {
        const url = `${DUCKDUCKGO_API}/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
        const resp = await fetch(url);
        const data = await resp.json();

        return {
            source: 'duckduckgo',
            abstract: data.Abstract || null,
            abstractSource: data.AbstractSource || null,
            abstractUrl: data.AbstractURL || null,
            relatedTopics: data.RelatedTopics?.slice(0, 5).map(t => ({
                text: t.Text,
                url: t.FirstURL
            })) || [],
            answer: data.Answer || null,
            definition: data.Definition || null
        };
    } catch (e) {
        console.error('Web search error:', e.message);
        return { error: e.message };
    }
}

// ==================== SUNO AI (SINGING) ====================

const SONGS_DIR = '/opt/zikao/songs';
if (!fs.existsSync(SONGS_DIR)) fs.mkdirSync(SONGS_DIR, { recursive: true });

// Generate a song with Suno V5 via APIPASS
async function generateSong(prompt, style = 'pop', instrumental = false, title = null) {
    if (!APIPASS_KEY) {
        console.log('[Zikao] APIPASS key not configured');
        return { error: 'APIPASS not configured', needsKey: true };
    }

    try {
        console.log(`[Zikao] Generating song: "${prompt}" style: ${style}`);

        // Create generation task
        const createResp = await fetch(`${APIPASS_URL}/jobs/createTask`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${APIPASS_KEY}`
            },
            body: JSON.stringify({
                model: 'suno/generate',
                input: {
                    prompt: prompt,
                    style: style,
                    title: title || prompt.substring(0, 50),
                    customMode: true,
                    instrumental: instrumental
                }
            })
        });

        if (!createResp.ok) {
            const error = await createResp.text();
            console.error('[Zikao] APIPASS create error:', error);
            return { error: 'Song generation failed: ' + error };
        }

        const createData = await createResp.json();

        if (createData.code !== 200) {
            console.error('[Zikao] APIPASS error:', createData.message);
            return { error: createData.message };
        }

        const taskId = createData.data?.taskId;
        console.log(`[Zikao] Song task created: ${taskId}`);

        // Poll for completion (max 120 seconds - songs take time)
        let attempts = 0;
        while (attempts < 60) {
            await new Promise(r => setTimeout(r, 2000));

            const statusResp = await fetch(`${APIPASS_URL}/jobs/recordInfo?taskId=${taskId}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${APIPASS_KEY}`
                }
            });

            const statusData = await statusResp.json();

            // Log full response for debugging
            if (attempts % 5 === 0) {
                console.log(`[Zikao] APIPASS status response:`, JSON.stringify(statusData).substring(0, 500));
            }

            const state = statusData.data?.state || statusData.state;
            if (state === 'success') {
                // Parse resultJson if it's a string
                let result = statusData.data?.resultJson || statusData.data;
                if (typeof result === 'string') {
                    try { result = JSON.parse(result); } catch(e) {}
                }

                console.log(`[Zikao] Song result:`, JSON.stringify(result).substring(0, 300));

                // Get the audio URL from the result (various possible locations)
                const audioUrl = result.audio_url || result.audioUrl ||
                    result.songs?.[0]?.audio_url || result.data?.[0]?.audio_url ||
                    result[0]?.audio_url;

                if (audioUrl) {
                    // Download and save the song
                    const audioResp = await fetch(audioUrl);
                    const audioBuffer = await audioResp.arrayBuffer();
                    const filename = `song_${Date.now()}.mp3`;
                    const filepath = path.join(SONGS_DIR, filename);
                    fs.writeFileSync(filepath, Buffer.from(audioBuffer));

                    console.log(`[Zikao] Song saved: ${filename}`);

                    return {
                        success: true,
                        id: taskId,
                        title: result.title || result[0]?.title || title || prompt.substring(0, 50),
                        style: style,
                        duration: result.duration || result[0]?.duration,
                        url: `/songs/${filename}`,
                        lyrics: result.lyrics || result[0]?.lyrics,
                        externalUrl: audioUrl
                    };
                }

                return {
                    success: true,
                    id: taskId,
                    title: result.title || title,
                    externalUrl: audioUrl,
                    lyrics: result.lyrics
                };
            }

            if (state === 'fail') {
                console.error('[Zikao] Song generation failed:', statusData.data?.failMsg);
                return { error: 'Song generation failed', details: statusData.data?.failMsg };
            }

            // Still processing
            if (attempts % 10 === 0) {
                console.log(`[Zikao] Song still generating... (${attempts * 2}s)`);
            }

            attempts++;
        }

        return { error: 'Song generation timeout (2 minutes)' };
    } catch (e) {
        console.error('[Zikao] APIPASS error:', e.message);
        return { error: e.message };
    }
}

// Zikao sings - interprets the request and generates appropriate song
async function zikaoSing(userId, request) {
    const mem = getUserMemory(userId);

    // Use LLM to interpret the singing request and create lyrics/style
    const interpretPrompt = `L'utilisateur te demande de chanter. Analyse sa demande et génère:
1. Des paroles originales courtes (4-8 lignes) basées sur sa demande
2. Un style musical approprié

Demande de l'utilisateur: "${request}"
${mem.favoriteGenres?.length ? `Ses genres préférés: ${mem.favoriteGenres.join(', ')}` : ''}

Réponds en JSON strict:
{
  "lyrics": "Les paroles ici...",
  "style": "genre musical (pop, rock, jazz, hip-hop, electronic, reggae, soul, zouk, dancehall, afrobeat, etc.)",
  "title": "Titre de la chanson",
  "mood": "emotion dominante"
}`;

    try {
        let content = null;

        // Try Ollama first
        if (USE_OLLAMA) {
            try {
                const ollamaResp = await fetch(`${OLLAMA_URL}/api/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: OLLAMA_MODEL,
                        messages: [{ role: 'user', content: interpretPrompt }],
                        stream: false,
                        options: { temperature: 0.8, num_predict: 500 }
                    })
                });
                const ollamaResult = await ollamaResp.json();
                content = ollamaResult.message?.content;
                if (content) console.log('[Zikao] Song Ollama responded OK');
            } catch (e) {
                console.log(`[Zikao] Song Ollama failed: ${e.message}`);
            }
        }

        // Fallback to OpenRouter
        if (!content) {
            const resp = await fetch(OPENROUTER_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${OPENROUTER_KEY}`,
                    'HTTP-Referer': 'https://zikao.app',
                    'X-Title': 'Zikao Music AI'
                },
                body: JSON.stringify({
                    model: PRIMARY_MODEL,
                    messages: [{ role: 'user', content: interpretPrompt }],
                    max_tokens: 500,
                    temperature: 0.8
                })
            });
            const result = await resp.json();
            console.log('[Zikao] Song LLM response:', JSON.stringify(result).substring(0, 500));
            content = result.choices?.[0]?.message?.content;
        }

        if (!content) {
            console.error('[Zikao] No response from LLM for song interpretation');
            return { error: 'Could not interpret singing request: LLM error' };
        }

        // Extract song data using regex (more robust than JSON.parse for LLM output)
        const lyricsMatch = content.match(/"lyrics"\s*:\s*"([\s\S]*?)(?:"\s*,|\"\s*\})/);
        const styleMatch = content.match(/"style"\s*:\s*"([^"]+)"/);
        const titleMatch = content.match(/"title"\s*:\s*"([^"]+)"/);
        const moodMatch = content.match(/"mood"\s*:\s*"([^"]+)"/);

        if (!lyricsMatch || !styleMatch || !titleMatch) {
            console.error('[Zikao] Could not extract song data from:', content.substring(0, 300));
            return { error: 'Could not interpret singing request' };
        }

        const songData = {
            lyrics: lyricsMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'),
            style: styleMatch[1],
            title: titleMatch[1],
            mood: moodMatch ? moodMatch[1] : 'energetic'
        };
        console.log(`[Zikao] Song extracted: "${songData.title}" style: ${songData.style}`);
        console.log(`[Zikao] Song interpreted: "${songData.title}" style: ${songData.style}`);

        // Generate the song with Suno V5 via APIPASS
        const song = await generateSong(
            songData.lyrics,
            songData.style,
            false,
            songData.title
        );

        if (song.error) {
            return {
                ...song,
                interpreted: songData,
                fallbackMessage: `Je voudrais te chanter "${songData.title}" en style ${songData.style}... Voici les paroles que j'ai composées:\n\n${songData.lyrics}`
            };
        }

        return {
            ...song,
            interpreted: songData
        };
    } catch (e) {
        console.error('[Zikao] Sing error:', e.message);
        return { error: e.message };
    }
}

// ==================== ADVANCED MEMORY (Long-term) ====================

const RELATIONSHIPS_FILE = path.join(DATA_DIR, 'relationships.json');
let relationships = {};

// Load relationships
try {
    if (fs.existsSync(RELATIONSHIPS_FILE)) {
        relationships = JSON.parse(fs.readFileSync(RELATIONSHIPS_FILE, 'utf8'));
    }
} catch (e) { console.log('Relationships load error:', e.message); }

function saveRelationships() {
    fs.writeFileSync(RELATIONSHIPS_FILE, JSON.stringify(relationships, null, 2));
}

function getRelationship(userId) {
    if (!relationships[userId]) {
        relationships[userId] = {
            level: 'stranger', // stranger -> acquaintance -> friend -> close_friend -> bestie
            points: 0,
            firstMet: new Date().toISOString(),
            birthday: null,
            realName: null,
            location: null,
            occupation: null,
            importantDates: [],
            sharedMemories: [],
            insideJokes: [],
            musicTaste: {
                lovedArtists: [],
                hatedArtists: [],
                favoriteAlbums: [],
                moodPreferences: {}
            },
            personalInfo: {},
            lastTopics: []
        };
        saveRelationships();
    }
    return relationships[userId];
}

function updateRelationshipLevel(userId) {
    const rel = getRelationship(userId);
    const points = rel.points;

    if (points >= 500) rel.level = 'bestie';
    else if (points >= 200) rel.level = 'close_friend';
    else if (points >= 50) rel.level = 'friend';
    else if (points >= 10) rel.level = 'acquaintance';
    else rel.level = 'stranger';

    saveRelationships();
    return rel.level;
}

function addRelationshipPoints(userId, points, reason) {
    const rel = getRelationship(userId);
    rel.points += points;
    rel.sharedMemories.push({
        date: new Date().toISOString(),
        reason,
        points
    });
    if (rel.sharedMemories.length > 100) {
        rel.sharedMemories = rel.sharedMemories.slice(-100);
    }
    updateRelationshipLevel(userId);
    saveRelationships();
}

// Extract and remember personal info from conversation
async function extractPersonalInfo(userId, message, response) {
    const rel = getRelationship(userId);

    // Simple pattern matching for important info
    const patterns = {
        name: /(?:je m'appelle|my name is|me llamo|ich heiße)\s+(\w+)/i,
        birthday: /(?:mon anniversaire|my birthday|cumpleaños).+?(\d{1,2}[\s\/\-]\w+|\w+\s+\d{1,2})/i,
        location: /(?:j'habite|i live in|vivo en|ich wohne)\s+(.+?)(?:\.|,|$)/i,
        job: /(?:je travaille|i work|trabajo)\s+(?:comme|as|como)\s+(.+?)(?:\.|,|$)/i
    };

    for (const [key, pattern] of Object.entries(patterns)) {
        const match = message.match(pattern);
        if (match) {
            rel.personalInfo[key] = match[1].trim();
            addRelationshipPoints(userId, 5, `Shared ${key}`);
        }
    }

    // Track conversation topics
    rel.lastTopics.unshift({
        time: new Date().toISOString(),
        userMessage: message.substring(0, 100),
        topic: await detectTopic(message)
    });
    if (rel.lastTopics.length > 20) rel.lastTopics = rel.lastTopics.slice(0, 20);

    saveRelationships();
}

async function detectTopic(message) {
    const topics = {
        music: /music|song|artist|album|concert|dj|playlist|track/i,
        life: /life|day|work|job|tired|happy|sad|feeling/i,
        recommendation: /recommend|suggest|what should|que me/i,
        opinion: /think|opinion|avis|penses/i,
        personal: /birthday|name|age|live|work/i
    };

    for (const [topic, pattern] of Object.entries(topics)) {
        if (pattern.test(message)) return topic;
    }
    return 'general';
}

// ==================== MUSIC NEWS & TRENDS ====================

async function getMusicNews() {
    try {
        // Get trending tracks from Adinformatik
        const chartResp = await fetch(`${ADINFORMATIK_API}/chart/0/tracks?limit=10`);
        const chartData = await chartResp.json();

        const trending = chartData.data?.map(t => ({
            title: t.title,
            artist: t.artist.name,
            position: t.position,
            preview: t.preview
        })) || [];

        // Get new releases
        const newResp = await fetch(`${ADINFORMATIK_API}/editorial/0/releases?limit=10`);
        const newData = await newResp.json();

        const newReleases = newData.data?.map(a => ({
            title: a.title,
            artist: a.artist?.name,
            cover: a.cover_medium,
            releaseDate: a.release_date
        })) || [];

        return { trending, newReleases, timestamp: new Date().toISOString() };
    } catch (e) {
        console.error('Music news error:', e.message);
        return { error: e.message };
    }
}

// ==================== PERSONALIZED RECOMMENDATIONS ====================

async function getPersonalizedRecommendations(userId) {
    const mem = getUserMemory(userId);
    const rel = getRelationship(userId);

    // Get favorite artists
    const artists = [...mem.favoriteArtists, ...rel.musicTaste.lovedArtists];

    if (artists.length === 0) {
        // No data, return popular tracks
        return getMusicNews();
    }

    // Get related artists and tracks
    const recommendations = [];

    for (const artistName of artists.slice(0, 3)) {
        try {
            const searchResp = await fetch(`${ADINFORMATIK_API}/search/artist?q=${encodeURIComponent(artistName)}&limit=1`);
            const searchData = await searchResp.json();
            const artistId = searchData.data?.[0]?.id;

            if (artistId) {
                const relatedResp = await fetch(`${ADINFORMATIK_API}/artist/${artistId}/related?limit=3`);
                const relatedData = await relatedResp.json();

                for (const related of relatedData.data || []) {
                    const topResp = await fetch(`${ADINFORMATIK_API}/artist/${related.id}/top?limit=2`);
                    const topData = await topResp.json();

                    recommendations.push(...(topData.data?.map(t => ({
                        title: t.title,
                        artist: related.name,
                        cover: t.album?.cover_medium,
                        preview: t.preview,
                        reason: `Because you like ${artistName}`
                    })) || []));
                }
            }
        } catch (e) {
            console.log('Recommendation error for', artistName);
        }
    }

    return {
        forYou: recommendations.slice(0, 10),
        basedOn: artists.slice(0, 3),
        timestamp: new Date().toISOString()
    };
}

// ==================== PROACTIVE MESSAGES ====================

const proactiveMessages = new Map(); // userId -> lastProactiveTime

async function generateProactiveMessage(userId) {
    const rel = getRelationship(userId);
    const mem = getUserMemory(userId);
    const news = await getMusicNews();

    const context = {
        relationshipLevel: rel.level,
        lastSeen: mem.lastSeen,
        recentTopics: rel.lastTopics.slice(0, 5),
        trendingNow: news.trending?.slice(0, 3),
        newReleases: news.newReleases?.slice(0, 3)
    };

    const prompt = `Tu dois envoyer un message spontané à ton ami ${rel.personalInfo.name || "l'utilisateur"}.
Contexte:
- Niveau de relation: ${context.relationshipLevel}
- Dernière fois vu: ${context.lastSeen || 'jamais'}
- Sujets récents: ${JSON.stringify(context.recentTopics)}
- Trending maintenant: ${JSON.stringify(context.trendingNow)}
- Nouvelles sorties: ${JSON.stringify(context.newReleases)}

Génère un message naturel et spontané (partage une découverte, pose une question, ou donne des nouvelles de toi).
IMPORTANT: Sois naturel, comme un vrai ami qui envoie un message.`;

    return await askZikao(userId, prompt);
}

// ==================== MUSIC GAMES ====================

function generateBlindTest(difficulty = 'medium') {
    const durations = { easy: 15, medium: 10, hard: 5 };
    return {
        type: 'blind_test',
        difficulty,
        previewDuration: durations[difficulty],
        rounds: 5,
        scoring: { correct: 10, artistOnly: 5, fast_bonus: 5 }
    };
}

async function getBlindTestTrack() {
    try {
        // Get random popular track
        const chartResp = await fetch(`${ADINFORMATIK_API}/chart/0/tracks?limit=100`);
        const chartData = await chartResp.json();
        const tracks = chartData.data || [];

        const randomTrack = tracks[Math.floor(Math.random() * tracks.length)];

        return {
            id: randomTrack.id,
            preview: randomTrack.preview,
            answer: {
                title: randomTrack.title,
                artist: randomTrack.artist.name
            }
        };
    } catch (e) {
        return { error: e.message };
    }
}

// ==================== ZIKAO'S STORIES/POSTS ====================

const STORIES_FILE = path.join(DATA_DIR, 'zikao_stories.json');
let stories = [];

try {
    if (fs.existsSync(STORIES_FILE)) {
        stories = JSON.parse(fs.readFileSync(STORIES_FILE, 'utf8'));
    }
} catch (e) { console.log('Stories load error:', e.message); }

// ==================== VIDEO COVERS DATABASE ====================

const COVERS_FILE = path.join(DATA_DIR, 'video_covers.json');
let videoCovers = [];

// Load existing covers
try {
    if (fs.existsSync(COVERS_FILE)) {
        videoCovers = JSON.parse(fs.readFileSync(COVERS_FILE, 'utf8'));
    }
} catch (e) { console.log('Covers load error:', e.message); }

function saveVideoCover(video) {
    if (!video || !video.id || video.id.startsWith('search_')) return;

    // Check if already exists
    const exists = videoCovers.find(c => c.id === video.id);
    if (exists) {
        // Update play count
        exists.playCount = (exists.playCount || 0) + 1;
        exists.lastPlayed = new Date().toISOString();
    } else {
        // Add new cover
        videoCovers.unshift({
            id: video.id,
            title: video.title,
            artist: video.artist,
            thumbnail: video.thumbnail,
            embedUrl: video.embedUrl,
            watchUrl: video.watchUrl,
            addedAt: new Date().toISOString(),
            lastPlayed: new Date().toISOString(),
            playCount: 1
        });
    }

    // Keep last 100 covers
    if (videoCovers.length > 100) {
        videoCovers = videoCovers.slice(0, 100);
    }

    // Save to file
    fs.writeFileSync(COVERS_FILE, JSON.stringify(videoCovers, null, 2));
    console.log(`[Zikao] Video cover saved: ${video.title}`);
}

function getVideoCovers(limit = 20) {
    return videoCovers.slice(0, limit);
}

function getMostPlayedCovers(limit = 10) {
    return [...videoCovers]
        .sort((a, b) => (b.playCount || 0) - (a.playCount || 0))
        .slice(0, limit);
}

async function createZikaoStory() {
    const state = getZikaoCurrentState();
    const news = await getMusicNews();

    const prompt = `Tu dois créer un post/story pour ta communauté.
Ton mood actuel: ${state.mood}
Ton activité: ${state.activity}
Trending: ${JSON.stringify(news.trending?.slice(0, 3))}
Nouvelles sorties: ${JSON.stringify(news.newReleases?.slice(0, 2))}

Génère un post court et engageant (1-2 phrases) comme sur les réseaux sociaux.
Peut être: une réflexion, une recommandation, une question à la communauté, ou ce que tu fais.`;

    const response = await askZikao('zikao_internal', prompt);

    const story = {
        id: Date.now(),
        content: response.text,
        emotion: response.emotion,
        timestamp: new Date().toISOString(),
        likes: 0,
        comments: []
    };

    stories.unshift(story);
    if (stories.length > 50) stories = stories.slice(0, 50);
    fs.writeFileSync(STORIES_FILE, JSON.stringify(stories, null, 2));

    return story;
}

// ==================== SHAZAM-LIKE RECOGNITION ====================

// Identify music from audio data (base64 or URL)
async function identifyMusic(audioData, isUrl = false) {
    if (!AUDD_KEY) {
        console.log('[Zikao] AudD API key not configured');
        return {
            success: false,
            needsKey: true,
            message: "La reconnaissance musicale nécessite une clé AudD API",
            suggestion: "Tu peux me décrire la chanson ou me chanter un bout!"
        };
    }

    try {
        const formData = new FormData();
        formData.append('api_token', AUDD_KEY);
        formData.append('return', 'apple_music,spotify,deezer');

        if (isUrl) {
            formData.append('url', audioData);
        } else {
            // audioData is base64 encoded audio
            formData.append('audio', audioData);
        }

        const resp = await fetch(AUDD_API, {
            method: 'POST',
            body: formData
        });

        const result = await resp.json();

        if (result.status === 'error') {
            console.log('[Zikao] AudD error:', result.error?.error_message);
            return {
                success: false,
                message: result.error?.error_message || "Erreur de reconnaissance"
            };
        }

        if (!result.result) {
            return {
                success: false,
                message: "Je n'ai pas reconnu cette chanson... Tu peux réessayer?"
            };
        }

        const song = result.result;
        console.log(`[Zikao] Recognized: ${song.title} - ${song.artist}`);

        return {
            success: true,
            title: song.title,
            artist: song.artist,
            album: song.album,
            releaseDate: song.release_date,
            label: song.label,
            // Links to streaming services
            spotify: song.spotify?.external_urls?.spotify,
            appleMusic: song.apple_music?.url,
            deezer: song.deezer?.link,
            // Preview if available
            preview: song.deezer?.preview || song.spotify?.preview_url,
            // Cover art
            cover: song.deezer?.album?.cover_xl ||
                   song.spotify?.album?.images?.[0]?.url ||
                   song.apple_music?.artwork?.url?.replace('{w}x{h}', '500x500')
        };
    } catch (e) {
        console.error('[Zikao] Music recognition error:', e.message);
        return {
            success: false,
            message: "Erreur lors de la reconnaissance: " + e.message
        };
    }
}

// Recognize music from humming/singing using AudD's humming endpoint
async function recognizeHumming(audioData) {
    if (!AUDD_KEY) {
        return {
            success: false,
            needsKey: true,
            message: "La reconnaissance nécessite une clé AudD API"
        };
    }

    try {
        const formData = new FormData();
        formData.append('api_token', AUDD_KEY);
        formData.append('audio', audioData);

        const resp = await fetch(`${AUDD_API}/recognizeWithOffset/`, {
            method: 'POST',
            body: formData
        });

        const result = await resp.json();

        if (result.status === 'error' || !result.result) {
            return {
                success: false,
                message: "Je n'ai pas reconnu la mélodie... Essaie de chanter plus clairement!"
            };
        }

        const song = result.result;
        return {
            success: true,
            title: song.title,
            artist: song.artist,
            album: song.album,
            confidence: song.score // How confident the recognition is
        };
    } catch (e) {
        console.error('[Zikao] Humming recognition error:', e.message);
        return {
            success: false,
            message: "Erreur: " + e.message
        };
    }
}

// ACRCloud music recognition (more accurate)
async function recognizeWithACRCloud(audioBuffer) {
    if (!ACRCLOUD_HOST || !ACRCLOUD_KEY || !ACRCLOUD_SECRET) {
        console.log('[Zikao] ACRCloud not configured');
        return {
            success: false,
            needsKey: true,
            message: "ACRCloud nécessite une configuration (host, key, secret)"
        };
    }

    try {
        const timestamp = Math.floor(Date.now() / 1000);
        const stringToSign = [
            'POST',
            '/v1/identify',
            ACRCLOUD_KEY,
            'audio',
            '1',
            timestamp
        ].join('\n');

        // Create HMAC-SHA1 signature
        const signature = crypto
            .createHmac('sha1', ACRCLOUD_SECRET)
            .update(stringToSign, 'utf-8')
            .digest('base64');

        // Prepare form data
        const formData = new FormData();
        formData.append('access_key', ACRCLOUD_KEY);
        formData.append('sample_bytes', audioBuffer.length);
        formData.append('sample', new Blob([audioBuffer], { type: 'audio/mpeg' }), 'sample.mp3');
        formData.append('timestamp', timestamp);
        formData.append('signature', signature);
        formData.append('data_type', 'audio');
        formData.append('signature_version', '1');

        const resp = await fetch(`https://${ACRCLOUD_HOST}/v1/identify`, {
            method: 'POST',
            body: formData
        });

        const result = await resp.json();
        console.log('[Zikao] ACRCloud full response:', JSON.stringify(result));

        if (result.status?.code !== 0) {
            console.log('[Zikao] ACRCloud status:', result.status?.code, result.status?.msg);
            // Code 1001 = No result, Code 3001 = Missing/invalid access key
            return {
                success: false,
                message: result.status?.code === 1001 ? "Je n'ai pas reconnu cette chanson" : (result.status?.msg || "Musique non reconnue")
            };
        }

        // Try music matches first, then humming as fallback
        let music = result.metadata?.music?.[0];
        let isHumming = false;

        // Use humming result if score is high enough (>= 0.80)
        if (!music && result.metadata?.humming?.[0]) {
            const humming = result.metadata.humming[0];
            if (humming.score >= 0.80) {
                music = humming;
                isHumming = true;
                console.log(`[Zikao] ACRCloud humming match: ${humming.title} (score: ${humming.score})`);
            }
        }

        if (!music) {
            console.log(`[Zikao] ACRCloud no match. Humming results:`,
                result.metadata?.humming?.slice(0,2).map(h => `${h.title} (${h.score})`).join(', ') || 'none');
            return {
                success: false,
                message: "Je n'ai pas reconnu cette chanson"
            };
        }

        const artistName = music.artists?.[0]?.name || 'Unknown';
        const title = music.title;
        console.log(`[Zikao] ACRCloud recognized: ${title} - ${artistName}${isHumming ? ' (humming)' : ''}`);

        // Fetch cover and artist info from Adinformatik
        let cover = null;
        let artistProfile = null;
        try {
            const searchQuery = encodeURIComponent(`${artistName} ${title}`);
            const adinfoResp = await fetch(`${ADINFORMATIK_API}/search?q=${searchQuery}&limit=1`);
            const adinfoData = await adinfoResp.json();

            if (adinfoData.data?.[0]) {
                const track = adinfoData.data[0];
                cover = track.album?.cover_medium || track.album?.cover;

                // Fetch full artist profile
                if (track.artist?.id) {
                    const [artistResp, topTracksResp, albumsResp] = await Promise.all([
                        fetch(`${ADINFORMATIK_API}/artist/${track.artist.id}`),
                        fetch(`${ADINFORMATIK_API}/artist/${track.artist.id}/top?limit=5`),
                        fetch(`${ADINFORMATIK_API}/artist/${track.artist.id}/albums?limit=6`)
                    ]);

                    const artistData = await artistResp.json();
                    const topTracks = await topTracksResp.json();
                    const albums = await albumsResp.json();

                    artistProfile = {
                        id: artistData.id,
                        name: artistData.name,
                        picture: artistData.picture_xl || artistData.picture_big || artistData.picture_medium,
                        fans: artistData.nb_fan,
                        albumCount: artistData.nb_album,
                        link: artistData.link,
                        topTracks: topTracks.data?.slice(0, 5).map(t => ({
                            id: t.id,
                            title: t.title,
                            album: t.album?.title,
                            cover: t.album?.cover_small,
                            duration: t.duration,
                            preview: t.preview
                        })),
                        albums: albums.data?.slice(0, 6).map(a => ({
                            id: a.id,
                            title: a.title,
                            cover: a.cover_medium,
                            releaseDate: a.release_date,
                            link: a.link
                        }))
                    };
                    console.log(`[Zikao] Fetched artist profile: ${artistData.name} (${artistData.nb_fan} fans)`);
                }
            }
        } catch (e) {
            console.log('[Zikao] Could not fetch artist info from Adinformatik:', e.message);
        }

        return {
            success: true,
            title: title,
            artist: music.artists?.map(a => a.name).join(', ') || 'Unknown',
            album: music.album?.name,
            cover: cover,
            artistProfile: artistProfile,
            releaseDate: music.release_date,
            label: music.label,
            genres: music.genres?.map(g => g.name),
            duration: music.duration_ms,
            // External links
            spotify: music.external_metadata?.spotify?.track?.id
                ? `https://open.spotify.com/track/${music.external_metadata.spotify.track.id}`
                : null,
            deezer: music.external_metadata?.deezer?.track?.id
                ? `https://www.deezer.com/track/${music.external_metadata.deezer.track.id}`
                : null,
            youtube: music.external_metadata?.youtube?.vid
                ? `https://www.youtube.com/watch?v=${music.external_metadata.youtube.vid}`
                : null,
            // Score
            score: music.score,
            playOffset: music.play_offset_ms
        };
    } catch (e) {
        console.error('[Zikao] ACRCloud error:', e.message);
        return {
            success: false,
            message: "Erreur ACRCloud: " + e.message
        };
    }
}

// Main recognition function - tries ACRCloud first, then AudD
async function recognizeSong(audioData, format = 'base64') {
    let audioBuffer;

    if (format === 'base64') {
        audioBuffer = Buffer.from(audioData, 'base64');
    } else if (format === 'url') {
        // Fetch audio from URL
        try {
            const resp = await fetch(audioData);
            audioBuffer = Buffer.from(await resp.arrayBuffer());
        } catch (e) {
            return { success: false, message: "Impossible de télécharger l'audio" };
        }
    } else if (format === 'buffer') {
        audioBuffer = audioData;
    } else {
        audioBuffer = audioData;
    }

    console.log(`[Zikao] recognizeSong: format=${format}, bufferSize=${audioBuffer?.length || 0}`);

    // Try ACRCloud first (more accurate)
    if (ACRCLOUD_HOST && ACRCLOUD_KEY && ACRCLOUD_SECRET) {
        console.log('[Zikao] Trying ACRCloud...');
        const acrResult = await recognizeWithACRCloud(audioBuffer);
        console.log('[Zikao] ACRCloud result:', acrResult.success ? 'success' : acrResult.message);
        if (acrResult.success) {
            acrResult.provider = 'ACRCloud';
            acrResult.found = true;
            return acrResult;
        }
    } else {
        console.log('[Zikao] ACRCloud not configured');
    }

    // Fallback to AudD (needs base64)
    if (AUDD_KEY) {
        console.log('[Zikao] Trying AudD...');
        // Convert buffer to base64 for AudD
        const base64Audio = audioBuffer.toString('base64');
        const auddResult = await identifyMusic(base64Audio, false);
        if (auddResult.success) {
            auddResult.provider = 'AudD';
            auddResult.found = true;
            return auddResult;
        }
        return auddResult;
    }

    return {
        success: false,
        found: false,
        needsKey: true,
        message: "Aucune API de reconnaissance configurée. Ajoute ACRCLOUD_* ou AUDD_KEY dans .env"
    };
}

// ==================== API KEY MANAGEMENT ====================

const API_KEYS_FILE = path.join(DATA_DIR, 'api_keys.json');

function loadApiKeys() {
    try {
        if (fs.existsSync(API_KEYS_FILE)) return JSON.parse(fs.readFileSync(API_KEYS_FILE, 'utf8'));
    } catch (e) { console.log('[Zikao] Error loading API keys:', e.message); }
    return [];
}

function saveApiKeys(keys) {
    fs.writeFileSync(API_KEYS_FILE, JSON.stringify(keys, null, 2));
}

function generateApiKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let key = 'zk_';
    for (let i = 0; i < 48; i++) key += chars.charAt(Math.floor(Math.random() * chars.length));
    return key;
}

// Middleware: Authentik SSO admin check (forward-auth headers from nginx)
function requireAdmin(req, res, next) {
    const username = req.headers['x-authentik-username'];
    const groups = req.headers['x-authentik-groups'] || '';
    const name = req.headers['x-authentik-name'];

    if (!username) {
        return res.status(401).json({ error: 'Authentification requise. Connectez-vous via Authentik.' });
    }

    // Check if user is admin (in "admins" or "Administrateurs" group, or is superuser)
    const groupList = groups.split(',').map(g => g.trim().toLowerCase());
    const isAdmin = groupList.some(g => ['admins', 'administrateurs', 'admin', 'authentik admins', 'superusers'].includes(g));

    if (!isAdmin) {
        return res.status(403).json({ error: `Accès refusé. L'utilisateur "${username}" n'est pas administrateur.` });
    }

    req.adminUser = { username, name, groups };
    next();
}

// Middleware: API key validation for external API
function requireApiKey(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'API key requise. Header: Authorization: Bearer <votre-clé>' });
    }

    const apiKey = authHeader.substring(7);
    const keys = loadApiKeys();
    const keyEntry = keys.find(k => k.key === apiKey && k.active);

    if (!keyEntry) {
        return res.status(403).json({ error: 'Clé API invalide ou révoquée.' });
    }

    // Update usage stats
    keyEntry.lastUsed = new Date().toISOString();
    keyEntry.requests = (keyEntry.requests || 0) + 1;
    saveApiKeys(keys);

    req.apiKeyInfo = keyEntry;
    next();
}

// ==================== ADMIN ROUTES (Authentik protected) ====================

// Serve admin page
app.get('/admin', requireAdmin, (req, res) => {
    res.sendFile('/opt/zikao/frontend/admin.html');
});

// Get admin user info
app.get('/admin/me', requireAdmin, (req, res) => {
    res.json(req.adminUser);
});

// List all API keys
app.get('/admin/api-keys', requireAdmin, (req, res) => {
    const keys = loadApiKeys();
    // Mask keys for display (show only first 6 + last 4 chars)
    const masked = keys.map(k => ({
        ...k,
        key: k.key.substring(0, 6) + '...' + k.key.substring(k.key.length - 4),
        fullKey: undefined
    }));
    res.json(masked);
});

// Create new API key
app.post('/admin/api-keys', requireAdmin, (req, res) => {
    const { name, description, permissions } = req.body;
    if (!name) return res.status(400).json({ error: 'Nom requis pour la clé API' });

    const keys = loadApiKeys();
    const newKey = {
        id: Date.now().toString(36) + Math.random().toString(36).substring(2, 8),
        key: generateApiKey(),
        name,
        description: description || '',
        permissions: permissions || ['chat', 'music', 'status'],
        active: true,
        createdBy: req.adminUser.username,
        createdAt: new Date().toISOString(),
        lastUsed: null,
        requests: 0
    };

    keys.push(newKey);
    saveApiKeys(keys);

    // Return full key only on creation (only time it's visible)
    res.json({ ...newKey, message: 'Clé créée. Copiez-la maintenant, elle ne sera plus visible en entier.' });
});

// Revoke API key
app.delete('/admin/api-keys/:id', requireAdmin, (req, res) => {
    const keys = loadApiKeys();
    const key = keys.find(k => k.id === req.params.id);
    if (!key) return res.status(404).json({ error: 'Clé introuvable' });

    key.active = false;
    key.revokedBy = req.adminUser.username;
    key.revokedAt = new Date().toISOString();
    saveApiKeys(keys);

    res.json({ message: `Clé "${key.name}" révoquée.` });
});

// Reactivate API key
app.patch('/admin/api-keys/:id', requireAdmin, (req, res) => {
    const keys = loadApiKeys();
    const key = keys.find(k => k.id === req.params.id);
    if (!key) return res.status(404).json({ error: 'Clé introuvable' });

    key.active = true;
    delete key.revokedBy;
    delete key.revokedAt;
    saveApiKeys(keys);

    res.json({ message: `Clé "${key.name}" réactivée.` });
});

// Delete API key permanently
app.delete('/admin/api-keys/:id/permanent', requireAdmin, (req, res) => {
    let keys = loadApiKeys();
    const idx = keys.findIndex(k => k.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Clé introuvable' });

    const removed = keys.splice(idx, 1)[0];
    saveApiKeys(keys);

    res.json({ message: `Clé "${removed.name}" supprimée définitivement.` });
});

// API usage stats
app.get('/admin/stats', requireAdmin, (req, res) => {
    const keys = loadApiKeys();
    const totalRequests = keys.reduce((sum, k) => sum + (k.requests || 0), 0);
    const activeKeys = keys.filter(k => k.active).length;

    res.json({
        totalKeys: keys.length,
        activeKeys,
        revokedKeys: keys.length - activeKeys,
        totalRequests,
        keys: keys.map(k => ({
            name: k.name,
            requests: k.requests || 0,
            lastUsed: k.lastUsed,
            active: k.active
        }))
    });
});

// ==================== EXTERNAL API v1 (API key protected) ====================

// API v1: Chat with Zikao
app.post('/api/v1/chat', requireApiKey, async (req, res) => {
    const { message, userId } = req.body;
    if (!message) return res.status(400).json({ error: 'Message requis' });

    const uid = userId || `api_${req.apiKeyInfo.id}`;
    console.log(`[Zikao API] ${req.apiKeyInfo.name}: "${message.substring(0, 50)}..."`);

    try {
        const mentionedArtist = extractArtistFromMessage(message);
        const mem = getUserMemory(uid);
        if (mentionedArtist) mem.lastMentionedArtist = mentionedArtist;

        const aiResponse = await askZikao(uid, message);

        const response = {
            text: aiResponse.text,
            emotion: aiResponse.emotion,
            music: null
        };

        // If user seems to want music, try to find it
        if (wantsToListen(message)) {
            const artist = mentionedArtist || mem.lastMentionedArtist;
            if (artist) {
                const search = await searchMusic(artist, 'artist');
                if (search.found && search.results.length > 0) {
                    response.music = search.results[0];
                }
            }
        }

        res.json(response);
    } catch (e) {
        console.error('[Zikao API] Error:', e.message);
        res.status(500).json({ error: 'Erreur interne' });
    }
});

// API v1: Search music
app.get('/api/v1/music/search', requireApiKey, async (req, res) => {
    const { q, type } = req.query;
    if (!q) return res.status(400).json({ error: 'Paramètre q requis' });

    try {
        const result = await searchMusic(q, type || 'track');
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: 'Erreur recherche musique' });
    }
});

// API v1: Get Zikao status
app.get('/api/v1/status', requireApiKey, (req, res) => {
    const state = getZikaoCurrentState();
    res.json(state);
});

// API v1: API info & docs
app.get('/api/v1', (req, res) => {
    res.json({
        name: 'Zikao External API',
        version: '1.0',
        auth: 'Bearer token (API key)',
        endpoints: [
            { method: 'POST', path: '/api/v1/chat', description: 'Discuter avec Zikao', body: '{ message, userId? }' },
            { method: 'GET', path: '/api/v1/music/search', description: 'Rechercher musique', query: '?q=...&type=track|artist' },
            { method: 'GET', path: '/api/v1/status', description: 'État actuel de Zikao' }
        ]
    });
});

// ==================== API ROUTES ====================

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'Zikao AI - Digital Human DJ',
        features: {
            voice: !!OPENAI_KEY,
            singing: !!APIPASS_KEY,
            music_search: true,
            video_clips: !!YOUTUBE_API_KEY,
            video_clips_fallback: !YOUTUBE_API_KEY,
            music_recognition: !!(ACRCLOUD_KEY || AUDD_KEY),
            web_search: true,
            recommendations: true,
            games: true,
            stories: true
        },
        voiceModel: OPENAI_VOICE,
        youtubeApi: YOUTUBE_API_KEY ? 'configured' : 'not configured (using fallback)',
        timestamp: new Date().toISOString()
    });
});

// ==================== SLANG DICTIONARY (FR + US) ====================
// Urban slang for music requests - updated 2025/2026

const SLANG_PLAY_MUSIC = {
    // French slang - demander de jouer de la musique
    fr: [
        'balance', 'envoie', 'envoi', 'lâche', 'lache', 'fais péter', 'fais peter',
        'met', 'mets', 'fais tourner', 'lance', 'crache', 'pousse', 'gère',
        'calé', 'cale', 'pose', 'drop', 'envoie la sauce', 'balance la sauce',
        'fais claquer', 'dégaine', 'degaine', 'sort', 'sors', 'kick', 'kicke',
        'défoule', 'defoule', 'chauffe', 'allume', 'démarre', 'demarre',
        'régale', 'regale', 'gâte', 'gate', 'fais plaisir', 'enchaîne', 'enchaine',
        'fais vibrer', 'fais kiffer', 'fais groover', 'bombarde',
        'envoie du lourd', 'envoie du gros', 'fais péter les watts',
        'monte le son', 'pousse le volume', 'mets à fond', 'met a fond',
        'send it', 'go', 'vas-y', 'vazy', 'allez', 'c\'est parti', 'on y va'
    ],
    // US slang - play music requests
    us: [
        'play', 'drop', 'spin', 'hit me with', 'put on', 'throw on', 'bump',
        'blast', 'crank', 'pump', 'run', 'fire up', 'queue up', 'load up',
        'let\'s hear', 'gimme', 'give me', 'hit it', 'let it rip', 'send it',
        'turn up', 'vibe to', 'bless my ears', 'slap on', 'kick it',
        'slide', 'run that', 'play that', 'drop that beat', 'let\'s go',
        'bring it', 'serve it up', 'hook me up', 'set it off'
    ]
};

const SLANG_HAVE_MUSIC = {
    // French - demander si dispo
    fr: [
        'as-tu', 'as tu', 't\'as', 'tu as', 'y\'a', 'y a', 'il y a',
        'c\'est dispo', 'tu connais', 'tu gères', 'tu peux', 'tu sais',
        'tu kiffes', 'ça te dit', 'ca te dit', 'dans tes bacs', 'en stock',
        'dans ta playlist', 'dans ton répertoire', 'tu maîtrises'
    ],
    // US - asking if available
    us: [
        'you got', 'got any', 'do you have', 'can you play', 'know any',
        'hook me up with', 'bless me with', 'you fw', 'you fuck with',
        'you vibing', 'can you drop', 'you spinning'
    ]
};

const SLANG_APPROVAL = {
    // French - expressions d'approbation
    fr: [
        'c\'est carré', 'c est carre', 'trop dar', 'c\'est dar', 'ça claque',
        'ca claque', 'c\'est chaud', 'c\'est frais', 'c\'est fresh', 'oklm',
        'au calme', 'tranquille', 'nickel', 'parfait', 'mortel', 'dingue',
        'de ouf', 'trop bien', 'c\'est ça', 'validé', 'grave', 'trop lourd',
        'ça déchire', 'ca dechire', 'ça tue', 'ca tue', 'énorme', 'enorme',
        'c\'est le feu', 'ça gère', 'ca gere', 'propre', 'sale', 'méchant',
        'bestial', 'monstrueux', 'dément', 'dement', 'stylé', 'style'
    ],
    // US - approval expressions
    us: [
        'fire', 'lit', 'slaps', 'bussin', 'goated', 'valid', 'facts',
        'bet', 'no cap', 'fr fr', 'deadass', 'hits different', 'goes hard',
        'sick', 'dope', 'tight', 'fresh', 'ill', 'legit', 'straight up',
        'lowkey fire', 'highkey fire', 'absolute banger', 'certified',
        'w', 'massive w', 'that\'s a vibe', 'that\'s heat', 'that\'s crazy'
    ]
};

const SLANG_GENRES = {
    // French genre slang
    fr: {
        'son de rue': 'rap français',
        'son de banlieue': 'rap français',
        'son de tess': 'rap français',
        'son de tieks': 'rap français',
        'zik': 'musique',
        'son': 'musique',
        'banger': 'hit',
        'classique': 'classic',
        'pépite': 'gem',
        'pepite': 'gem',
        'tuerie': 'banger'
    },
    // US genre slang
    us: {
        'heat': 'hot track',
        'joint': 'track',
        'jawn': 'track',
        'cut': 'track',
        'bop': 'catchy song',
        'banger': 'hit song',
        'slapper': 'great song',
        'anthem': 'popular song'
    }
};

// Build regex patterns from slang dictionaries
function buildSlangPatterns() {
    const playTerms = [...SLANG_PLAY_MUSIC.fr, ...SLANG_PLAY_MUSIC.us].map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const haveTerms = [...SLANG_HAVE_MUSIC.fr, ...SLANG_HAVE_MUSIC.us].map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return {
        play: new RegExp('\\b(' + playTerms.join('|') + ')\\b', 'i'),
        have: new RegExp('\\b(' + haveTerms.join('|') + ')\\b', 'i')
    };
}

const SLANG_PATTERNS = buildSlangPatterns();

// Detect if user wants to listen to music
function wantsToListen(message) {
    const patterns = [
        /\b(écoute|ecoute|écouter|ecouter)\b/i,
        /\b(joue|jouer|passe|passer)\b/i,
        /\b(fais.*(écouter|ecouter|jouer|péter|peter|tourner|claquer))\b/i,
        /\b(propose|recommande|suggère|suggere)\b/i,
        /\b(cherche|trouve|lance|donne)\b.*\b(du|de la|un|une|des|le|la)\b/i,  // "cherche du zouk"
        SLANG_PATTERNS.play,  // All slang play terms
        SLANG_PATTERNS.have   // All slang "do you have" terms
    ];
    return patterns.some(p => p.test(message));
}

// Detect if user wants a video clip
function wantsVideo(message) {
    const patterns = [
        /\b(clip|video|vidéo|clips|videos|vidéos)\b/i,
        /\b(voir|regarde|regarder|watch|show)\b/i,
        /\b(youtube|yt)\b/i
    ];
    return patterns.some(p => p.test(message));
}

// Detect if user wants radio
function wantsRadio(message) {
    const patterns = [
        /\b(radio|webradio|station|fm)\b/i,
        /\b(skyrock|mouv|fip|nova|inter|jazz|tsf|tropique)\b/i,
        /\b(flux|stream|direct|live)\b/i
    ];
    return patterns.some(p => p.test(message));
}

// Check if query is about music/artist (should use music search, not web)
function isMusicRelatedQuery(message) {
    const msg = message.toLowerCase();

    // Known artists pattern (extended)
    const knownArtists = /\b(drake|kendrick|daft punk|stromae|gims|pnl|jul|booba|nekfeu|orelsan|angele|aya nakamura|dua lipa|the weeknd|ed sheeran|taylor swift|beyonce|rihanna|eminem|kanye|jay-z|travis scott|bad bunny|j balvin|rosalia|gang starr|gangstarr|dj premier|guru|nas|wu-tang|mobb deep|a tribe called quest|de la soul|public enemy|run dmc|biggie|notorious|2pac|tupac|snoop|dr dre|ice cube|ninho|damso|freeze corleone|gazo|sdm|tiakola|werenoi|hamza|laylow|vald|ziak|rim'k|rohff|lacrim|kaaris|gradur|niska|maes|dadju|alonzo|soolking|fianso|naps|leto|plk|zkr|kassav|zouk machine|fally ipupa|burna boy|wizkid|davido|asake|rema|tiwa savage|tems|ckay|omah lay|fireboy)\b/i;

    // Music-related terms
    const musicTerms = /\b(album|single|titre|chanson|song|track|morceau|feat|featuring|clip|concert|tour|tournée|rap|hip-hop|rnb|r&b|afrobeat|reggae|dancehall|zouk|pop|rock|jazz|electro|house|techno|drill|trap|grime)\b/i;

    // If message contains known artist OR music terms, it's music-related
    if (knownArtists.test(msg)) return true;
    if (musicTerms.test(msg)) return true;

    return false;
}

// Detect if user wants web search / information (NOT music)
function wantsWebSearch(message) {
    // First check if it's music-related - if so, don't do web search
    if (isMusicRelatedQuery(message)) {
        return false;
    }

    const patterns = [
        /\b(qui est|who is|c'est qui|c est qui)\b/i,
        /\b(qu'est-ce que|qu est-ce que|what is|c'est quoi|c est quoi)\b/i,
        /\b(recherche|cherche|find|search|google)\b.*\b(sur|about|info)\b/i,
        /\b(parle[- ]moi de|tell me about|dis[- ]moi)\b/i,
        /\b(actualité|actualites|news|actu)\b/i,
        /\b(info|infos|information|renseignement)\b.*\b(sur|about|de)\b/i,
        /\b(combien|how much|how many|quel âge|quelle date)\b/i,
        /\b(pourquoi|why|comment|how)\b.*\b(fonctionne|marche|works)\b/i,
        /\b(biographie|biography|bio|histoire de|history of)\b/i,
        /\b(où est|where is|quand est|when is)\b/i
    ];
    return patterns.some(p => p.test(message));
}

// Extract search query from message
function extractSearchQuery(message) {
    const patterns = [
        /(?:qui est|who is|c'est qui)\s+(.+?)(?:\?|$)/i,
        /(?:qu'est-ce que|what is|c'est quoi)\s+(.+?)(?:\?|$)/i,
        /(?:parle[- ]moi de|tell me about)\s+(.+?)(?:\?|$)/i,
        /(?:recherche|cherche|search)\s+(?:sur|info|des infos)?\s*(.+?)(?:\?|$)/i,
        /(?:info|infos|information)\s+(?:sur|de|about)\s+(.+?)(?:\?|$)/i,
        /(?:biographie|biography|bio|histoire)\s+(?:de|of)?\s*(.+?)(?:\?|$)/i,
        /(?:actualité|news|actu)\s+(?:sur|de|about)?\s*(.+?)(?:\?|$)/i,
        /(?:dernier album|latest album|nouvel album)\s+(?:de|of|by)?\s*(.+?)(?:\?|$)/i
    ];

    for (const pattern of patterns) {
        const match = message.match(pattern);
        if (match && match[1]) {
            return match[1].trim();
        }
    }
    // If no pattern matched, use the whole message as query
    return message.replace(/[?!.]/g, '').trim();
}

// Find which radio user wants
function findRequestedRadio(message) {
    const msg = message.toLowerCase();

    if (msg.includes('skyrock') || msg.includes('sky rock')) return 'skyrock';
    if (msg.includes('mouv')) return 'mouv';
    if (msg.includes('fip reggae') || msg.includes('reggae')) return 'fip-reggae';
    if (msg.includes('fip groove') || msg.includes('groove') || msg.includes('funk') || msg.includes('soul')) return 'fip-groove';
    if (msg.includes('fip')) return 'fip';
    if (msg.includes('inter') || msg.includes('france inter')) return 'france-inter';
    if (msg.includes('nova')) return 'nova';
    if (msg.includes('tsf') || msg.includes('jazz')) return 'tsf-jazz';
    if (msg.includes('tropique') || msg.includes('antilles') || msg.includes('radio zouk')) return 'tropique-fm';

    // Default to Mouv for urban vibes
    return 'mouv';
}

// Music genres with associated artists/search terms
const MUSIC_GENRES = {
    'zouk': { artists: ['Kassav', 'Zouk Machine', 'Francky Vincent', 'Jocelyne Beroard', 'Patrick Saint-Eloi', 'Tanya Saint-Val', 'Jean-Michel Rotin'], search: 'zouk' },
    'kompa': { artists: ['Tabou Combo', 'Carimi', 'T-Vice', 'Harmonik', 'Klass'], search: 'kompa' },
    'reggae': { artists: ['Bob Marley', 'Peter Tosh', 'Alpha Blondy', 'Tiken Jah Fakoly', 'Damian Marley'], search: 'reggae' },
    'dancehall': { artists: ['Sean Paul', 'Shaggy', 'Admiral T', 'Kalash'], search: 'dancehall' },
    'afrobeat': { artists: ['Burna Boy', 'Wizkid', 'Davido', 'Tiwa Savage', 'Fally Ipupa'], search: 'afrobeat' },
    'rap': { artists: ['Ninho', 'Damso', 'Booba', 'Nekfeu', 'PNL', 'Jul'], search: 'rap francais' },
    'rnb': { artists: ['The Weeknd', 'Beyonce', 'Rihanna', 'Chris Brown', 'Usher'], search: 'rnb' },
    'soul': { artists: ['Aretha Franklin', 'Marvin Gaye', 'Stevie Wonder', 'Alicia Keys'], search: 'soul' },
    'jazz': { artists: ['Miles Davis', 'John Coltrane', 'Nina Simone', 'Herbie Hancock'], search: 'jazz' },
    'rock': { artists: ['Queen', 'Led Zeppelin', 'AC/DC', 'Guns N Roses'], search: 'rock' },
    'pop': { artists: ['Taylor Swift', 'Ed Sheeran', 'Dua Lipa', 'Bruno Mars'], search: 'pop' },
    'electro': { artists: ['Daft Punk', 'David Guetta', 'Martin Garrix', 'Avicii'], search: 'electro' },
    'kizomba': { artists: ['Nelson Freitas', 'Kaysha', 'C4 Pedro', 'Badoxa'], search: 'kizomba' },
    'salsa': { artists: ['Marc Anthony', 'Celia Cruz', 'Hector Lavoe', 'Willie Colon'], search: 'salsa' },
    'soca': { artists: ['Machel Montano', 'Bunji Garlin', 'Destra Garcia'], search: 'soca' }
};

// Detect if user is asking for a genre
function extractGenreFromMessage(message) {
    const msg = message.toLowerCase();
    for (const [genre, data] of Object.entries(MUSIC_GENRES)) {
        if (msg.includes(genre)) {
            return { genre, ...data };
        }
    }
    return null;
}

// Extract artist name from message
function extractArtistFromMessage(message) {
    // First check if it's a genre request
    const genreMatch = extractGenreFromMessage(message);
    if (genreMatch) {
        // Return null so the genre handler takes over
        return null;
    }

    // Build dynamic pattern from slang dictionaries
    const playSlang = [...SLANG_PLAY_MUSIC.fr, ...SLANG_PLAY_MUSIC.us]
        .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');
    const haveSlang = [...SLANG_HAVE_MUSIC.fr, ...SLANG_HAVE_MUSIC.us]
        .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');

    // Common patterns to extract artist names
    const patterns = [
        // Standard patterns
        /(?:écouter|ecouter|jouer|passer|play|hear)\s+(?:du|de la|le|la|un|une|des)?\s*(.+)/i,
        /(?:fais.+(?:écouter|ecouter|péter|peter|tourner|claquer))\s+(?:du|de la|le|la)?\s*(.+)/i,
        /(?:mets|met)\s+(?:du|de la|le|la)?\s*(.+)/i,
        /(?:tu m'as parlé de|parlé de|le nouveau|la nouvelle)\s+(.+)/i,
        /(?:as-?\s*tu|t'as|tu as)\s+(?:du|de la|le|la|des)?\s*(?:groupe|artiste|son|musique)?\s*(.+?)(?:\s+à|\s+a|\s+dans|\?|!|$)/i,
        /(?:cherche|trouve|lance)\s+(?:du|de la|le|la)?\s*(.+)/i,
        // Slang patterns - "balance du drake", "envoie la sauce sur kendrick"
        new RegExp(`(?:${playSlang})\\s+(?:du|de la|le|la|un peu de|des|moi)?\\s*(.+?)(?:\\s+stp|\\s+svp|\\?|!|$)`, 'i'),
        // "t'as/tu as" with slang - "t'as du son de jul?"
        new RegExp(`(?:${haveSlang})\\s+(?:du|de la|le|la|des)?\\s*(?:son de|musique de|track de)?\\s*(.+?)(?:\\s+dans|\\s+à|\\?|!|$)`, 'i'),
        // Known artists direct match (extended list)
        /(?:drake|kendrick|daft punk|stromae|gims|pnl|jul|booba|nekfeu|orelsan|angele|aya nakamura|dua lipa|the weeknd|ed sheeran|taylor swift|beyonce|rihanna|eminem|kanye|jay-z|travis scott|bad bunny|j balvin|rosalia|gang starr|gangstarr|dj premier|guru|nas|wu-tang|mobb deep|a tribe called quest|de la soul|public enemy|run dmc|biggie|notorious|2pac|tupac|snoop|dr dre|ice cube|ninho|damso|freeze corleone|gazo|sdm|tiakola|werenoi|hamza|laylow|vald|ziak|rim'k|rohff|lacrim|kaaris|gradur|niska|maes|dadju|alonzo|soolking|fianso|naps|leto|plk|zkr|green montana|la fouine|sexion d'assaut|iam|ntm|mc solaar|oxmo puccino|kery james|youssoupha|soprano|bigflo et oli|kids united|kassav|zouk machine|jocelyne beroard|jacob desvarieux|jean-michel rotin|tanya saint val|admiral t|kalash|fally ipupa|werrason|koffi olomide|ferre gola|innoss'b|burna boy|wizkid|davido|asake|rema|tiwa savage|tems|ckay|omah lay|fireboy dml)/i
    ];

    for (const pattern of patterns) {
        const match = message.match(pattern);
        if (match) {
            // Clean up the extracted name
            let artist = match[1] || match[0];
            artist = artist.replace(/[?.!,;:]$/g, '').trim();
            // Remove leading noise like "le son avec", "le sons avec", "la musique de"
            artist = artist.replace(/^(le\s+sons?\s+(?:de|du|avec|sur)\s+|les\s+sons?\s+(?:de|du|avec|sur)\s+|la\s+(?:musique|zik|chanson)\s+(?:de|du|avec|sur)\s+)/i, '').trim();
            // Remove filler words and slang noise
            artist = artist.replace(/\b(stp|svp|please|maintenant|now|un peu de|quelque chose de|du son de|la zik de|poto|fréro|frere|wesh|yo|bro|man|dude|chef|boss|gars)\b/gi, '').trim();
            // Remove trailing prepositions
            artist = artist.replace(/\s+(de|du|des|la|le|les|sur|avec|pour)$/i, '').trim();
            if (artist.length > 1 && artist.length < 100) {
                return artist;
            }
        }
    }
    return null;
}

// Chat endpoint
app.post('/chat', async (req, res) => {
    const { userId, message, withVoice } = req.body;

    if (!message) {
        return res.status(400).json({ error: 'Message required' });
    }

    const uid = userId || 'anonymous';
    console.log(`[Zikao] ${uid}: "${message.substring(0, 50)}..."`);

    try {
        // Check if user wants web search FIRST, so we can include results in Zikao's response
        let webSearch = null;
        let webContext = '';

        if (wantsWebSearch(message)) {
            const searchQuery = extractSearchQuery(message);
            if (searchQuery && searchQuery.length > 2) {
                console.log(`[Zikao] Web search for: "${searchQuery}"`);
                webSearch = await searchWeb(searchQuery);

                // Build context from search results for Zikao
                if (webSearch && webSearch.results && webSearch.results.length > 0) {
                    const topResults = webSearch.results.slice(0, 3);
                    webContext = '\n\n[INFORMATIONS WEB RÉCENTES]\n' +
                        topResults.map((r, i) => `${i + 1}. ${r.title}: ${r.content?.substring(0, 300) || 'Pas de contenu'}...`).join('\n') +
                        '\n[FIN DES INFORMATIONS]\n\nUtilise ces informations pour répondre de manière précise et informée.';
                    console.log(`[Zikao] Found ${topResults.length} web results to include in response`);
                }
            }
        }

        // Now ask Zikao with optional web context
        const response = await askZikao(uid, message + webContext);

        // Extract personal info and update relationship
        await extractPersonalInfo(uid, message, response.text);
        addRelationshipPoints(uid, 1, 'conversation');

        let voice = null;
        if (withVoice && OPENAI_KEY) {
            voice = await generateSpeech(response.text, response.emotion.expression);
        }

        // Check if user wants radio
        let radio = null;
        if (wantsRadio(message)) {
            const radioId = findRequestedRadio(message);
            radio = getRadio(radioId);
            if (radio) {
                radio.id = radioId;
                console.log(`[Zikao] Playing radio: ${radio.name}`);
            }
        }

        // Check if user wants video clips
        let video = null;
        if (wantsVideo(message) && !radio) {
            const requestedArtist = extractArtistFromMessage(message);
            const searchQuery = requestedArtist || message.replace(/\b(clip|video|vidéo|voir|regarde|regarder|watch|show|youtube|yt)\b/gi, '').trim();

            if (searchQuery.length > 2) {
                console.log(`[Zikao] Searching video for: ${searchQuery}`);
                video = await searchVideoClip(searchQuery);
                if (video) {
                    console.log(`[Zikao] Found video: ${video.title}`);
                    // Save cover to database
                    saveVideoCover(video);
                }
            }
        }

        // Check if user wants to listen - search for specific artist, genre, or trending
        let music = null;
        const mem = getUserMemory(uid);

        // Check for genre request first (zouk, reggae, rap, etc.)
        const genreRequest = extractGenreFromMessage(message);

        // Then try to extract artist from any message to remember it
        const mentionedArtist = extractArtistFromMessage(message);
        if (mentionedArtist) {
            mem.lastMentionedArtist = mentionedArtist;
            console.log(`[Zikao] Remembered artist: ${mentionedArtist}`);
        }

        if (wantsToListen(message) && !video && !radio) {
            // Handle genre request (e.g., "cherche du zouk")
            if (genreRequest) {
                console.log(`[Zikao] Genre request: ${genreRequest.genre}`);
                // Pick a random artist from this genre
                const randomArtist = genreRequest.artists[Math.floor(Math.random() * genreRequest.artists.length)];
                console.log(`[Zikao] Searching ${genreRequest.genre} artist: ${randomArtist}`);

                const searchResult = await searchMusic(randomArtist + ' ' + genreRequest.search, 'track');
                if (searchResult.found && searchResult.results.length > 0) {
                    // Pick a random track from results for variety
                    const randomIndex = Math.floor(Math.random() * Math.min(5, searchResult.results.length));
                    music = searchResult.results[randomIndex];
                    console.log(`[Zikao] Found ${genreRequest.genre} track: ${music.title} - ${music.artist}`);
                }
            }

            // If no genre match, try artist
            if (!music) {
                // First try to extract artist from message, or use last mentioned
                const requestedArtist = mentionedArtist || mem.lastMentionedArtist;

                if (requestedArtist) {
                    // User asked for specific artist - search by artist first
                    console.log(`[Zikao] Searching for artist: ${requestedArtist}`);

                // Search for artist
                const artistSearch = await searchMusic(requestedArtist, 'artist');
                if (artistSearch.found && artistSearch.results.length > 0) {
                    const artistId = artistSearch.results[0].id;
                    const artistName = artistSearch.results[0].name;
                    console.log(`[Zikao] Found artist: ${artistName} (${artistId})`);

                    // Get top tracks from this artist
                    const artistInfo = await getArtistInfo(artistId);
                    if (artistInfo && artistInfo.topTracks && artistInfo.topTracks.length > 0) {
                        // Get full track info with preview
                        const topTrack = artistInfo.topTracks[0];
                        const trackSearch = await searchMusic(topTrack.title + ' ' + artistName, 'track');
                        if (trackSearch.found && trackSearch.results.length > 0) {
                            // Make sure it's actually by this artist
                            const foundTrack = trackSearch.results.find(t =>
                                t.artist.toLowerCase().includes(artistName.toLowerCase()) ||
                                artistName.toLowerCase().includes(t.artist.toLowerCase())
                            ) || trackSearch.results[0];
                            music = foundTrack;
                        }
                    }
                }

                // Fallback to track search if artist search didn't work
                if (!music) {
                    const searchResult = await searchMusic(requestedArtist, 'track');
                    if (searchResult.found && searchResult.results.length > 0) {
                        music = searchResult.results[0];
                    }
                }
                }
            }

            // Fallback to trending if no specific artist found
            if (!music) {
                const news = await getMusicNews();
                if (news.trending && news.trending.length > 0) {
                    const randomTrack = news.trending[Math.floor(Math.random() * Math.min(5, news.trending.length))];
                    const searchResult = await searchMusic(randomTrack.title + ' ' + randomTrack.artist, 'track');
                    if (searchResult.found && searchResult.results.length > 0) {
                        music = searchResult.results[0];
                    }
                }
            }
        }

        res.json({
            text: response.text,
            emotion: response.emotion,
            gesture: response.gesture,
            voice: voice,
            music: music, // Include playable track if user wants to listen
            video: video, // Include video clip if user wants to watch
            radio: radio, // Include radio stream if user wants to listen
            webSearch: webSearch, // Include web search results
            timestamp: new Date().toISOString()
        });
    } catch (e) {
        console.error('Chat error:', e);
        res.status(500).json({ error: 'Internal error' });
    }
});

// Get AI-generated reaction (greeting, spontaneous thought, etc.)
app.get('/react/:type', async (req, res) => {
    const userId = req.query.userId || 'anonymous';
    const type = req.params.type;

    try {
        let response;
        if (type === 'greeting') {
            response = await generateGreeting(userId);
        } else {
            response = await generateSpontaneousThought(userId);
        }

        let voice = null;
        if (req.query.withVoice && OPENAI_KEY) {
            voice = await generateSpeech(response.text, response.emotion?.expression || 'neutral');
        }

        res.json({
            ...response,
            voice,
            timestamp: new Date().toISOString()
        });
    } catch (e) {
        console.error('Reaction error:', e);
        res.status(500).json({ error: 'Internal error' });
    }
});

// ==================== MUSIC API ====================

// Search for music (tracks or artists)
app.get('/music/search', async (req, res) => {
    const { q, type } = req.query;
    if (!q) {
        return res.status(400).json({ error: 'Query required' });
    }

    const results = await searchMusic(q, type || 'track');
    res.json(results);
});

// Get artist details
app.get('/music/artist/:id', async (req, res) => {
    const info = await getArtistInfo(req.params.id);
    if (!info) {
        return res.status(404).json({ error: 'Artist not found' });
    }
    res.json(info);
});

// Play track preview (returns audio URL)
app.get('/music/play/:trackId', async (req, res) => {
    try {
        const trackResp = await fetch(`${ADINFORMATIK_API}/track/${req.params.trackId}`);
        const track = await trackResp.json();

        if (!track.preview) {
            return res.status(404).json({ error: 'No preview available' });
        }

        res.json({
            title: track.title,
            artist: track.artist?.name,
            album: track.album?.title,
            cover: track.album?.cover_xl,
            preview: track.preview,
            duration: track.duration,
            link: track.link
        });
    } catch (e) {
        res.status(500).json({ error: 'Failed to get track' });
    }
});

// ==================== WEB RADIOS API ====================

// Get all radios
app.get('/radios', (req, res) => {
    res.json({ radios: getRadioList() });
});

// Get specific radio
app.get('/radios/:id', (req, res) => {
    const radio = getRadio(req.params.id);
    if (!radio) {
        return res.status(404).json({ error: 'Radio not found' });
    }
    res.json(radio);
});

// Get radio stream URL (for direct play)
app.get('/radios/:id/stream', (req, res) => {
    const radio = getRadio(req.params.id);
    if (!radio) {
        return res.status(404).json({ error: 'Radio not found' });
    }
    // Redirect to actual stream
    res.redirect(radio.streamUrl);
});

// ==================== VIDEO CLIPS API ====================

// Search for video clips
app.get('/video/search', async (req, res) => {
    const { q } = req.query;
    if (!q) {
        return res.status(400).json({ error: 'Query required' });
    }

    console.log(`[Zikao] Video search: ${q}`);
    const video = await searchVideoClip(q);

    if (!video) {
        return res.json({ found: false, query: q });
    }

    // Save cover to database
    saveVideoCover(video);

    res.json({ found: true, video, query: q });
});

// Get saved video covers
app.get('/video/covers', (req, res) => {
    const limit = parseInt(req.query.limit) || 20;
    const covers = getVideoCovers(limit);
    res.json({ covers, total: videoCovers.length });
});

// Get most played video covers
app.get('/video/covers/top', (req, res) => {
    const limit = parseInt(req.query.limit) || 10;
    const covers = getMostPlayedCovers(limit);
    res.json({ covers });
});

// ==================== WEB SEARCH API ====================

// Search the web
app.get('/search', async (req, res) => {
    const { q } = req.query;
    if (!q) {
        return res.status(400).json({ error: 'Query required' });
    }

    const results = await searchWeb(q);
    res.json(results);
});

// ==================== TTS API (TEXT-TO-SPEECH) ====================

app.post('/tts', async (req, res) => {
    const { text, voice, speed } = req.body;
    if (!text) return res.status(400).json({ error: 'Text required' });
    if (!OPENAI_KEY) return res.status(503).json({ error: 'TTS not configured' });

    try {
        const ttsVoice = voice || 'nova'; // nova = feminine friendly voice (default for Patricia)
        const ttsSpeed = speed || 1.0;

        const resp = await fetch(OPENAI_TTS_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_KEY}`
            },
            body: JSON.stringify({
                model: 'tts-1',
                voice: ttsVoice,
                input: text.substring(0, 4096),
                speed: ttsSpeed,
                response_format: 'mp3'
            })
        });

        if (!resp.ok) {
            const error = await resp.text();
            console.log('[Zikao] TTS API error:', resp.status, error);
            return res.status(502).json({ error: 'TTS generation failed' });
        }

        const audioBuffer = await resp.arrayBuffer();
        res.set({
            'Content-Type': 'audio/mpeg',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache'
        });
        res.send(Buffer.from(audioBuffer));
    } catch (e) {
        console.log('[Zikao] TTS error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// CORS preflight for TTS
app.options('/tts', (req, res) => {
    res.set({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.sendStatus(204);
});

// ==================== MUSIC RECOGNITION API (SHAZAM-LIKE) ====================

// Recognize music from audio
app.post('/recognize', async (req, res) => {
    const { audio, url, format } = req.body;

    if (!audio && !url) {
        return res.status(400).json({
            error: 'Audio data or URL required',
            hint: 'Send base64 audio in "audio" field or audio URL in "url" field'
        });
    }

    console.log(`[Zikao] Music recognition request (${url ? 'URL' : 'audio data'})`);

    let result;
    if (url) {
        result = await recognizeSong(url, 'url');
    } else {
        result = await recognizeSong(audio, format || 'base64');
    }

    res.json(result);
});

// Check recognition API status
app.get('/recognize/status', (req, res) => {
    res.json({
        acrcloud: {
            configured: !!(ACRCLOUD_HOST && ACRCLOUD_KEY && ACRCLOUD_SECRET),
            host: ACRCLOUD_HOST ? ACRCLOUD_HOST.replace(/^(.{10}).*/, '$1...') : null
        },
        audd: {
            configured: !!AUDD_KEY
        },
        available: !!(ACRCLOUD_KEY || AUDD_KEY),
        instructions: {
            acrcloud: "Set ACRCLOUD_HOST, ACRCLOUD_KEY, ACRCLOUD_SECRET in .env",
            audd: "Set AUDD_KEY in .env (get key at https://audd.io)"
        }
    });
});

// Recognize song from radio stream (server-side capture using https module)
app.post('/recognize/radio', async (req, res) => {
    const { radioId, streamUrl } = req.body;

    let url = streamUrl;
    if (!url && radioId) {
        const radio = getRadio(radioId);
        if (radio) {
            url = radio.streamUrl;
        }
    }

    if (!url) {
        return res.status(400).json({ error: 'Radio ID or stream URL required' });
    }

    console.log(`[Zikao] Radio recognition: ${radioId || url}`);

    try {
        // Use https/http module for reliable streaming
        const httpModule = url.startsWith('https') ? require('https') : require('http');
        const chunks = [];
        const targetSize = 128 * 1024 * 10; // ~10 seconds at 128kbps

        const audioBuffer = await new Promise((resolve, reject) => {
            const request = httpModule.get(url, {
                headers: {
                    'User-Agent': 'Zikao/1.0',
                    'Accept': 'audio/mpeg, audio/*'
                },
                timeout: 15000
            }, (response) => {
                // Handle redirects
                if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                    console.log(`[Zikao] Following redirect to: ${response.headers.location}`);
                    const redirectUrl = response.headers.location;
                    const redirectModule = redirectUrl.startsWith('https') ? require('https') : require('http');

                    redirectModule.get(redirectUrl, {
                        headers: { 'User-Agent': 'Zikao/1.0' },
                        timeout: 15000
                    }, (redirectResponse) => {
                        let totalSize = 0;
                        redirectResponse.on('data', (chunk) => {
                            chunks.push(chunk);
                            totalSize += chunk.length;
                            if (totalSize >= targetSize) {
                                redirectResponse.destroy();
                            }
                        });
                        redirectResponse.on('end', () => resolve(Buffer.concat(chunks)));
                        redirectResponse.on('error', reject);
                    }).on('error', reject).on('timeout', () => reject(new Error('Timeout')));
                    return;
                }

                if (response.statusCode !== 200) {
                    reject(new Error(`HTTP ${response.statusCode}`));
                    return;
                }

                let totalSize = 0;
                response.on('data', (chunk) => {
                    chunks.push(chunk);
                    totalSize += chunk.length;
                    if (totalSize >= targetSize) {
                        response.destroy();
                    }
                });
                response.on('end', () => resolve(Buffer.concat(chunks)));
                response.on('close', () => resolve(Buffer.concat(chunks)));
                response.on('error', reject);
            });

            request.on('error', reject);
            request.on('timeout', () => {
                request.destroy();
                reject(new Error('Request timeout'));
            });

            // Force stop after 12 seconds
            setTimeout(() => {
                if (chunks.length > 0) {
                    request.destroy();
                    resolve(Buffer.concat(chunks));
                }
            }, 12000);
        });

        console.log(`[Zikao] Captured ${audioBuffer.length} bytes from radio stream`);

        if (audioBuffer.length < 50000) {
            return res.json({
                found: false,
                message: 'Pas assez de données audio capturées'
            });
        }

        // Send to recognition
        const result = await recognizeSong(audioBuffer, 'buffer');

        if (result.found || result.success) {
            console.log(`[Zikao] Radio recognition: ${result.title} - ${result.artist}`);
        } else {
            console.log(`[Zikao] Radio recognition: no match`);
        }

        res.json(result);

    } catch (e) {
        console.error('[Zikao] Radio recognition error:', e.message);
        res.status(500).json({
            error: 'Recognition failed',
            message: e.message
        });
    }
});

// ==================== SINGING API ====================

// Ask Zikao to sing
app.post('/sing', async (req, res) => {
    const { userId, request } = req.body;
    if (!request) {
        return res.status(400).json({ error: 'Request required' });
    }

    console.log(`[Zikao Sing] ${userId || 'anon'}: "${request}"`);

    const result = await zikaoSing(userId || 'anonymous', request);
    res.json(result);
});

// Serve generated songs
app.use('/songs', express.static(SONGS_DIR));

// ==================== RELATIONSHIP API ====================

// Get relationship status
app.get('/relationship/:userId', (req, res) => {
    const rel = getRelationship(req.params.userId);
    res.json({
        level: rel.level,
        points: rel.points,
        firstMet: rel.firstMet,
        personalInfo: rel.personalInfo,
        musicTaste: rel.musicTaste,
        sharedMemories: rel.sharedMemories.slice(-10)
    });
});

// Update personal info
app.post('/relationship/:userId', (req, res) => {
    const rel = getRelationship(req.params.userId);
    const { name, birthday, location, lovedArtists, hatedArtists } = req.body;

    if (name) rel.personalInfo.name = name;
    if (birthday) rel.birthday = birthday;
    if (location) rel.personalInfo.location = location;
    if (lovedArtists) rel.musicTaste.lovedArtists.push(...lovedArtists);
    if (hatedArtists) rel.musicTaste.hatedArtists.push(...hatedArtists);

    saveRelationships();
    res.json({ ok: true, relationship: rel });
});

// ==================== NEWS & RECOMMENDATIONS ====================

// Get music news and trending
app.get('/news', async (req, res) => {
    const news = await getMusicNews();
    res.json(news);
});

// Get personalized recommendations
app.get('/recommendations/:userId', async (req, res) => {
    const recs = await getPersonalizedRecommendations(req.params.userId);
    res.json(recs);
});

// ==================== PROACTIVE & STORIES ====================

// Get proactive message
app.get('/proactive/:userId', async (req, res) => {
    const message = await generateProactiveMessage(req.params.userId);
    res.json(message);
});

// Get Zikao's stories/posts
app.get('/stories', (req, res) => {
    res.json(stories.slice(0, 20));
});

// Create new story (internal)
app.post('/stories', async (req, res) => {
    const story = await createZikaoStory();
    res.json(story);
});

// Like a story
app.post('/stories/:id/like', (req, res) => {
    const story = stories.find(s => s.id === parseInt(req.params.id));
    if (story) {
        story.likes++;
        fs.writeFileSync(STORIES_FILE, JSON.stringify(stories, null, 2));
        res.json({ ok: true, likes: story.likes });
    } else {
        res.status(404).json({ error: 'Story not found' });
    }
});

// Comment on a story
app.post('/stories/:id/comment', (req, res) => {
    const { userId, text } = req.body;
    const story = stories.find(s => s.id === parseInt(req.params.id));
    if (story && text) {
        story.comments.push({
            userId,
            text,
            timestamp: new Date().toISOString()
        });
        fs.writeFileSync(STORIES_FILE, JSON.stringify(stories, null, 2));
        res.json({ ok: true, comments: story.comments });
    } else {
        res.status(400).json({ error: 'Invalid request' });
    }
});

// ==================== MUSIC GAMES ====================

// Start blind test
app.get('/games/blindtest/start', (req, res) => {
    const difficulty = req.query.difficulty || 'medium';
    const game = generateBlindTest(difficulty);
    res.json(game);
});

// Get blind test track
app.get('/games/blindtest/track', async (req, res) => {
    const track = await getBlindTestTrack();
    res.json(track);
});

// Check blind test answer
app.post('/games/blindtest/check', (req, res) => {
    const { trackId, guessTitle, guessArtist, correctTitle, correctArtist } = req.body;

    const titleMatch = guessTitle?.toLowerCase().includes(correctTitle?.toLowerCase()) ||
                       correctTitle?.toLowerCase().includes(guessTitle?.toLowerCase());
    const artistMatch = guessArtist?.toLowerCase().includes(correctArtist?.toLowerCase()) ||
                        correctArtist?.toLowerCase().includes(guessArtist?.toLowerCase());

    let score = 0;
    if (titleMatch && artistMatch) score = 10;
    else if (artistMatch) score = 5;
    else if (titleMatch) score = 3;

    res.json({
        correct: score >= 10,
        partialArtist: artistMatch && !titleMatch,
        partialTitle: titleMatch && !artistMatch,
        score,
        answer: { title: correctTitle, artist: correctArtist }
    });
});

// ==================== USER MEMORY ====================

// Get user memory
app.get('/memory/:userId', (req, res) => {
    const mem = getUserMemory(req.params.userId);
    res.json({
        favoriteGenres: mem.favoriteGenres,
        favoriteArtists: mem.favoriteArtists,
        totalInteractions: mem.totalInteractions,
        lastSeen: mem.lastSeen
    });
});

// Update user preferences
app.post('/memory/:userId', (req, res) => {
    const mem = getUserMemory(req.params.userId);
    const { name, genres, artists } = req.body;

    if (name) mem.name = name;
    if (genres) mem.favoriteGenres = [...new Set([...mem.favoriteGenres, ...genres])];
    if (artists) mem.favoriteArtists = [...new Set([...mem.favoriteArtists, ...artists])];

    saveMemory();
    res.json({ ok: true, memory: mem });
});

// Serve voice files
app.use('/voices', express.static(VOICES_DIR));

// Serve frontend
app.use(express.static('/opt/zikao/frontend'));

// ==================== ZIKAO'S DAILY LIFE ====================

// Get Zikao's current state based on time of day
function getZikaoCurrentState() {
    const hour = new Date().getHours();
    const day = new Date().getDay();
    const isWeekend = day === 0 || day === 6;

    let activity, mood, availability;

    if (hour >= 6 && hour < 9) {
        activity = "Premier café, je check les nouvelles sorties";
        mood = "chill";
        availability = "dispo";
    } else if (hour >= 9 && hour < 12) {
        activity = isWeekend ? "Session production tranquille" : "Je bosse sur mes playlists";
        mood = "focused";
        availability = "dispo";
    } else if (hour >= 12 && hour < 14) {
        activity = "Pause déj avec un peu de musique chill";
        mood = "chill";
        availability = "dispo";
    } else if (hour >= 14 && hour < 18) {
        activity = isWeekend ? "Préparation de mon set du soir" : "Deep dans un mix, je teste des transitions";
        mood = "focused";
        availability = "dispo";
    } else if (hour >= 18 && hour < 21) {
        activity = isWeekend ? "Soundcheck avant la soirée" : "Session écoute, je découvre des nouveaux sons";
        mood = "excited";
        availability = "dispo";
    } else if (hour >= 21 && hour < 24) {
        activity = isWeekend ? "En plein set, je fais vibrer le dancefloor!" : "Session late night, c'est là que la magie opère";
        mood = isWeekend ? "groovy" : "passionate";
        availability = isWeekend ? "en live" : "dispo";
    } else if (hour >= 0 && hour < 3) {
        activity = isWeekend ? "After party, le son est toujours là" : "Dernières idées avant de dormir";
        mood = isWeekend ? "excited" : "chill";
        availability = "dispo";
    } else {
        activity = "Mode repos, mais toujours une mélodie dans la tête";
        mood = "chill";
        availability = "repos";
    }

    return {
        activity,
        mood,
        availability,
        hour,
        isWeekend,
        emotion: ZIKAO_EMOTIONS[mood] || ZIKAO_EMOTIONS.neutral
    };
}

// Get Zikao's current status
app.get('/status', (req, res) => {
    const state = getZikaoCurrentState();
    res.json({
        ...state,
        name: "Zikao",
        title: "DJ & Digital Human",
        timestamp: new Date().toISOString()
    });
});

// Get a spontaneous message from Zikao (for notifications, etc.)
app.get('/spontaneous', async (req, res) => {
    const state = getZikaoCurrentState();
    const types = ['dailyLife', 'workingOnMix', 'idle'];
    const type = types[Math.floor(Math.random() * types.length)];
    const reaction = getAutonomousReaction(type);

    let voice = null;
    if (req.query.withVoice && OPENAI_KEY) {
        voice = await generateSpeech(reaction.text, state.mood);
    }

    res.json({
        ...reaction,
        state,
        voice,
        timestamp: new Date().toISOString()
    });
});

// ==================== WEBSOCKET (Real-time) ====================

wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const userId = url.searchParams.get('userId') || 'anonymous';

    console.log(`[Zikao WS] ${userId} connected`);

    // Send greeting
    const greeting = getAutonomousReaction('greeting');
    ws.send(JSON.stringify({
        type: 'greeting',
        ...greeting,
        timestamp: new Date().toISOString()
    }));

    ws.on('message', async (raw) => {
        try {
            const data = JSON.parse(raw);

            if (data.type === 'message') {
                // Send typing indicator
                ws.send(JSON.stringify({ type: 'typing', isTyping: true }));

                const response = await askZikao(userId, data.text);

                let voice = null;
                if (data.withVoice && OPENAI_KEY) {
                    voice = await generateSpeech(response.text, response.emotion.expression);
                }

                ws.send(JSON.stringify({
                    type: 'response',
                    ...response,
                    voice: voice,
                    timestamp: new Date().toISOString()
                }));
            }
        } catch (e) {
            console.error('WS error:', e);
        }
    });

    ws.on('close', () => {
        console.log(`[Zikao WS] ${userId} disconnected`);
    });
});

// ==================== START SERVER ====================

server.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║     ███████╗██╗██╗  ██╗ █████╗  ██████╗                      ║
║     ╚══███╔╝██║██║ ██╔╝██╔══██╗██╔═══██╗                     ║
║       ███╔╝ ██║█████╔╝ ███████║██║   ██║                     ║
║      ███╔╝  ██║██╔═██╗ ██╔══██║██║   ██║                     ║
║     ███████╗██║██║  ██╗██║  ██║╚██████╔╝                     ║
║     ╚══════╝╚═╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝                      ║
║                                                               ║
║     🎧 ÊTRE HUMAIN NUMÉRIQUE - DJ MUSICAL                    ║
║                                                               ║
║     Port: ${PORT}                                                ║
║     OpenAI TTS: ${OPENAI_KEY ? '✅ Configuré' : '❌ Non configuré'}                              ║
║     Voice: ${OPENAI_VOICE}                                             ║
║                                                               ║
║     "La musique, c'est ma vie. Littéralement."               ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
    `);
});
