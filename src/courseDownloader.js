import fs from 'fs-extra';
import path from 'path';
import BaseScraper from './scrapers/baseScraper.js';
import VideoDownloader from './downloaders/videoDownloader.js';
import HtmlDownloader from './downloaders/htmlDownloader.js';
import DocumentDownloader from './downloaders/documentDownloader.js';
import FileManager from './utils/fileManager.js';
import logger from './utils/logger.js';

class CourseDownloader {
  constructor(config) {
    this.config = config;
    this.fileManager = new FileManager(config.downloadPath);
    this.videoDownloader = new VideoDownloader(config);
    this.htmlDownloader = new HtmlDownloader(config);
    this.documentDownloader = new DocumentDownloader(config);
  }

  async download(courseUrl, websiteName = null) {
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
        documents: []
      };

      // If lessons exist, download each lesson
      if (lessons.length > 0) {
        for (let i = 0; i < lessons.length; i++) {
          const lesson = lessons[i];
          logger.info(`\nProcessing lesson ${i + 1}/${lessons.length}: ${lesson.title}`);

          try {
            await scraper.navigateTo(lesson.url);

            // Download video
            let videoUrl = null;

            // First try network capture method (for blob URLs)
            const networkVideos = await scraper.captureVideoUrlsFromNetwork(30000);
            if (networkVideos.length > 0) {
              videoUrl = networkVideos[0].url;
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
                `${i + 1}_${lesson.title}`
              );

              manifest.videos.push({
                title: lesson.title,
                path: path.relative(coursePath, videoPath),
                lessonIndex: i
              });
            } else if (videoUrl && videoUrl.startsWith('blob:')) {
              logger.warning(`Skipping blob URL - no real video URL found for: ${lesson.title}`);
            }

            // Download HTML
            const htmlPath = await this.htmlDownloader.savePageHtml(
              scraper.page,
              path.join(coursePath, 'html'),
              `${i + 1}_${lesson.title}`
            );

            // Download images
            await this.htmlDownloader.downloadImages(
              scraper.page,
              path.join(coursePath, 'html')
            );

            // Extract and download documents
            const docs = await scraper.extractDocuments(websiteConfig.selectors);
            if (docs.length > 0) {
              const downloadedDocs = await this.documentDownloader.downloadDocuments(
                docs,
                coursePath
              );
              manifest.documents.push(...downloadedDocs);
            }

            manifest.lessons.push({
              index: i,
              title: lesson.title,
              url: lesson.url,
              htmlPath: path.relative(coursePath, htmlPath)
            });

            logger.progress(i + 1, lessons.length, lesson.title);
          } catch (error) {
            logger.error(`Failed to download lesson ${lesson.title}: ${error.message}`);
          }
        }
      } else {
        // Single page/video course
        logger.info('Processing single page course...');

        // Download video
        let videoUrl = null;

        // First try network capture method (for blob URLs)
        const networkVideos = await scraper.captureVideoUrlsFromNetwork(30000);
        if (networkVideos.length > 0) {
          videoUrl = networkVideos[0].url;
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
            courseTitle
          );

          manifest.videos.push({
            title: courseTitle,
            path: path.relative(coursePath, videoPath),
            lessonIndex: 0
          });
        } else if (videoUrl && videoUrl.startsWith('blob:')) {
          logger.warning('Skipping blob URL - no real video URL found');
        }

        // Download HTML
        const htmlPath = await this.htmlDownloader.savePageHtml(
          scraper.page,
          path.join(coursePath, 'html'),
          courseTitle
        );

        // Download images
        await this.htmlDownloader.downloadImages(
          scraper.page,
          path.join(coursePath, 'html')
        );

        // Extract and download documents
        const docs = await scraper.extractDocuments(websiteConfig.selectors);
        if (docs.length > 0) {
          const downloadedDocs = await this.documentDownloader.downloadDocuments(
            docs,
            coursePath
          );
          manifest.documents.push(...downloadedDocs);
        }

        manifest.lessons.push({
          index: 0,
          title: courseTitle,
          url: courseUrl,
          htmlPath: path.relative(coursePath, htmlPath)
        });
      }

      // Save manifest
      await this.fileManager.createManifest(coursePath, manifest);

      // Create index page
      await this.htmlDownloader.createIndexPage(coursePath, manifest);

      logger.success('\n✓ Download completed successfully!');
      logger.info(`Course saved to: ${coursePath}`);
      logger.info(`Videos: ${manifest.videos.length}`);
      logger.info(`Documents: ${manifest.documents.length}`);
      logger.info(`Lessons: ${manifest.lessons.length}`);

      return {
        success: true,
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
