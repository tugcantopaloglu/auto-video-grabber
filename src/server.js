import express from 'express';
import path from 'path';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import { Command } from 'commander';
import logger from './utils/logger.js';
import { escapeHtml } from './utils/html.js';

class OfflineServer {
  constructor(port = 3000, downloadsPath = './downloads') {
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error('Port must be an integer between 0 and 65535');
    }
    this.port = port;
    this.downloadsPath = path.resolve(downloadsPath);
    this.app = express();
    this.server = null;
    this.configureRoutes();
  }

  configureRoutes() {
    this.app.use(async (req, res, next) => {
      try {
        const requestedPath = path.resolve(this.downloadsPath, `.${decodeURIComponent(req.path)}`);
        if (!this.isWithinDownloads(requestedPath)) return res.sendStatus(404);
        if (await fs.pathExists(requestedPath)) {
          const realDownloadsPath = await fs.realpath(this.downloadsPath);
          const resolvedPath = await fs.realpath(requestedPath);
          if (!this.isWithinDownloads(resolvedPath, realDownloadsPath)) return res.sendStatus(404);
          if ((await fs.stat(resolvedPath)).isDirectory()) {
            const indexPath = path.join(resolvedPath, 'index.html');
            if (await fs.pathExists(indexPath) && !this.isWithinDownloads(await fs.realpath(indexPath), realDownloadsPath)) {
              return res.sendStatus(404);
            }
          }
        }
        next();
      } catch (error) {
        res.status(400).json({ error: 'Invalid resource path' });
      }
    });
    // Serve static files from downloads directory
    this.app.use(express.static(this.downloadsPath));

    // List all courses
    this.app.get('/api/courses', async (req, res) => {
      try {
        const courses = await this.getAvailableCourses();
        res.json(courses);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Get course details
    this.app.get('/api/course/:website/:courseName', async (req, res) => {
      try {
        const { website, courseName } = req.params;
        const manifest = await this.readCourseManifest(website, courseName);
        if (manifest) {
          res.json(manifest);
        } else {
          res.status(404).json({ error: 'Course not found' });
        }
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Main page
    this.app.get('/', async (req, res) => {
      try {
        const courses = await this.getAvailableCourses();
        const html = this.generateMainPage(courses);
        res.send(html);
      } catch (error) {
        res.status(500).json({ error: 'Could not read the course library' });
      }
    });
  }

  isWithinDownloads(target, root = this.downloadsPath) {
    const relative = path.relative(root, target);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
  }

  async readCourseManifest(website, courseName) {
    if ([website, courseName].some(segment => !segment || segment === '.' || segment === '..' || /[\\/:]/.test(segment))) {
      return null;
    }
    const manifestPath = path.join(this.downloadsPath, website, courseName, 'manifest.json');
    if (!await fs.pathExists(manifestPath)) return null;
    if (!this.isWithinDownloads(await fs.realpath(manifestPath), await fs.realpath(this.downloadsPath))) return null;
    const manifest = await fs.readJson(manifestPath);
    if (![manifest.lessons, manifest.videos, manifest.documents].every(Array.isArray)) {
      throw new Error('Invalid course manifest');
    }
    return manifest;
  }

  async start() {
    if (this.server) throw new Error('Server is already running');
    await new Promise((resolve, reject) => {
      const server = this.app.listen(this.port, '127.0.0.1');
      this.server = server;
      server.once('error', error => {
        this.server = null;
        reject(error);
      });
      server.once('listening', resolve);
    });
    this.port = this.server.address().port;
    logger.success(`Offline server running at http://localhost:${this.port}`);
    logger.info('Access your downloaded courses from the browser');
    return this.server;
  }

  async stop() {
    if (!this.server) return;
    const server = this.server;
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    this.server = null;
  }

  async getAvailableCourses() {
    const courses = [];

    try {
      const websites = await fs.readdir(this.downloadsPath);

      for (const website of websites) {
        const websitePath = path.join(this.downloadsPath, website);
        const stats = await fs.stat(websitePath);

        if (stats.isDirectory()) {
          const courseFolders = await fs.readdir(websitePath);

          for (const courseFolder of courseFolders) {
            try {
              const manifest = await this.readCourseManifest(website, courseFolder);
              if (!manifest) continue;
              courses.push({
                website,
                folder: courseFolder,
                title: manifest.courseTitle,
                url: manifest.courseUrl,
                downloadDate: manifest.downloadDate,
                stats: {
                  lessons: manifest.lessons.length,
                  videos: manifest.videos.length,
                  documents: manifest.documents.length
                },
                path: `/${encodeURIComponent(website)}/${encodeURIComponent(courseFolder)}/index.html`
              });
            } catch (error) {
              logger.warning(`Skipping invalid course manifest: ${website}/${courseFolder}`);
            }
          }
        }
      }
    } catch (error) {
      logger.error(`Error reading courses: ${error.message}`);
    }

    return courses;
  }

  generateMainPage(courses) {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Offline Course Library</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 2rem;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
    }

    .header {
      text-align: center;
      color: white;
      margin-bottom: 3rem;
    }

    .header h1 {
      font-size: 3rem;
      margin-bottom: 0.5rem;
    }

    .header p {
      font-size: 1.2rem;
      opacity: 0.9;
    }

    .courses-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
      gap: 2rem;
    }

    .course-card {
      background: white;
      border-radius: 12px;
      padding: 2rem;
      box-shadow: 0 10px 30px rgba(0,0,0,0.2);
      transition: transform 0.3s, box-shadow 0.3s;
      cursor: pointer;
    }

    .course-card:hover {
      transform: translateY(-5px);
      box-shadow: 0 15px 40px rgba(0,0,0,0.3);
    }

    .course-header {
      margin-bottom: 1rem;
    }

    .course-website {
      display: inline-block;
      background: #667eea;
      color: white;
      padding: 0.25rem 0.75rem;
      border-radius: 20px;
      font-size: 0.8rem;
      margin-bottom: 0.5rem;
    }

    .course-title {
      font-size: 1.5rem;
      color: #333;
      margin-bottom: 0.5rem;
    }

    .course-date {
      color: #666;
      font-size: 0.9rem;
    }

    .course-stats {
      display: flex;
      justify-content: space-around;
      margin: 1.5rem 0;
      padding: 1rem;
      background: #f5f5f5;
      border-radius: 8px;
    }

    .stat {
      text-align: center;
    }

    .stat-number {
      font-size: 1.5rem;
      font-weight: bold;
      color: #667eea;
    }

    .stat-label {
      font-size: 0.8rem;
      color: #666;
      margin-top: 0.25rem;
    }

    .course-link {
      display: block;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      text-align: center;
      padding: 0.75rem;
      border-radius: 8px;
      text-decoration: none;
      font-weight: bold;
      transition: opacity 0.3s;
    }

    .course-link:hover {
      opacity: 0.9;
    }

    .no-courses {
      text-align: center;
      color: white;
      padding: 3rem;
      font-size: 1.2rem;
    }

    .footer {
      text-align: center;
      color: white;
      margin-top: 3rem;
      opacity: 0.8;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Offline Course Library</h1>
      <p>Your Downloaded Educational Content</p>
    </div>

    ${courses.length > 0 ? `
      <div class="courses-grid">
        ${courses.map(course => `
          <div class="course-card">
            <div class="course-header">
              <span class="course-website">${escapeHtml(course.website)}</span>
              <h2 class="course-title">${escapeHtml(course.title)}</h2>
              <p class="course-date">Downloaded: ${new Date(course.downloadDate).toLocaleDateString()}</p>
            </div>

            <div class="course-stats">
              <div class="stat">
                <div class="stat-number">${course.stats.lessons}</div>
                <div class="stat-label">Lessons</div>
              </div>
              <div class="stat">
                <div class="stat-number">${course.stats.videos}</div>
                <div class="stat-label">Videos</div>
              </div>
              <div class="stat">
                <div class="stat-number">${course.stats.documents}</div>
                <div class="stat-label">Documents</div>
              </div>
            </div>

            <a href="${escapeHtml(course.path)}" class="course-link">Open Course</a>
          </div>
        `).join('')}
      </div>
    ` : `
      <div class="no-courses">
        <p>No courses downloaded yet.</p>
        <p>Use the auto-video-grabber CLI to download courses.</p>
      </div>
    `}

    <div class="footer">
      <p>Auto Video Grabber - Offline Course Viewer</p>
    </div>
  </div>
</body>
</html>
    `;
  }
}

// Start server if run directly
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const program = new Command();
  program.option('-p, --port <number>', 'Port number', '3000');
  program.option('-d, --dir <path>', 'Downloads directory', './downloads');
  program.parse();
  const options = program.opts();
  try {
    const server = new OfflineServer(Number(options.port), options.dir);
    await server.start();
  } catch (error) {
    logger.error(`Failed to start server: ${error.message}`);
    process.exitCode = 1;
  }
}

export default OfflineServer;
