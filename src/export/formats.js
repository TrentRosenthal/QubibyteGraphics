/**
 * Export formats, resolution presets, and FFmpeg argument builders for the
 * Node CLI (native FFmpeg). The browser export encodes with WebCodecs.
 * @module export/formats
 */

/**
 * @typedef {Object} FormatSpec
 * @property {string} id
 * @property {string} label
 * @property {string} ext
 * @property {'video'|'sequence'|'image'} kind
 * @property {boolean} alpha Whether transparent backgrounds are preserved.
 * @property {string[]} videoArgs FFmpeg output arguments for the video stream.
 * @property {string[]} [audioArgs] FFmpeg output arguments for audio, when the container carries audio.
 * @property {string} [pixFmt]
 * @property {boolean} [twoPassPalette] GIF palette generation.
 * @property {boolean} [evenDimensions] Codec requires even width and height.
 */

/** @type {Record<string, FormatSpec>} */
export const FORMATS = {
  'mp4': { id: 'mp4', label: 'MP4 (H.264)', ext: 'mp4', kind: 'video', alpha: false, evenDimensions: true, videoArgs: ['-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'], audioArgs: ['-c:a', 'aac', '-b:a', '192k'] },
  'mp4-h265': { id: 'mp4-h265', label: 'MP4 (H.265 / HEVC)', ext: 'mp4', kind: 'video', alpha: false, evenDimensions: true, videoArgs: ['-c:v', 'libx265', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1', '-movflags', '+faststart'], audioArgs: ['-c:a', 'aac', '-b:a', '192k'] },
  'webm': { id: 'webm', label: 'WebM (VP9)', ext: 'webm', kind: 'video', alpha: true, videoArgs: ['-c:v', 'libvpx-vp9', '-crf', '24', '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2'], audioArgs: ['-c:a', 'libopus', '-b:a', '160k'] },
  'webm-av1': { id: 'webm-av1', label: 'WebM (AV1)', ext: 'webm', kind: 'video', alpha: false, evenDimensions: true, videoArgs: ['-c:v', 'libsvtav1', '-crf', '30', '-preset', '6', '-pix_fmt', 'yuv420p'], audioArgs: ['-c:a', 'libopus', '-b:a', '160k'] },
  'mov-prores': { id: 'mov-prores', label: 'MOV (ProRes 422 HQ)', ext: 'mov', kind: 'video', alpha: false, evenDimensions: true, videoArgs: ['-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le', '-vendor', 'apl0'], audioArgs: ['-c:a', 'pcm_s16le'] },
  'mov-prores4444': { id: 'mov-prores4444', label: 'MOV (ProRes 4444 with alpha)', ext: 'mov', kind: 'video', alpha: true, evenDimensions: true, videoArgs: ['-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le', '-alpha_bits', '16', '-vendor', 'apl0'], audioArgs: ['-c:a', 'pcm_s16le'] },
  'mkv': { id: 'mkv', label: 'MKV (H.264)', ext: 'mkv', kind: 'video', alpha: false, evenDimensions: true, videoArgs: ['-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p'], audioArgs: ['-c:a', 'flac'] },
  'gif': { id: 'gif', label: 'GIF', ext: 'gif', kind: 'video', alpha: false, twoPassPalette: true, videoArgs: [] },
  'apng': { id: 'apng', label: 'Animated PNG', ext: 'png', kind: 'video', alpha: true, videoArgs: ['-c:v', 'apng', '-plays', '0', '-f', 'apng'] },
  'webp': { id: 'webp', label: 'Animated WebP', ext: 'webp', kind: 'video', alpha: true, videoArgs: ['-c:v', 'libwebp_anim', '-lossless', '0', '-quality', '90', '-loop', '0'] },
  'png-seq': { id: 'png-seq', label: 'PNG sequence', ext: 'png', kind: 'sequence', alpha: true, videoArgs: [] },
  'jpeg-seq': { id: 'jpeg-seq', label: 'JPEG sequence', ext: 'jpg', kind: 'sequence', alpha: false, videoArgs: [] },
  'webp-seq': { id: 'webp-seq', label: 'WebP sequence', ext: 'webp', kind: 'sequence', alpha: true, videoArgs: [] },
  'svg-seq': { id: 'svg-seq', label: 'SVG sequence', ext: 'svg', kind: 'sequence', alpha: true, videoArgs: [] },
  'png': { id: 'png', label: 'PNG still', ext: 'png', kind: 'image', alpha: true, videoArgs: [] },
  'jpeg': { id: 'jpeg', label: 'JPEG still', ext: 'jpg', kind: 'image', alpha: false, videoArgs: [] },
  'svg': { id: 'svg', label: 'SVG still', ext: 'svg', kind: 'image', alpha: true, videoArgs: [] },
  'pdf': { id: 'pdf', label: 'PDF still', ext: 'pdf', kind: 'image', alpha: true, videoArgs: [] },
  'svg-animated': { id: 'svg-animated', label: 'Animated SVG', ext: 'svg', kind: 'image', alpha: true, videoArgs: [] },
  'lottie': { id: 'lottie', label: 'Lottie JSON', ext: 'json', kind: 'image', alpha: true, videoArgs: [] },
};

/**
 * Guess a format id from an output file name.
 * @param {string} file
 * @returns {string}
 */
export function formatFromFilename(file) {
  const lower = file.toLowerCase();
  if (lower.endsWith('.lottie.json') || lower.endsWith('.json')) return 'lottie';
  const ext = lower.slice(lower.lastIndexOf('.') + 1);
  const map = { mp4: 'mp4', webm: 'webm', mov: 'mov-prores', mkv: 'mkv', gif: 'gif', apng: 'apng', webp: 'webp', png: 'png', jpg: 'jpeg', jpeg: 'jpeg', svg: 'svg', pdf: 'pdf' };
  if (!map[ext]) throw new Error(`Cannot infer a format from "${file}". Pass --format.`);
  return map[ext];
}

/** Named resolutions (16:9 unless noted). @type {Record<string, [number, number]>} */
export const RESOLUTIONS = {
  '240p': [426, 240],
  '360p': [640, 360],
  '480p': [854, 480],
  '720p': [1280, 720],
  '1080p': [1920, 1080],
  '1440p': [2560, 1440],
  '4k': [3840, 2160],
  '2160p': [3840, 2160],
  '5k': [5120, 2880],
  '8k': [7680, 4320],
  '4320p': [7680, 4320],
};

/**
 * Platform presets: size, frame rate, and format.
 * @type {Record<string, {width: number, height: number, fps: number, format: string, label: string}>}
 */
export const PRESETS = {
  youtube: { width: 1920, height: 1080, fps: 60, format: 'mp4', label: 'YouTube 1080p60' },
  'youtube-4k': { width: 3840, height: 2160, fps: 60, format: 'mp4', label: 'YouTube 4K60' },
  shorts: { width: 1080, height: 1920, fps: 60, format: 'mp4', label: 'Shorts, Reels, TikTok (9:16)' },
  reels: { width: 1080, height: 1920, fps: 30, format: 'mp4', label: 'Instagram Reels (9:16)' },
  tiktok: { width: 1080, height: 1920, fps: 30, format: 'mp4', label: 'TikTok (9:16)' },
  twitter: { width: 1280, height: 720, fps: 30, format: 'mp4', label: 'X / Twitter 720p' },
  'twitter-square': { width: 1080, height: 1080, fps: 30, format: 'mp4', label: 'X / Twitter square' },
  linkedin: { width: 1080, height: 1350, fps: 30, format: 'mp4', label: 'LinkedIn portrait (4:5)' },
  'linkedin-landscape': { width: 1920, height: 1080, fps: 30, format: 'mp4', label: 'LinkedIn landscape' },
  slides: { width: 1920, height: 1080, fps: 30, format: 'mp4', label: 'Slide deck 16:9' },
  'slides-4x3': { width: 1440, height: 1080, fps: 30, format: 'mp4', label: 'Slide deck 4:3' },
  gif: { width: 960, height: 540, fps: 30, format: 'gif', label: 'GIF 540p' },
};

/**
 * Parse a resolution argument: '1080p', '4k', '1920x1080', or a preset name.
 * An aspect like '1080p' combined with `aspect` '9:16' gives 1080x1920.
 * @param {string} res
 * @param {string} [aspect]
 * @returns {[number, number]}
 */
export function parseResolution(res, aspect) {
  const key = String(res).toLowerCase();
  let wh;
  if (RESOLUTIONS[key]) wh = RESOLUTIONS[key].slice();
  else if (PRESETS[key]) wh = [PRESETS[key].width, PRESETS[key].height];
  else {
    const m = /^(\d+)x(\d+)$/.exec(key);
    if (!m) throw new Error(`Unknown resolution "${res}". Use 1080p, 4k, 1920x1080, or a preset.`);
    wh = [Number(m[1]), Number(m[2])];
  }
  if (aspect) {
    const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspect);
    if (!m) throw new Error(`Aspect must look like 16:9, got "${aspect}"`);
    const ar = Number(m[1]) / Number(m[2]);
    const short = Math.min(wh[0], wh[1]);
    wh = ar >= 1 ? [Math.round(short * ar), short] : [short, Math.round(short / ar)];
  }
  if (wh[0] < 16 || wh[1] < 16 || wh[0] > 16384 || wh[1] > 16384) throw new Error('Resolution out of range (16 to 16384 pixels per side)');
  return wh;
}

/**
 * Validate a frame rate (1 to 240).
 * @param {number} fps
 * @returns {number}
 */
export function checkFps(fps) {
  const f = Number(fps);
  if (!Number.isFinite(f) || f < 1 || f > 240) throw new Error('Frame rate must be between 1 and 240');
  return f;
}

/**
 * FFmpeg arguments for the final encode from an input that is already a
 * stream of frames (either raw RGBA on a pipe or intermediate files).
 * @param {Object} o
 * @param {string} o.format format id
 * @param {string[]} o.inputArgs arguments describing the video input
 * @param {string} o.output output path
 * @param {number} o.fps
 * @param {string|null} [o.audio] path to an audio file to mux
 * @param {string|null} [o.subtitles] path to an SRT file to embed as a soft subtitle track
 * @param {boolean} [o.transparent]
 * @param {{dither?: string, colors?: number}} [o.gif]
 * @returns {string[]}
 */
export function ffmpegArgs(o) {
  const spec = FORMATS[o.format];
  if (!spec || spec.kind !== 'video') throw new Error(`Format "${o.format}" is not a video format`);
  const args = ['-y', '-hide_banner', '-loglevel', 'error', ...o.inputArgs];
  let nextInput = 1;
  let audioIndex = -1;
  let subIndex = -1;
  if (o.audio && spec.audioArgs) {
    args.push('-i', o.audio);
    audioIndex = nextInput++;
  }
  if (o.subtitles && (spec.ext === 'mp4' || spec.ext === 'mkv' || spec.ext === 'mov')) {
    args.push('-i', o.subtitles);
    subIndex = nextInput;
  }
  if (spec.twoPassPalette) {
    const colors = o.gif?.colors ?? 256;
    const dither = o.gif?.dither ?? 'sierra2_4a';
    args.push('-filter_complex', `[0:v]split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=${dither}:diff_mode=rectangle`, '-loop', '0');
  } else {
    args.push('-map', '0:v');
    const vf = [];
    if (spec.evenDimensions) vf.push('pad=ceil(iw/2)*2:ceil(ih/2)*2');
    if (o.transparent && spec.alpha && o.format === 'webm') args.push('-pix_fmt', 'yuva420p', '-auto-alt-ref', '0');
    if (vf.length) args.push('-vf', vf.join(','));
    args.push(...spec.videoArgs);
    if (audioIndex > 0) args.push('-map', `${audioIndex}:a`, ...spec.audioArgs);
    if (subIndex > 0) args.push('-map', `${subIndex}:s`, '-c:s', spec.ext === 'mp4' || spec.ext === 'mov' ? 'mov_text' : 'srt');
  }
  args.push('-r', String(o.fps), o.output);
  return args;
}
