import 'dotenv/config';

export default {
  api: {
    endpoint: 'https://api.laozhang.ai/v1beta/models/gemini-3-pro-image-preview:generateContent',
    key: process.env.API_KEY,
    maxRetries: 0,
    retryBaseDelay: 2000, // ms, exponential backoff: 2s → 4s → 8s
  },
  generation: {
    aspectRatio: '3:4',
    imageSize: '2K',
    concurrency: 3,
  },
  poses: {
    dir: 'poses',
  },
  sessions: {
    dir: 'output/sessions',
  },
  detailPage: {
    width: 790, // px, final stitch width
  },
  server: {
    port: 3000,
  },
};
