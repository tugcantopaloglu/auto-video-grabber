import * as cheerio from 'cheerio';
import path from 'path';
import axios from 'axios';
import logger from '../utils/logger.js';
import FileManager from '../utils/fileManager.js';

class HtmlDownloader {
  constructor(config) {
    this.config = config;
    this.fileManager = new FileManager(config.downloadPath);
  }

  async savePageHtml(page, outputPath, pageTitle = 'page') {
    const sanitizedTitle = this.fileManager.sanitizeFilename(pageTitle);
    const htmlFilePath = path.join(outputPath, `${sanitizedTitle}.html`);

    try {
      const html = await page.content();
      const processedHtml = await this.processHtml(html, page.url());

      await this.fileManager.saveFile(htmlFilePath, processedHtml);
      logger.success(`Saved HTML: ${sanitizedTitle}.html`);

      return htmlFilePath;
    } catch (error) {
      logger.error(`Failed to save HTML: ${error.message}`);
      throw error;
    }
  }

  async processHtml(html, baseUrl) {
    const $ = cheerio.load(html);

    // Replace video sources with local paths
    $('video source').each((i, elem) => {
      const src = $(elem).attr('src');
      if (src) {
        const filename = src.split('/').pop().split('?')[0];
        $(elem).attr('src', `../videos/${filename}`);
      }
    });

    $('video').each((i, elem) => {
      const src = $(elem).attr('src');
      if (src) {
        const filename = src.split('/').pop().split('?')[0];
        $(elem).attr('src', `../videos/${filename}`);
      }
    });

    // Replace document links with local paths
    $('a[href$=".pdf"], a[href$=".doc"], a[href$=".docx"], a[href$=".zip"]').each((i, elem) => {
      const href = $(elem).attr('href');
      if (href) {
        const filename = href.split('/').pop().split('?')[0];
        $(elem).attr('href', `../documents/${filename}`);
      }
    });

    // Download and replace images with local paths
    $('img').each((i, elem) => {
      const src = $(elem).attr('src');
      if (src && src.startsWith('http')) {
        const filename = src.split('/').pop().split('?')[0] || `image_${i}.jpg`;
        $(elem).attr('src', `../images/${filename}`);
      }
    });

    // Add base tag for relative URLs
    $('head').prepend(`<base href="${baseUrl}">`);

    // Add custom CSS for better offline viewing
    $('head').append(`
      <style>
        body {
          max-width: 1200px;
          margin: 0 auto;
          padding: 20px;
        }
        .offline-banner {
          background: #4CAF50;
          color: white;
          padding: 10px;
          text-align: center;
          margin-bottom: 20px;
        }
      </style>
    `);

    // Add offline banner
    $('body').prepend('<div class="offline-banner">Offline Mode - Downloaded Content</div>');

    return $.html();
  }

  async downloadImages(page, outputPath) {
    const imagesDir = path.join(outputPath, 'images');
    await this.fileManager.ensureDir(imagesDir);

    try {
      const images = await page.evaluate(() => {
        const imgs = [];
        document.querySelectorAll('img').forEach((img) => {
          if (img.src && img.src.startsWith('http')) {
            imgs.push(img.src);
          }
        });
        return imgs;
      });

      logger.info(`Found ${images.length} images to download`);

      for (let i = 0; i < images.length; i++) {
        try {
          const imageUrl = images[i];
          const filename = imageUrl.split('/').pop().split('?')[0] || `image_${i}.jpg`;
          const imagePath = path.join(imagesDir, filename);

          if (await this.fileManager.fileExists(imagePath)) {
            continue;
          }

          const response = await axios({
            url: imageUrl,
            method: 'GET',
            responseType: 'arraybuffer',
            timeout: this.config.timeout,
            headers: {
              'User-Agent': this.config.userAgent
            }
          });

          await this.fileManager.saveFile(imagePath, response.data, true);
          logger.info(`Downloaded image: ${filename}`);
        } catch (error) {
          logger.warning(`Failed to download image: ${error.message}`);
        }
      }

      return images.length;
    } catch (error) {
      logger.error(`Failed to download images: ${error.message}`);
      return 0;
    }
  }

  async createIndexPage(coursePath, manifest) {
    const indexPath = path.join(coursePath, 'index.html');

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${manifest.courseTitle} - Offline Course</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: #f5f5f5;
      color: #333;
    }

    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 2rem;
      text-align: center;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem;
    }

    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }

    .stat-card {
      background: white;
      padding: 1.5rem;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      text-align: center;
    }

    .stat-card h3 {
      color: #667eea;
      font-size: 2rem;
      margin-bottom: 0.5rem;
    }

    .section {
      background: white;
      padding: 2rem;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      margin-bottom: 2rem;
    }

    .section h2 {
      color: #667eea;
      margin-bottom: 1rem;
      padding-bottom: 0.5rem;
      border-bottom: 2px solid #667eea;
    }

    .lesson-list {
      list-style: none;
    }

    .lesson-item {
      padding: 1rem;
      border-bottom: 1px solid #eee;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .lesson-item:hover {
      background: #f9f9f9;
    }

    .lesson-link {
      color: #333;
      text-decoration: none;
      display: flex;
      align-items: center;
      flex: 1;
    }

    .lesson-link:hover {
      color: #667eea;
    }

    .lesson-number {
      background: #667eea;
      color: white;
      width: 30px;
      height: 30px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-right: 1rem;
      font-weight: bold;
    }

    .doc-list {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: 1rem;
    }

    .doc-card {
      background: #f9f9f9;
      padding: 1rem;
      border-radius: 8px;
      text-align: center;
      transition: transform 0.2s;
    }

    .doc-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 8px rgba(0,0,0,0.1);
    }

    .doc-link {
      color: #667eea;
      text-decoration: none;
      font-weight: bold;
    }

    .footer {
      text-align: center;
      padding: 2rem;
      color: #666;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${manifest.courseTitle}</h1>
    <p>Offline Course Material - Downloaded on ${new Date(manifest.downloadDate).toLocaleDateString()}</p>
  </div>

  <div class="container">
    <div class="stats">
      <div class="stat-card">
        <h3>${manifest.lessons.length}</h3>
        <p>Lessons</p>
      </div>
      <div class="stat-card">
        <h3>${manifest.videos.length}</h3>
        <p>Videos</p>
      </div>
      <div class="stat-card">
        <h3>${manifest.documents.length}</h3>
        <p>Documents</p>
      </div>
    </div>

    ${manifest.lessons.length > 0 ? `
    <div class="section">
      <h2>Course Lessons</h2>
      <ul class="lesson-list">
        ${manifest.lessons.map((lesson, index) => `
          <li class="lesson-item">
            <a href="${lesson.htmlPath}" class="lesson-link">
              <span class="lesson-number">${index + 1}</span>
              <span>${lesson.title}</span>
            </a>
          </li>
        `).join('')}
      </ul>
    </div>
    ` : ''}

    ${manifest.documents.length > 0 ? `
    <div class="section">
      <h2>Course Documents</h2>
      <div class="doc-list">
        ${manifest.documents.map(doc => `
          <div class="doc-card">
            <a href="${doc.path}" class="doc-link">${doc.filename}</a>
          </div>
        `).join('')}
      </div>
    </div>
    ` : ''}
  </div>

  <div class="footer">
    <p>Auto Video Grabber - Offline Course Viewer</p>
  </div>
</body>
</html>
    `;

    await this.fileManager.saveFile(indexPath, html);
    logger.success('Created index page');
    return indexPath;
  }
}

export default HtmlDownloader;
