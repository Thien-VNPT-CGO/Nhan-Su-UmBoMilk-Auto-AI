import { google } from 'googleapis';
import { getSettings } from './SettingsService';
import { env } from '../config/env';
import fs from 'fs';

export class GoogleDriveUploadService {
  private async getDriveClient() {
    const settings = await getSettings();
    const email = settings.googleSheet?.serviceAccountEmail;
    const key = settings.googleSheet?.privateKey;
    const driveFolderId = (settings.googleSheet as any)?.driveFolderId || env.backupDriveFolder;

    if (!email || !key || !driveFolderId) {
      return null;
    }

    const auth = new google.auth.JWT({
      email,
      key: key.replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/drive'],
    });

    const drive = google.drive({ version: 'v3', auth });
    return { drive, rootFolderId: driveFolderId };
  }

  private async findOrCreateFolder(drive: any, folderName: string, parentFolderId: string): Promise<string> {
    try {
      const q = `'${parentFolderId}' in parents and name = '${folderName.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
      const res = await drive.files.list({
        q,
        fields: 'files(id, name)',
        spaces: 'drive',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });

      if (res.data.files && res.data.files.length > 0) {
        return res.data.files[0].id;
      }

      const createRes = await drive.files.create({
        requestBody: {
          name: folderName,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [parentFolderId],
        },
        fields: 'id',
        supportsAllDrives: true,
      });

      return createRes.data.id;
    } catch (e) {
      console.warn(`[GoogleDrive] Failed to findOrCreateFolder '${folderName}':`, e instanceof Error ? e.message : String(e));
      return parentFolderId;
    }
  }

  async uploadAttendanceFiles(params: {
    typeFolder: string;
    cleanBranch: string;
    shiftFolder: string;
    cleanCandidateName: string;
    dateFolder: string;
    actionFolder: string;
    imageFilePath: string;
    txtFilePath: string;
  }): Promise<void> {
    try {
      const client = await this.getDriveClient();
      if (!client) {
        console.warn('[GoogleDrive] Drive client not configured (missing credentials or driveFolderId)');
        return;
      }

      const { drive, rootFolderId } = client;

      // 1. Tạo cây thư mục 6 cấp trên Google Drive:
      // rootFolderId -> typeFolder -> cleanBranch -> shiftFolder -> cleanCandidateName -> dateFolder (DD-MM-YYYY) -> actionFolder (CHECK_IN/CHECK_OUT)
      const typeFolderId = await this.findOrCreateFolder(drive, params.typeFolder, rootFolderId);
      const branchFolderId = await this.findOrCreateFolder(drive, params.cleanBranch, typeFolderId);
      const shiftFolderId = await this.findOrCreateFolder(drive, params.shiftFolder, branchFolderId);
      const candidateFolderId = await this.findOrCreateFolder(drive, params.cleanCandidateName, shiftFolderId);
      const dateFolderId = await this.findOrCreateFolder(drive, params.dateFolder, candidateFolderId);
      const actionFolderId = await this.findOrCreateFolder(drive, params.actionFolder, dateFolderId);

      console.log(`[GoogleDrive] Target folder ID for ${params.cleanCandidateName} (${params.actionFolder}): ${actionFolderId}`);

      // 2. Upload file ảnh cửa hàng Anh_chup_cua_hang.jpg
      if (fs.existsSync(params.imageFilePath)) {
        const imgRes = await drive.files.create({
          requestBody: {
            name: 'Anh_chup_cua_hang.jpg',
            parents: [actionFolderId],
          },
          media: {
            mimeType: 'image/jpeg',
            body: fs.createReadStream(params.imageFilePath),
          },
          fields: 'id, name, webViewLink',
          supportsAllDrives: true,
        });
        console.log(`[GoogleDrive] ✅ Image uploaded successfully: ${imgRes.data.name} (ID: ${imgRes.data.id})`);
      } else {
        console.warn(`[GoogleDrive] Image file missing locally: ${params.imageFilePath}`);
      }

      // 3. Upload file văn bản Diem_danh.txt
      if (fs.existsSync(params.txtFilePath)) {
        const txtRes = await drive.files.create({
          requestBody: {
            name: 'Diem_danh.txt',
            parents: [actionFolderId],
          },
          media: {
            mimeType: 'text/plain',
            body: fs.createReadStream(params.txtFilePath),
          },
          fields: 'id, name, webViewLink',
          supportsAllDrives: true,
        });
        console.log(`[GoogleDrive] ✅ Txt file uploaded successfully: ${txtRes.data.name} (ID: ${txtRes.data.id})`);
      } else {
        console.warn(`[GoogleDrive] Txt file missing locally: ${params.txtFilePath}`);
      }

      console.log(`[GoogleDrive] 🎉 Successfully completed all attendance uploads for ${params.cleanCandidateName}`);
    } catch (e) {
      console.error('[GoogleDrive] Attendance backup upload failed:', e instanceof Error ? e.message : String(e));
    }
  }
}

export const googleDriveUploadService = new GoogleDriveUploadService();
