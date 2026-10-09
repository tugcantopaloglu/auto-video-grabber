import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';
import { createInterface } from 'node:readline';
import logger from '../utils/logger.js';
import { downloadFile, validateHttpUrl } from '../utils/download.js';

class BaseScraper {
  constructor(url, config) {
    validateHttpUrl(url);
    this.url = url;
    this.config = config;
    this.browser = null;
    this.page = null;
  }

  async initialize() {
    logger.info('Launching browser...');
    this.browser = await puppeteer.launch({
      headless: false
    });
    this.page = await this.browser.newPage();

    await this.page.setUserAgent(this.config.userAgent);
    await this.page.setViewport({ width: 1920, height: 1080 });
  }

  async navigateTo(url, waitForAuth = false) {
    validateHttpUrl(url);
    logger.info(`Navigating to: ${url}`);
    try {
      // Use a more lenient wait strategy for auth-protected pages
      const waitStrategy = waitForAuth ? 'domcontentloaded' : 'networkidle2';
      const navigationTimeout = waitForAuth ? 60000 : this.config.timeout;

      await this.page.goto(url, {
        waitUntil: waitStrategy,
        timeout: navigationTimeout
      });

      // If we're expecting auth, wait a bit for redirects to settle
      if (waitForAuth) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      return true;
    } catch (error) {
      logger.error(`Failed to navigate: ${error.message}`);
      return false;
    }
  }

