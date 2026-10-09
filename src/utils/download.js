import axios from 'axios';
import fs from 'fs-extra';
import path from 'path';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';

export function validateHttpUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only HTTP and HTTPS URLs are supported');
  }
  return url;
}

export function urlFilename(value) {
  const encoded = validateHttpUrl(value).pathname.split('/').pop();
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

export async function downloadFile(url, outputPath, config, onProgress, headers = {}) {
  validateHttpUrl(url);
  await fs.ensureDir(path.dirname(outputPath));
  const temporaryPath = `${outputPath}.${randomUUID()}.tmp`;

  try {
    const response = await axios({
      url,
      method: 'GET',
      responseType: 'stream',
      timeout: config.timeout,
      headers: { 'User-Agent': config.userAgent, ...headers }
    });
    const totalLength = Number(response.headers['content-length']);
    let downloadedLength = 0;
    response.data.on('data', chunk => {
      downloadedLength += chunk.length;
      if (onProgress && totalLength > 0) {
        onProgress(Math.round(downloadedLength / totalLength * 100), downloadedLength, totalLength);
      }
    });
    await pipeline(response.data, fs.createWriteStream(temporaryPath, { flags: 'wx' }));
    if (downloadedLength === 0) {
      throw new Error('The downloaded file is empty');
    }
    await fs.rename(temporaryPath, outputPath);
    return outputPath;
  } finally {
    await fs.remove(temporaryPath);
  }
}
