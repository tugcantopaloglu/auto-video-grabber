import fs from 'fs-extra';
import path from 'path';
import BaseScraper from './scrapers/baseScraper.js';
import VideoDownloader from './downloaders/videoDownloader.js';
import HtmlDownloader from './downloaders/htmlDownloader.js';
import DocumentDownloader from './downloaders/documentDownloader.js';
import FileManager from './utils/fileManager.js';
import logger from './utils/logger.js';
import { validateHttpUrl } from './utils/download.js';
import { localUrlPath } from './utils/html.js';

class CourseDownloader {
  constructor(config) {
    this.config = config;
    this.fileManager = new FileManager(config.downloadPath);
    this.videoDownloader = new VideoDownloader(config);
    this.htmlDownloader = new HtmlDownloader(config);
    this.documentDownloader = new DocumentDownloader(config);
  }

  async download(courseUrl, websiteName = null) {
    validateHttpUrl(courseUrl);
    const website = websiteName || this.extractWebsiteName(courseUrl);
    const websiteConfig = this.config.websites[website] || this.config.websites.default;

    logger.info(`Starting download from ${website}`);
    logger.info(`URL: ${courseUrl}`);

    const scraper = new BaseScraper(courseUrl, this.config);

    try {
      // Initialize browser
      await scraper.initialize();

      // Navigate to course page
      const navigated = await scraper.navigateTo(courseUrl, websiteConfig.requiresAuth);
      if (!navigated) {
        throw new Error('Failed to navigate to course URL');
      }

      // Handle authentication if required
      if (websiteConfig.requiresAuth) {
        await scraper.waitForAuth();
      }

      // Extract course information
      logger.info('Extracting course information...');
      const courseTitle = await scraper.getCourseTitle(websiteConfig.selectors);
      logger.success(`Course: ${courseTitle}`);

      // Create course directory structure
      const coursePath = await this.fileManager.createCourseStructure(courseTitle, website);
      logger.success(`Created course directory: ${coursePath}`);

      // Extract lessons
      const lessons = await scraper.extractLessons(websiteConfig.selectors);
      logger.info(`Found ${lessons.length} lessons`);

      const manifest = {
        courseTitle,
        courseUrl,
        website,
        downloadDate: new Date().toISOString(),
        lessons: [],
        videos: [],
        documents: [],
        failures: []
      };

      // If lessons exist, download each lesson
      if (lessons.length > 0) {
        for (let i = 0; i < lessons.length; i++) {
          const lesson = lessons[i];
          logger.info(`\nProcessing lesson ${i + 1}/${lessons.length}: ${lesson.title}`);

          try {
            if (!await scraper.navigateTo(lesson.url)) {
              throw new Error('Failed to navigate to lesson URL');
            }
            const resources = new Map();
            let localVideo = null;

            // Download video
            let videoUrl = null;
            let videoFormat = null;

            // First try network capture method (for blob URLs)
            const networkVideos = await scraper.captureVideoUrlsFromNetwork(30000);
            if (networkVideos.length > 0) {
              videoUrl = networkVideos[0].url;
              videoFormat = networkVideos[0].type;
              logger.info(`Using network-captured URL (${networkVideos[0].type})`);
            } else {
              // Fallback to DOM extraction
              const videos = await scraper.extractVideos(websiteConfig.selectors);
              if (videos.length > 0 && videos[0].sources.length > 0) {
                videoUrl = videos[0].sources[0].src;
                logger.info('Using DOM-extracted URL');
              }
            }

            if (videoUrl && !videoUrl.startsWith('blob:')) {
              const videoPath = await this.videoDownloader.downloadVideo(
                videoUrl,
                path.join(coursePath, 'videos'),
                `${i + 1}_${lesson.title}`,
                undefined,
                videoFormat
              );

              manifest.videos.push({
                title: lesson.title,
                path: path.relative(coursePath, videoPath).split(path.sep).join('/'),
                lessonIndex: i
              });
              localVideo = `../${localUrlPath(path.relative(coursePath, videoPath))}`;
              resources.set(videoUrl, localVideo);
            } else if (videoUrl && videoUrl.startsWith('blob:')) {
              logger.warning(`Skipping blob URL - no real video URL found for: ${lesson.title}`);
            }

            // Download images
            await this.htmlDownloader.downloadImages(
              scraper.page,
              path.join(coursePath, 'html'),
              resources
            );

            // Extract and download documents
            const docs = await scraper.extractDocuments(websiteConfig.selectors);
            if (docs.length > 0) {
              const downloadedDocs = await this.documentDownloader.downloadDocuments(
                docs,
                coursePath,
                (doc, error) => manifest.failures.push({ url: doc.href, message: error.message })
              );
              manifest.documents.push(...downloadedDocs);
              downloadedDocs.forEach(doc => resources.set(doc.originalUrl, `../${localUrlPath(doc.path)}`));
            }

            const htmlPath = await this.htmlDownloader.savePageHtml(
              scraper.page,
              path.join(coursePath, 'html'),
              `${i + 1}_${lesson.title}`,
              resources,
              localVideo
            );

            manifest.lessons.push({
              index: i,
              title: lesson.title,
              url: lesson.url,
              htmlPath: path.relative(coursePath, htmlPath).split(path.sep).join('/')
            });

            logger.progress(i + 1, lessons.length, lesson.title);
          } catch (error) {
            logger.error(`Failed to download lesson ${lesson.title}: ${error.message}`);
            manifest.failures.push({ title: lesson.title, url: lesson.url, message: error.message });
          }
        }
      } else {
        // Single page/video course
        logger.info('Processing single page course...');

        // Download video
        let videoUrl = null;
        let videoFormat = null;
        const resources = new Map();
        let localVideo = null;

        // First try network capture method (for blob URLs)
        const networkVideos = await scraper.captureVideoUrlsFromNetwork(30000);
        if (networkVideos.length > 0) {
          videoUrl = networkVideos[0].url;
          videoFormat = networkVideos[0].type;
          logger.info(`Using network-captured URL (${networkVideos[0].type})`);
        } else {
          // Fallback to DOM extraction
          const videos = await scraper.extractVideos(websiteConfig.selectors);
          if (videos.length > 0 && videos[0].sources.length > 0) {
            videoUrl = videos[0].sources[0].src;
            logger.info('Using DOM-extracted URL');
          }
        }

        if (videoUrl && !videoUrl.startsWith('blob:')) {
          const videoPath = await this.videoDownloader.downloadVideo(
            videoUrl,
            path.join(coursePath, 'videos'),
            courseTitle,
            undefined,
            videoFormat
          );

          manifest.videos.push({
            title: courseTitle,
            path: path.relative(coursePath, videoPath).split(path.sep).join('/'),
            lessonIndex: 0
          });
          localVideo = `../${localUrlPath(path.relative(coursePath, videoPath))}`;
          resources.set(videoUrl, localVideo);
        } else if (videoUrl && videoUrl.startsWith('blob:')) {
          logger.warning('Skipping blob URL - no real video URL found');
        }

        // Download images
        await this.htmlDownloader.downloadImages(
          scraper.page,
          path.join(coursePath, 'html'),
          resources
        );

        // Extract and download documents
        const docs = await scraper.extractDocuments(websiteConfig.selectors);
        if (docs.length > 0) {
          const downloadedDocs = await this.documentDownloader.downloadDocuments(
            docs,
            coursePath,
            (doc, error) => manifest.failures.push({ url: doc.href, message: error.message })
          );
          manifest.documents.push(...downloadedDocs);
          downloadedDocs.forEach(doc => resources.set(doc.originalUrl, `../${localUrlPath(doc.path)}`));
        }

        const htmlPath = await this.htmlDownloader.savePageHtml(
          scraper.page,
          path.join(coursePath, 'html'),
          courseTitle,
          resources,
          localVideo
        );

        manifest.lessons.push({
          index: 0,
          title: courseTitle,
          url: courseUrl,
          htmlPath: path.relative(coursePath, htmlPath).split(path.sep).join('/')
        });
      }

      // Save manifest
      await this.fileManager.createManifest(coursePath, manifest);

      // Create index page
      await this.htmlDownloader.createIndexPage(coursePath, manifest);

      if (manifest.failures.length > 0) {
        logger.warning(`Download completed with ${manifest.failures.length} failure(s)`);
      } else {
        logger.success('\nDownload completed successfully!');
      }
      logger.info(`Course saved to: ${coursePath}`);
      logger.info(`Videos: ${manifest.videos.length}`);
      logger.info(`Documents: ${manifest.documents.length}`);
      logger.info(`Lessons: ${manifest.lessons.length}`);

      return {
        success: manifest.failures.length === 0,
        coursePath,
        manifest
      };
    } catch (error) {
      logger.error(`Download failed: ${error.message}`);
      throw error;
    } finally {
      await scraper.close();
    }
  }

  extractWebsiteName(url) {
    try {
      const hostname = new URL(url).hostname;
      return hostname.replace('www.', '');
    } catch (error) {
      return 'unknown';
    }
  }
}

export default CourseDownloader;
