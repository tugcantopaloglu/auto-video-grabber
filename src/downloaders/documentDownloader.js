import axios from 'axios';
import path from 'path';
import logger from '../utils/logger.js';
import FileManager from '../utils/fileManager.js';

class DocumentDownloader {
  constructor(config) {
    this.config = config;
    this.fileManager = new FileManager(config.downloadPath);
  }

  async downloadDocument(docUrl, outputPath, filename = null) {
    const finalFilename = filename || docUrl.split('/').pop().split('?')[0];
    const sanitizedFilename = this.fileManager.sanitizeFilename(finalFilename);
    const docFilePath = path.join(outputPath, sanitizedFilename);

    if (await this.fileManager.fileExists(docFilePath)) {
      logger.info(`Document already exists: ${sanitizedFilename}`);
      return docFilePath;
    }

    logger.startSpinner(`Downloading document: ${sanitizedFilename}`);

    try {
      const response = await axios({
        url: docUrl,
        method: 'GET',
        responseType: 'arraybuffer',
        timeout: this.config.timeout,
        headers: {
          'User-Agent': this.config.userAgent,
          'Referer': docUrl
        }
      });

      await this.fileManager.saveFile(docFilePath, response.data, true);

      const fileSize = await this.fileManager.getFileSize(docFilePath);
      logger.stopSpinner(true, `Downloaded: ${sanitizedFilename} (${this.fileManager.formatBytes(fileSize)})`);

      return docFilePath;
    } catch (error) {
      logger.stopSpinner(false, `Failed to download document: ${error.message}`);
      throw error;
    }
  }

  async downloadDocuments(documentList, outputPath) {
    const documentsDir = path.join(outputPath, 'documents');
    await this.fileManager.ensureDir(documentsDir);

    const downloadedDocs = [];

    if (documentList.length === 0) {
      logger.info('No documents found to download');
      return downloadedDocs;
    }

    logger.info(`Found ${documentList.length} documents to download`);

    for (let i = 0; i < documentList.length; i++) {
      try {
        const doc = documentList[i];
        const docPath = await this.downloadDocument(
          doc.href,
          documentsDir,
          doc.filename
        );

        downloadedDocs.push({
          filename: doc.filename,
          path: path.relative(outputPath, docPath),
          originalUrl: doc.href,
          size: await this.fileManager.getFileSize(docPath)
        });

        logger.progress(i + 1, documentList.length, doc.filename);
      } catch (error) {
        logger.error(`Failed to download ${documentList[i].filename}: ${error.message}`);
      }
    }

    return downloadedDocs;
  }

  async extractDocumentsFromPage(page, selectors) {
    try {
      const documents = await page.evaluate((sel) => {
        const docs = [];
        const links = document.querySelectorAll(sel.documents);

        links.forEach(link => {
          const href = link.href;
          const filename = link.textContent.trim() || href.split('/').pop();

          docs.push({
            href,
            filename: filename.length > 0 ? filename : href.split('/').pop(),
            text: link.textContent.trim()
          });
        });

        return docs;
      }, selectors);

      return documents;
    } catch (error) {
      logger.warning(`Failed to extract documents: ${error.message}`);
      return [];
    }
  }

  isDocumentUrl(url) {
    const documentExtensions = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.zip', '.rar'];
    return documentExtensions.some(ext => url.toLowerCase().includes(ext));
  }
}

export default DocumentDownloader;
