import fs from 'fs-extra';
import path from 'path';
import { randomUUID } from 'node:crypto';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import logger from '../utils/logger.js';
import FileManager from '../utils/fileManager.js';
import { downloadFile, validateHttpUrl } from '../utils/download.js';

ffmpeg.setFfmpegPath(ffmpegStatic);

class VideoDownloader {
  constructor(config) {
    this.config = config;
    this.fileManager = new FileManager(config.downloadPath);
  }

  async downloadVideo(videoUrl, outputPath, videoTitle = 'video', onProgress, format = null) {
    const url = validateHttpUrl(videoUrl);
    const sanitizedTitle = this.fileManager.sanitizeFilename(videoTitle);
    const videoFilePath = path.join(outputPath, `${sanitizedTitle}.mp4`);

    if (await this.fileManager.fileExists(videoFilePath)) {
      logger.info(`Video already exists: ${sanitizedTitle}`);
      return videoFilePath;
    }

    try {
      // Check if it's an m3u8 playlist
      if (format === 'hls' || url.pathname.toLowerCase().endsWith('.m3u8')) {
        return await this.downloadHLS(videoUrl, videoFilePath, onProgress);
      } else {
        return await this.downloadDirect(videoUrl, videoFilePath, onProgress);
      }
    } catch (error) {
      logger.error(`Failed to download video: ${error.message}`);
      throw error;
    }
  }

  async downloadDirect(videoUrl, outputPath, onProgress) {
    logger.startSpinner(`Downloading video to ${path.basename(outputPath)}`);

    try {
      await downloadFile(videoUrl, outputPath, this.config, (progress, downloadedLength, totalLength) => {
        logger.updateSpinner(
          `Downloading: ${progress}% (${this.fileManager.formatBytes(downloadedLength)}/${this.fileManager.formatBytes(totalLength)})`
        );
        if (onProgress) onProgress(progress, downloadedLength, totalLength);
      }, { Referer: videoUrl });

      logger.stopSpinner(true, `Downloaded: ${path.basename(outputPath)}`);
      return outputPath;
    } catch (error) {
      logger.stopSpinner(false, `Failed to download: ${error.message}`);
      throw error;
    }
  }

  async downloadHLS(m3u8Url, outputPath, onProgress) {
    validateHttpUrl(m3u8Url);
    await this.fileManager.ensureDir(path.dirname(outputPath));
    const temporaryPath = `${outputPath}.${randomUUID()}.tmp.mp4`;
    logger.startSpinner(`Downloading HLS stream to ${path.basename(outputPath)}`);

    try {
      await new Promise((resolve, reject) => {
        const command = ffmpeg(m3u8Url)
          .outputOptions([
            '-c copy',
            '-bsf:a aac_adtstoasc'
          ])
          .output(temporaryPath)
          .on('progress', (progress) => {
            if (progress.percent) {
              logger.updateSpinner(`Downloading HLS: ${Math.round(progress.percent)}%`);
              if (onProgress) {
                onProgress(Math.round(progress.percent), 0, 100);
              }
            }
          })
          .on('end', resolve)
          .on('error', reject);
        command.run();
      });
      if (!await this.fileManager.fileExists(temporaryPath)) {
        throw new Error('The downloaded HLS file is empty');
      }
      await fs.rename(temporaryPath, outputPath);
      logger.stopSpinner(true, `Downloaded HLS stream: ${path.basename(outputPath)}`);
      return outputPath;
    } catch (error) {
      logger.stopSpinner(false, `Failed to download HLS: ${error.message}`);
      throw error;
    } finally {
      await fs.remove(temporaryPath);
    }
  }

  async downloadVideoFromPage(page, selectors, outputPath, videoTitle) {
    try {
      // Try to get video URL from page
      const videoUrl = await page.evaluate((sel) => {
        const video = document.querySelector(sel.videoPlayer);
        if (!video) return null;

        // Check for source elements
        const source = video.querySelector('source');
        if (source && source.src) return source.src;

        // Check video src
        if (video.src) return video.src;

        return null;
      }, selectors);

      if (!videoUrl) {
        throw new Error('No video URL found on page');
      }

      logger.info(`Found video URL: ${videoUrl.substring(0, 100)}...`);
      return await this.downloadVideo(videoUrl, outputPath, videoTitle);
    } catch (error) {
      logger.error(`Failed to extract video from page: ${error.message}`);
      throw error;
    }
  }

  async extractVideoUrlFromNetwork(page) {
    const videoUrls = [];

    page.on('response', async (response) => {
      const url = response.url();
      const contentType = response.headers()['content-type'] || '';

      // Check for video content types
      if (contentType.includes('video') ||
          url.includes('.mp4') ||
          url.includes('.m3u8') ||
          url.includes('.webm')) {
        videoUrls.push({
          url,
          contentType,
          status: response.status()
        });
      }
    });

    return videoUrls;
  }
}

export default VideoDownloader;
