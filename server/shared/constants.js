// Shared between the Node server, the Cloudflare Worker, and (by copy) the extension.
export const BUCKET_SECONDS = 300;   // snapshot granularity: one JSON file per 5 minutes of video
export const HIST_SECONDS = 10;      // timeline-density histogram resolution in meta.json
export const TOP_N = 100;            // top-liked top-level comments in meta.json
export const NEWEST_N = 50;          // newest top-level comments in meta.json
export const MAX_BODY = 1000;
export const MAX_NAME = 40;
export const MAX_TITLE = 200;
export const ID_RE = /^[\w-]{4,64}$/;        // client-generated user ids
export const VIDEO_ID_RE = /^[\w.-]{1,64}$/; // Netflix uses numeric ids; mock uses words
