import * as admin from 'firebase-admin';
import * as fs from 'fs';

/**
 * Resolves GCP Service Account credentials from file path, Base64 string, or inline JSON.
 */
export function getGcpServiceAccountCredentials() {
  const serviceAccountKeyPath = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || './service-account.json';
  const base64Env = process.env.GCP_SERVICE_ACCOUNT_BASE64;
  const jsonEnv = process.env.GCP_SERVICE_ACCOUNT_JSON;

  if (base64Env) {
    try {
      const decoded = Buffer.from(base64Env, 'base64').toString('utf-8');
      return JSON.parse(decoded);
    } catch (e) {
      console.warn('Notice parsing GCP_SERVICE_ACCOUNT_BASE64 env var');
    }
  }

  if (jsonEnv) {
    try {
      return JSON.parse(jsonEnv);
    } catch (e) {
      console.warn('Notice parsing GCP_SERVICE_ACCOUNT_JSON env var');
    }
  }

  if (fs.existsSync(serviceAccountKeyPath)) {
    try {
      return JSON.parse(fs.readFileSync(serviceAccountKeyPath, 'utf-8'));
    } catch (e) {
      console.warn(`Notice parsing service account file at ${serviceAccountKeyPath}`);
    }
  }

  return null;
}

if (!admin.apps.length) {
  const creds = getGcpServiceAccountCredentials();
  if (creds) {
    admin.initializeApp({
      credential: admin.credential.cert(creds),
      projectId: process.env.GOOGLE_CLOUD_PROJECT || creds.project_id || 'clear-guide',
    });
  } else {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: process.env.GOOGLE_CLOUD_PROJECT || 'clear-guide',
    });
  }
}

export const auth = admin.auth();
export const firestore = admin.firestore();