  async waitForAuth(input = process.stdin) {
    logger.warning('Please log in to the website in the browser window...');
    logger.info('Press Enter in the terminal once you are logged in and on the course page...');

    const reader = createInterface({ input });
    try {
      await new Promise((resolve, reject) => {
        reader.once('line', resolve);
        reader.once('close', () => reject(new Error('Authentication input closed before confirmation')));
      });
    } finally {
      reader.close();
    }
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

  async captureVideoUrlsFromNetwork(timeout = 30000) {
    const videoUrls = [];
    const startTime = Date.now();

    logger.info('Monitoring network for video URLs...');

    // Set up network request listener
    const requestListener = async (request) => {
      const url = request.url();
      const pathname = new URL(url).pathname.toLowerCase();

      // Check for video-related URLs
      if (['.m3u8', '.mp4', '.webm'].some(extension => pathname.endsWith(extension))) {

        logger.info(`Found video URL: ${url.substring(0, 100)}...`);
        if (!videoUrls.some(video => video.url === url)) {
          videoUrls.push({ url, type: pathname.endsWith('.m3u8') ? 'hls' : 'direct' });
        }
      }
    };

    const responseListener = async (response) => {
      const url = response.url();
      const contentType = (response.headers()['content-type'] || '').toLowerCase();

      // Check for video content in responses
      if (contentType.includes('application/vnd.apple.mpegurl') ||
          contentType.includes('application/x-mpegurl') ||
          (contentType.includes('video/') && !contentType.includes('video/mp2t'))) {

        logger.info(`Found video response: ${url.substring(0, 100)}...`);
        if (!videoUrls.find(v => v.url === url)) {
          videoUrls.push({
            url,
            type: contentType.includes('mpegurl') ? 'hls' : 'direct',
            contentType
          });
        }
      }
    };

    this.page.on('request', requestListener);
    this.page.on('response', responseListener);

    // Wait for video to start loading or timeout
    logger.info('Waiting for video to load... (this may take up to 30 seconds)');

    // Try to play the video to trigger network requests
    try {
      await this.page.evaluate(() => {
        const video = document.querySelector('video');
        if (video) {
          video.play().catch(() => {});
        }
      });
    } catch (error) {
      logger.warning('Could not auto-play video');
    }

    // Wait for video URLs to be captured
    const checkInterval = 1000;
    while (Date.now() - startTime < timeout && videoUrls.length === 0) {
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    // Remove listeners
    this.page.off('request', requestListener);
    this.page.off('response', responseListener);

    if (videoUrls.length > 0) {
      logger.success(`Captured ${videoUrls.length} video URL(s)`);
    } else {
      logger.warning('No video URLs captured from network');
    }

    return videoUrls;
  }

  async extractDocuments(selectors) {
    const documents = [];

    try {
      const docElements = await this.page.evaluate((sel) => {
        const docs = [];
        const links = document.querySelectorAll(sel.documents);

        links.forEach(link => {
          let filename = new URL(link.href).pathname.split('/').pop();
          try {
            filename = decodeURIComponent(filename);
          } catch {}
          docs.push({
            href: link.href,
            text: link.textContent.trim(),
            filename
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

  async debugPageStructure() {
    logger.info('Analyzing page structure...');

    const pageInfo = await this.page.evaluate(() => {
      const info = {
        buttons: [],
        links: [],
        videos: [],
        expandable: []
      };

      // Find all buttons
      document.querySelectorAll('button').forEach(btn => {
        const text = btn.textContent.trim().substring(0, 50);
        const classes = btn.className;
        const ariaExpanded = btn.getAttribute('aria-expanded');
        if (text || ariaExpanded !== null) {
          info.buttons.push({ text, classes, ariaExpanded });
        }
      });

      // Find all links
      document.querySelectorAll('a[href]').forEach(link => {
        const href = link.href;
        const text = link.textContent.trim().substring(0, 50);
        const classes = link.className;
        if (href && text && (href.includes('/video') || href.includes('/lesson') || href.includes('/content'))) {
          info.links.push({ href, text, classes });
        }
      });

      // Find videos
      document.querySelectorAll('video').forEach(video => {
        info.videos.push({ src: video.src, poster: video.poster });
      });

      // Find expandable elements
      document.querySelectorAll('[aria-expanded]').forEach(el => {
        info.expandable.push({
          tag: el.tagName,
          expanded: el.getAttribute('aria-expanded'),
          classes: el.className,
          text: el.textContent.trim().substring(0, 30)
        });
      });

      return info;
    });

    logger.info(`Found ${pageInfo.buttons.length} buttons`);
    logger.info(`Found ${pageInfo.links.length} relevant links`);
    logger.info(`Found ${pageInfo.videos.length} videos`);
    logger.info(`Found ${pageInfo.expandable.length} expandable elements`);

    if (pageInfo.expandable.length > 0) {
      const collapsed = pageInfo.expandable.filter(e => e.expanded === 'false');
      logger.info(`Found ${collapsed.length} collapsed elements`);
    }

    return pageInfo;
  }

  async expandAllSections() {
    logger.info('Expanding all collapsible sections...');

    try {
      // First, get page structure for debugging
      const pageInfo = await this.debugPageStructure();

      const expandedCount = await this.page.evaluate(() => {
        let count = 0;

        // Common selectors for collapsible sections
        const expandSelectors = [
          'button[aria-expanded="false"]',
          '[aria-expanded="false"]',
          '.accordion-button.collapsed',
          '[class*="collapse"]:not([class*="show"])',
          '[class*="Accordion"]',
          '[class*="Collaps"]',
          'details:not([open])',
          '[role="button"][aria-expanded="false"]',
          'button[class*="expand"]',
          'button[class*="Expand"]'
        ];

        // Try to find and click all expand buttons
        expandSelectors.forEach(selector => {
          try {
            const elements = document.querySelectorAll(selector);
            elements.forEach(el => {
              try {
                // For details elements, set open attribute
                if (el.tagName === 'DETAILS') {
                  el.open = true;
                  count++;
                } else {
                  // For buttons/clickable elements
                  el.click();
                  count++;
                }
              } catch (e) {
                // Ignore individual click errors
              }
            });
          } catch (e) {
            // Ignore selector errors
          }
        });

        return count;
      });

      if (expandedCount > 0) {
        logger.success(`Expanded ${expandedCount} section(s)`);
        // Wait for content to load after expansion
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else {
        logger.info('No collapsible sections found or all already expanded');
      }

      return expandedCount;
    } catch (error) {
      logger.warning(`Failed to expand sections: ${error.message}`);
      return 0;
    }
  }

  async extractLessons(selectors) {
    const lessons = [];

    try {
      // First, expand all collapsible sections
      await this.expandAllSections();

      // Log what selector we're using
      logger.info(`Looking for lessons with selector: ${selectors.lessonList}`);

      const lessonElements = await this.page.evaluate((sel) => {
        const items = [];
        const links = document.querySelectorAll(sel.lessonList);
        const seenUrls = new Set();

        console.log(`Found ${links.length} links matching selector`);

        links.forEach((link, index) => {
          const url = link.href;
          const title = link.textContent.trim();

          console.log(`Link ${index}: ${title.substring(0, 50)} -> ${url}`);

          // Avoid duplicates and empty titles
          if (url && title && !seenUrls.has(url)) {
            seenUrls.add(url);
            items.push({
              index: items.length,
              url,
              title
            });
          }
        });

        return items;
      }, selectors);

      if (lessonElements.length > 0) {
        logger.success(`Found ${lessonElements.length} unique lessons`);
        lessonElements.forEach((lesson, i) => {
          logger.info(`  ${i + 1}. ${lesson.title}`);
        });
      } else {
        logger.warning('No lessons found with configured selectors');

        // Try to find ANY links that might be lessons
        const allPossibleLinks = await this.page.evaluate(() => {
          const possible = [];
          document.querySelectorAll('a[href]').forEach(link => {
            const href = link.href;
            const text = link.textContent.trim();
            if (text && text.length > 5 && text.length < 200) {
              possible.push({ href, text: text.substring(0, 60) });
            }
          });
          return possible.slice(0, 20); // First 20 links
        });

        logger.info('\nFirst 20 links found on page:');
        allPossibleLinks.forEach((link, i) => {
          logger.info(`  ${i + 1}. ${link.text} -> ${link.href.substring(0, 80)}`);
        });
      }

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
      return await downloadFile(url, filePath, this.config, onProgress);
    } catch (error) {
      throw new Error(`Download failed: ${error.message}`);
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
      logger.info('Browser closed');
    }
  }
}

export default BaseScraper;
