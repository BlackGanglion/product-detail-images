import config from '../../config/default.js';

const { endpoint, key, maxRetries, retryBaseDelay } = config.api;

/**
 * Call the Nano Banana Pro (Gemini) image generation API.
 *
 * @param {string} promptText - The text prompt
 * @param {Array<{mimeType: string, base64: string}>} images - Images to include
 * @returns {Promise<string>} - base64-encoded generated image
 */
export async function generateImage(promptText, images, options = {}) {
  const parts = [
    { text: promptText },
    ...images.map(img => ({
      inline_data: { mime_type: img.mimeType, data: img.base64 },
    })),
  ];

  const body = {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig: {
        aspectRatio: options.aspectRatio || config.generation.aspectRatio,
        imageSize: options.imageSize || config.generation.imageSize,
      },
    },
  };

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = retryBaseDelay * Math.pow(2, attempt - 1);
      console.log(`  Retry ${attempt}/${maxRetries} after ${delay}ms...`);
      await sleep(delay);
    }

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': key,
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`API ${res.status}: ${text}`);
      }

      const json = await res.json();
      return parseImageResponse(json);
    } catch (err) {
      lastError = err;
      console.error(`  Attempt ${attempt + 1} failed: ${err.message}`);
    }
  }

  throw new Error(`API call failed after ${maxRetries + 1} attempts: ${lastError.message}`);
}

/**
 * Parse the API response and extract the base64 image data.
 * Doc: response.candidates[0].content.parts[0].inlineData.data
 */
function parseImageResponse(json) {
  // Debug: log response structure (truncate base64 for readability)
  const preview = JSON.stringify(json, (k, v) => {
    if (k === 'data' && typeof v === 'string' && v.length > 100) {
      return v.slice(0, 60) + `...[${v.length} chars]`;
    }
    return v;
  }, 2);
  console.log('  API response structure:', preview);

  const candidates = json.candidates;
  if (!candidates || candidates.length === 0) {
    throw new Error('No candidates in API response');
  }

  const parts = candidates[0].content?.parts;
  if (!parts || parts.length === 0) {
    throw new Error('No parts in API response candidate');
  }

  // Try both camelCase (inlineData) and snake_case (inline_data)
  for (const part of parts) {
    if (part.inlineData?.data) {
      return part.inlineData.data;
    }
    if (part.inline_data?.data) {
      return part.inline_data.data;
    }
  }

  throw new Error('No image data found in API response');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
