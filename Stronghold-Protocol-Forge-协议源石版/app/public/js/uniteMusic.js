// 联防音乐 (settings 联防音乐): the player's own track for 联防, in place of the manifest's `bgm.unite`
// (m_bat_corrosion, the official escaped levels' `bgmEvent = corrosion` — docs/ASSETS.md "BGM").
//
// The file is NOT part of the repository: `public/assets/` is git-ignored (no game art, no third-party audio in git),
// so a checkout that does not have it plays 联防's official track — audio.js `_startBgm` falls back to the manifest's
// entry when the custom file does not load. Dropping a file at this path is the whole installation:
//
//     public/assets/audio/bgm/unite_rainlove_dj.m4a
//
// (`.m4a` = the AAC container of the track as delivered; the manifest's BGM entries are .mp3, and both go through the
// same route.) It is fetched through the usual extension-less `/media/bgm/unite_rainlove_dj` route (public/js/media.js),
// so a download manager never pops up for it, and it rides the ordinary BGM channel: 设置 → 背景音乐 and 静音 apply.
//
// The file on disk is a 64 kbps AAC re-encode (95 s, 0.74 MB — the delivered source was 1.31 MB / 116 kbps), loudness
// normalised to −15 LUFS so it sits where the official BGM does (m_bat_corrosion is −14.9 LUFS; the raw file was
// −20.7 LUFS, i.e. it would have played noticeably quieter than every other track). Re-encode with ffmpeg if the
// source changes:
//
//     ffmpeg -i source.mp3 -map 0:a:0 -af "loudnorm=I=-15:TP=-2:LRA=11" -c:a aac -b:a 64k -ar 44100 -ac 2 \
//            -map_metadata -1 -movflags +faststart public/assets/audio/bgm/unite_rainlove_dj.m4a

/** 联防's own track while 联防音乐 is on (URL, relative to the page — the manifest's BGM entries look the same). */
export const UNITE_TRACK_URL = '/assets/audio/bgm/unite_rainlove_dj.m4a';

/**
 * The custom 联防 track these settings ask for.
 * @param {{ uniteMusic?: boolean }|null|undefined} s the settings store's value (or a snapshot of it)
 * @returns {string|null} UNITE_TRACK_URL while 联防音乐 is on, else null (the manifest's `bgm.unite`)
 */
export const uniteTrackFor = (s) => (s?.uniteMusic ? UNITE_TRACK_URL : null);
