import { PubSub } from '@google-cloud/pubsub';

const pubsub = new PubSub({
  projectId: process.env.GOOGLE_CLOUD_PROJECT || 'clear-guide',
  apiEndpoint: process.env.PUBSUB_EMULATOR_HOST,
});

export async function publishToTopic(topicName: string, data: any) {
  try {
    const dataBuffer = Buffer.from(JSON.stringify(data));
    const messageId = await pubsub.topic(topicName).publishMessage({ data: dataBuffer });
    console.log(`[Pub/Sub] Published message ${messageId} to ${topicName}`);
    return messageId;
  } catch (err: any) {
    // If running locally against emulator, auto-create the topic if it doesn't exist
    if (process.env.PUBSUB_EMULATOR_HOST && err.code === 5) {
      console.log(`[Pub/Sub] Creating topic ${topicName} in emulator...`);
      await pubsub.createTopic(topicName);
      const dataBuffer = Buffer.from(JSON.stringify(data));
      const messageId = await pubsub.topic(topicName).publishMessage({ data: dataBuffer });
      return messageId;
    }
    throw err;
  }
}
