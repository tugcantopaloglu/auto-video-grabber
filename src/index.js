#!/usr/bin/env node

import { Command } from 'commander';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import CourseDownloader from './courseDownloader.js';
import OfflineServer from './server.js';
import logger from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const program = new Command();

// Load configuration
async function loadConfig() {
  const configPath = path.join(process.cwd(), 'config.json');

  if (await fs.pathExists(configPath)) {
    return await fs.readJson(configPath);
  }

  // Default configuration
  return {
    downloadPath: './downloads',
    maxConcurrentDownloads: 3,
    retryAttempts: 3,
    timeout: 30000,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    websites: {
      default: {
        selectors: {
          videoPlayer: 'video',
          videoSource: 'video source, source',
          documents: 'a[href$=".pdf"], a[href$=".doc"], a[href$=".docx"], a[href$=".zip"]'
        },
        waitForSelector: 'video',
        requiresAuth: false
      }
    }
  };
}

program
  .name('auto-video-grabber')
  .description('Download videos, documents, and HTML content from educational websites')
  .version('1.0.0');

program
  .command('download <url>')
  .description('Download a course from the specified URL')
  .option('-w, --website <name>', 'Website name (e.g., ine.com)')
  .option('-o, --output <path>', 'Output directory for downloads')
  .action(async (url, options) => {
    try {
      logger.info('Auto Video Grabber - Starting download...\n');

      const config = await loadConfig();

      if (options.output) {
        config.downloadPath = options.output;
      }

      const downloader = new CourseDownloader(config);
      const result = await downloader.download(url, options.website);

      if (result.success) {
        logger.success('\n✓ All done!');
        logger.info('\nTo view your course offline:');
        logger.info('  1. Run: npm run serve');
        logger.info('  2. Open: http://localhost:3000');
        logger.info(`  3. Or directly open: ${path.join(result.coursePath, 'index.html')}`);
      }
    } catch (error) {
      logger.error(`\n✗ Error: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('serve')
  .description('Start the offline course viewer server')
  .option('-p, --port <number>', 'Port number', '3000')
  .option('-d, --dir <path>', 'Downloads directory', './downloads')
  .action(async (options) => {
    try {
      const port = parseInt(options.port, 10);
      const server = new OfflineServer(port, options.dir);

      logger.info('Starting offline course viewer...\n');
      await server.start();
    } catch (error) {
      logger.error(`Failed to start server: ${error.message}`);
      process.exit(1);
    }
  });

program
  .command('list')
  .description('List all downloaded courses')
  .option('-d, --dir <path>', 'Downloads directory', './downloads')
  .action(async (options) => {
    try {
      const downloadsPath = options.dir;

      if (!await fs.pathExists(downloadsPath)) {
        logger.warning('No downloads directory found');
        return;
      }

      logger.info('Downloaded Courses:\n');

      const websites = await fs.readdir(downloadsPath);
      let totalCourses = 0;

      for (const website of websites) {
        const websitePath = path.join(downloadsPath, website);
        const stats = await fs.stat(websitePath);

        if (stats.isDirectory()) {
          const courses = await fs.readdir(websitePath);

          logger.info(`📚 ${website}`);

          for (const course of courses) {
            const coursePath = path.join(websitePath, course);
            const manifestPath = path.join(coursePath, 'manifest.json');

            if (await fs.pathExists(manifestPath)) {
              const manifest = await fs.readJson(manifestPath);
              logger.info(`  ├─ ${manifest.courseTitle}`);
              logger.info(`  │  Videos: ${manifest.videos.length}, Documents: ${manifest.documents.length}, Lessons: ${manifest.lessons.length}`);
              totalCourses++;
            }
          }

          logger.info('');
        }
      }

      if (totalCourses === 0) {
        logger.warning('No courses downloaded yet');
        logger.info('\nTo download a course, run:');
        logger.info('  npm start download <url>');
      } else {
        logger.success(`Total courses: ${totalCourses}`);
      }
    } catch (error) {
      logger.error(`Failed to list courses: ${error.message}`);
    }
  });

program
  .command('config')
  .description('Show current configuration')
  .action(async () => {
    try {
      const config = await loadConfig();
      logger.info('Current Configuration:\n');
      console.log(JSON.stringify(config, null, 2));
    } catch (error) {
      logger.error(`Failed to load config: ${error.message}`);
    }
  });

program.parse();
