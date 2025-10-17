import fs from 'fs-extra';
import path from 'path';
import sanitize from 'sanitize-filename';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class FileManager {
  constructor(basePath) {
    this.basePath = basePath || './downloads';
  }

  sanitizeFilename(filename) {
    return sanitize(filename.replace(/[<>:"/\\|?*]/g, '-').substring(0, 200));
  }

  async ensureDir(dirPath) {
    await fs.ensureDir(dirPath);
  }

  async createCourseStructure(courseName, websiteName) {
    const sanitizedCourseName = this.sanitizeFilename(courseName);
    const sanitizedWebsite = this.sanitizeFilename(websiteName);
    const coursePath = path.join(this.basePath, sanitizedWebsite, sanitizedCourseName);

    await this.ensureDir(path.join(coursePath, 'videos'));
    await this.ensureDir(path.join(coursePath, 'documents'));
    await this.ensureDir(path.join(coursePath, 'html'));

    return coursePath;
  }

  async saveFile(filePath, content, isBinary = false) {
    await this.ensureDir(path.dirname(filePath));
    if (isBinary) {
      await fs.writeFile(filePath, content);
    } else {
      await fs.writeFile(filePath, content, 'utf8');
    }
  }

  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async getFileSize(filePath) {
    try {
      const stats = await fs.stat(filePath);
      return stats.size;
    } catch {
      return 0;
    }
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }

  async createManifest(coursePath, manifest) {
    const manifestPath = path.join(coursePath, 'manifest.json');
    await this.saveFile(manifestPath, JSON.stringify(manifest, null, 2));
  }

  async readManifest(coursePath) {
    const manifestPath = path.join(coursePath, 'manifest.json');
    if (await this.fileExists(manifestPath)) {
      const content = await fs.readFile(manifestPath, 'utf8');
      return JSON.parse(content);
    }
    return null;
  }
}

export default FileManager;
