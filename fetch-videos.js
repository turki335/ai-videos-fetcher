const admin = require('firebase-admin');
const axios = require('axios');
const { format } = require('date-fns');

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const MAX_DAILY_VIDEOS = 40;
const TARGET_HOUR = 18;
const REQUEST_DELAY = 1500;

const CHANNELS = [
'UCksiqtuWYtN2YluvAQnV2dQ', // Doechii
'UCuHvKRvLtJk7Rz1Ga4vk_oQ', // Chris Colditz
'UCECU4vZ2a0Tuu8s6IkPvmlw', // ItsSharkBait
'UCKKXBbKDDk7b4VhD6SKmTUw', // SKY
'UCnUnQLGIBnyFkyK-RHoolYw', // CursorGemink
'UCjp_3PEaOau_nT_3vnqKIvg', // Junya
'UCQ7Lgy-cBH0tJyEiRKNBJbQ', // katebrush
'UCWheC07UYzRWXsv9yUnZJFw', // FUNNY
'UCHA7nav_7GnACDpLca3CoEA', // Movie Digger
'UCj2LHSBZJOMT0a9QVPCfhmQ', // alifsedits
'UCfR_qz9WBrAuwWg57hDilSw', // MEZOooo
'UCKuHFYu3smtrl2AwwMOXOlg', // Will Smith
'UC9hJ5XcjHXYjwDOqrlQUuow', // Saad Lamjarred
'UCJCj2HtcnbOyCj1rmKaxwJg', // Mohamed Ramadan
'UCxcwb1pqg2BtlR1AWSEX-MA', // MovieLuxeShorts
'UCDwzLWgGft47xQ30u-vjsrg', // Nikocado Avocado
'UCo-roQuba3lhinCfHCPH5xg', // realmadrid
'UCgAGG57rMYXOVX1tGzEbS3Q', // Reel Rush Retro
'UCiBsG3WPwViGjD0_UMNPyyA', // PaulHughes8995
'UC06hDL3xAoW5PAWFbRsA3XQ', // Jake Ceja
'UCpOCUPuhb-7-1nJTAkFdQmg', // Cross
'UCEmiFcbdHjOr-Fap1wtn_Eg', // DarkGhostz
'UCjL2PLD-yCkW1eF2n2mj17A', // Hamza ACH TEMA
'UCgTGNW6muQstaepTdYVPSrA', // CLICK STUDIO
'UCQgJ_-jor303b66orI0NlOw', // XY Being
'UChfdidbjuzN-kctBB-DXdYQ', // Ask Laften lamen 
'UC0BkmSnNP27tXmTPbnlnLew', // Kardeşlerim
'UCEuzpECVAdEpLV2EF_1tLNw', // ALLEditedBy
'UClzlDrCsu8JyDwYYGDh0ing', // Price of Passion
'UCV_UnXMvco4uaqeMMBMWcxA', // Cartoon Network MENA
'UCvK8MMhlYSL7nxkhFvFCZNg', // Mucize Doktor
'UCBbFJIrfEGfXAM4jwKYwytw', // Çukur
'UCa_FYJ0PvHeR6Oplugm_Kmw', //  abody sorie
'UCEGDtSn99maZy025ZrmjClA', // Kara Sevda
'UCghWOHU8RjSkOMm6HaiScMg', // Erkenci Kuş
'UCiLjmA70t_77XFGj9UVOq_Q', // TRT Drama Arabic
'UCQ6SMOd5_Goop14_P5L_Leg', // The Promise Arabic
'UCn3MeethjoqLhv1NV2hs91Q', // Fazilet Hanım ve Kızları
'UC8IlPn7Tq1E5Ktb9Cf_OR3w', // Vanzs001
'UCqV8uC1lHHVdbDdw-si976g'  // JRDAnime
];

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`
});
const db = admin.firestore();

const channelCache = new Map();

async function fetchVideos() {
    try {
        if (!isRightTime()) {
            console.log('⏳ Not the scheduled time (6 PM Morocco)');
            return;
        }

        if (await isDailyLimitReached()) {
            console.log(`🎯 Daily limit reached (${MAX_DAILY_VIDEOS} videos)`);
            return;
        }

        const videos = await fetchAllVideos();
        
        if (videos.length > 0) {
            await saveVideos(videos);
            console.log(
                `✅ Added ${videos.length} videos\n` +
                `📊 Quota used: ${calculateQuota(videos.length)} units\n` +
                `⏰ ${format(new Date(), 'yyyy-MM-dd HH:mm')}`
            );
        } else {
            console.log('⚠️ No new videos found today');
        }

        await logExecution(videos.length);

    } catch (error) {
        console.error('❌ Main error:', error);
        await logError(error);
        process.exit(0);
    }
}

function isRightTime() {
    const now = new Date();
    const moroccoTime = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Casablanca' }));
    return moroccoTime.getHours() === TARGET_HOUR;
}

async function isDailyLimitReached() {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    
    const snapshot = await db.collection('videos')
        .where('timestamp', '>=', todayStart)
        .count()
        .get();

    return snapshot.data().count >= MAX_DAILY_VIDEOS;
}

async function fetchAllVideos() {
    const videos = [];
    
    for (const channelId of CHANNELS) {
        try {
            await delay(REQUEST_DELAY);
            const video = await fetchChannelVideo(channelId);
            if (video) videos.push(video);
        } catch (error) {
            console.error(`❌ ${channelId}:`, error.message);
        }
    }
    
    return videos;
}

async function fetchChannelVideo(channelId) {
    const videoId = await getLatestVideoId(channelId);
    if (!videoId) return null;

    if (await isVideoExists(videoId)) {
        console.log(`⏭️ Skipping existing video: ${videoId}`);
        return null;
    }

    return await getVideoDetails(videoId);
}

async function getLatestVideoId(channelId) {
    const response = await axios.get(
        `https://www.googleapis.com/youtube/v3/search?key=${YOUTUBE_API_KEY}` +
        `&channelId=${channelId}&part=snippet&order=date` +
        `&maxResults=1&type=video&videoDuration=short` +
        `&fields=items(id(videoId),snippet(title))`
    );

    return response.data.items[0]?.id.videoId;
}

