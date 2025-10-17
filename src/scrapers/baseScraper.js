import puppeteer from 'puppeteer';
import axios from 'axios';
import * as cheerio from 'cheerio';
import logger from '../utils/logger.js';

class BaseScraper {
  constructor(url, config) {
    this.url = url;
    this.config = config;
    this.browser = null;
    this.page = null;
  }

  async initialize() {
    logger.info('Launching browser...');
    this.browser = await puppeteer.launch({
      headless: false, // Set to false to see the browser and handle authentication
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process'
      ]
    });
    this.page = await this.browser.newPage();

    await this.page.setUserAgent(this.config.userAgent);
    await this.page.setViewport({ width: 1920, height: 1080 });
  }

  async navigateTo(url) {
    logger.info(`Navigating to: ${url}`);
    try {
      await this.page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: this.config.timeout
      });
      return true;
    } catch (error) {
      logger.error(`Failed to navigate: ${error.message}`);
      return false;
    }
  }

  async waitForAuth() {
    logger.warning('Please log in to the website in the browser window...');
    logger.info('Press Enter in the terminal once you are logged in and on the course page...');

    // Wait for user input
    await new Promise(resolve => {
      process.stdin.once('data', () => resolve());
    });
  }

  async extractPageContent() {
    const html = await this.page.content();
    const $ = cheerio.load(html);
    return { html, $ };
  }

  async extractVideos(selectors) {
    const videos = [];

    try {
      // Wait for video element
      await this.page.waitForSelector(selectors.videoPlayer, { timeout: 10000 });

      // Extract video sources
      const videoElements = await this.page.evaluate((sel) => {
        const videos = [];
        const videoTags = document.querySelectorAll(sel.videoPlayer);

        videoTags.forEach((video, index) => {
          const sources = [];

          // Get source tags
          const sourceTags = video.querySelectorAll('source');
          sourceTags.forEach(source => {
            sources.push({
              src: source.src,
              type: source.type || 'video/mp4'
            });
          });

          // If no source tags, check video src
          if (sources.length === 0 && video.src) {
            sources.push({
              src: video.src,
              type: video.type || 'video/mp4'
            });
          }

          videos.push({
            index,
            sources,
            poster: video.poster || ''
          });
        });

        return videos;
      }, selectors);

      videos.push(...videoElements);
    } catch (error) {
      logger.warning(`No videos found with standard selectors: ${error.message}`);
    }

    return videos;
  }

  async extractDocuments(selectors) {
    const documents = [];

    try {
      const docElements = await this.page.evaluate((sel) => {
        const docs = [];
        const links = document.querySelectorAll(sel.documents);

        links.forEach(link => {
          docs.push({
            href: link.href,
            text: link.textContent.trim(),
            filename: link.href.split('/').pop()
          });
        });

        return docs;
      }, selectors);

      documents.push(...docElements);
    } catch (error) {
      logger.warning(`No documents found: ${error.message}`);
    }

    return documents;
  }

  async extractLessons(selectors) {
    const lessons = [];

    try {
      const lessonElements = await this.page.evaluate((sel) => {
        const items = [];
        const links = document.querySelectorAll(sel.lessonList);

        links.forEach((link, index) => {
          items.push({
            index,
            url: link.href,
            title: link.textContent.trim()
          });
        });

        return items;
      }, selectors);

      lessons.push(...lessonElements);
    } catch (error) {
      logger.warning(`No lesson list found: ${error.message}`);
    }

    return lessons;
  }

  async getCourseTitle(selectors) {
    try {
      const title = await this.page.evaluate((sel) => {
        const titleElement = document.querySelector(sel.courseTitle);
        return titleElement ? titleElement.textContent.trim() : 'Unknown Course';
      }, selectors);

      return title;
    } catch (error) {
      return 'Unknown Course';
    }
  }

  async downloadFile(url, filePath, onProgress) {
    try {
      const response = await axios({
        url,
        method: 'GET',
        responseType: 'stream',
        timeout: this.config.timeout,
        headers: {
          'User-Agent': this.config.userAgent
        }
      });

      const totalLength = response.headers['content-length'];
      let downloadedLength = 0;

      const writer = require('fs').createWriteStream(filePath);

      response.data.on('data', (chunk) => {
        downloadedLength += chunk.length;
        if (onProgress && totalLength) {
          const progress = Math.round((downloadedLength / totalLength) * 100);
          onProgress(progress, downloadedLength, totalLength);
        }
      });

      return new Promise((resolve, reject) => {
        response.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', reject);
      });
    } catch (error) {
      throw new Error(`Download failed: ${error.message}`);
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      logger.info('Browser closed');
    }
  }
}

export default BaseScraper;
