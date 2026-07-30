import * as admin from 'firebase-admin';

// Initialize with default credentials
admin.initializeApp({
  projectId: 'clear-guide',
});

async function fixRoles() {
  const db = admin.firestore();
  const auth = admin.auth();

  const manufacturersSnap = await db.collection('manufacturers').get();
  console.log(`Found ${manufacturersSnap.size} manufacturers.`);

  for (const doc of manufacturersSnap.docs) {
    const uid = doc.id;
    try {
      const userRecord = await auth.getUser(uid);
      const currentClaims = userRecord.customClaims || {};
      
      if (currentClaims.role !== 'enterprise_author') {
        console.log(`Setting enterprise_author role for ${uid} (${userRecord.email})`);
        await auth.setCustomUserClaims(uid, { ...currentClaims, role: 'enterprise_author' });
        console.log(`Successfully updated ${uid}`);
      } else {
        console.log(`User ${uid} already has enterprise_author role.`);
      }
    } catch (e) {
      console.error(`Error processing ${uid}:`, e);
    }
  }
}

fixRoles().then(() => console.log('Done')).catch(console.error);