async function isVideoExists(videoId) {
    const doc = await db.collection('videos').doc(videoId).get();
    return doc.exists;
}

async function getVideoDetails(videoId) {
    const response = await axios.get(
        `https://www.googleapis.com/youtube/v3/videos?key=${YOUTUBE_API_KEY}` +
        `&id=${videoId}&part=snippet,contentDetails,statistics` +
        `&fields=items(snippet(title,description,thumbnails/high,channelId),contentDetails/duration,statistics)`
    );

    const item = response.data.items[0];
    if (!item) return null;

    const duration = parseDuration(item.contentDetails.duration);
    if (duration > 180) return null;

    const channelInfo = await getChannelInfo(item.snippet.channelId);
    
    // Extract music information from description
    const musicInfo = extractMusicInfo(item.snippet.description);
    
    return {
        videoId,
        title: item.snippet.title,
        description: item.snippet.description,
        thumbnail: item.snippet.thumbnails.high.url,
        duration: item.contentDetails.duration,
        durationSeconds: duration,
        creatorUsername: channelInfo.title,
        creatorAvatar: channelInfo.avatar,
        isVerified: channelInfo.isVerified,
        likes: parseInt(item.statistics?.likeCount || 0),
        comments: parseInt(item.statistics?.commentCount || 0),
        music: musicInfo,
        isAI: true,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
    };
}

function extractMusicInfo(description) {
    // Patterns to detect music information
    const patterns = [
        /Music in this video[\s\S]*?Learn more[\s\S]*?Song\s*(.*?)\s*Artist\s*(.*?)\s*Licensed to YouTube by/i,
        /🎵 Music[\s:]*([^\n]*)/i,
        /Track:?\s*(.*?)\s*by\s*(.*?)(?:\n|$)/i,
        /Song:?\s*(.*?)(?:\n|$)/i,
        /Sound:?\s*(.*?)(?:\n|$)/i,
        /Original sound - (.*)/i
    ];

    for (const pattern of patterns) {
        const match = description.match(pattern);
        if (match) {
            if (match[1] && match[2]) {
                return {
                    type: 'youtube_music',
                    song: match[1].trim(),
                    artist: match[2].trim(),
                    isOriginal: false
                };
            } else if (match[1]) {
                return {
                    type: match[0].includes('Original sound') ? 'original_sound' : 'unknown_music',
                    song: match[1].trim(),
                    artist: null,
                    isOriginal: match[0].includes('Original sound')
                };
            }
        }
    }

    // Check for common music tags
    if (description.includes('epidemicsound') || description.includes('Epidemic Sound')) {
        return {
            type: 'epidemic_sound',
            song: null,
            artist: null,
            isOriginal: false
        };
    }

    if (description.includes('No copyright music') || description.includes('NCS')) {
        return {
            type: 'no_copyright_sound',
            song: null,
            artist: null,
            isOriginal: false
        };
    }

    // Default to original sound if no music info found
    return {
        type: 'original_sound',
        song: null,
        artist: null,
        isOriginal: true
    };
}

async function getChannelInfo(channelId) {
    if (channelCache.has(channelId)) {
        return channelCache.get(channelId);
    }

    const response = await axios.get(
        `https://www.googleapis.com/youtube/v3/channels?key=${YOUTUBE_API_KEY}` +
        `&id=${channelId}&part=snippet,status` +
        `&fields=items(snippet(title,thumbnails/high/url),status)`
    );

    const data = response.data.items[0];
    const result = {
        title: data.snippet.title,
        avatar: data.snippet.thumbnails.high.url,
        isVerified: data.status?.longUploadsStatus === "eligible"
    };

    channelCache.set(channelId, result);
    return result;
}

async function saveVideos(videos) {
    const batch = db.batch();
    
    videos.forEach(video => {
        const ref = db.collection('videos').doc(video.videoId);
        batch.set(ref, video);
    });
    
    await batch.commit();
}

async function logExecution(count) {
    await db.collection('logs').add({
        date: admin.firestore.FieldValue.serverTimestamp(),
        videoCount: count,
        quotaUsed: calculateQuota(count)
    });
}

async function logError(error) {
    await db.collection('errors').add({
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        message: error.message,
        stack: error.stack
    });
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function parseDuration(duration) {
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    return (parseInt(match?.[1] || 0) * 3600) +
          (parseInt(match?.[2] || 0) * 60) +
          (parseInt(match?.[3] || 0));
}

function calculateQuota(videoCount) {
    return videoCount * 102;
}

fetchVideos();
