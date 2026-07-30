import os
import json
from google.cloud import pubsub_v1

publisher = None
if os.getenv("GOOGLE_CLOUD_PROJECT"):
    publisher = pubsub_v1.PublisherClient()
    
PROJECT_ID = os.getenv("GOOGLE_CLOUD_PROJECT", "clear-guide")

def publish_event(topic_id: str, payload: dict):
    """
    Publishes an event to a Google Cloud Pub/Sub topic.
    In local development, ensure PUBSUB_EMULATOR_HOST is set.
    """
    if not publisher:
        print(f"[Pub/Sub] Skipping publish to {topic_id} - publisher not initialized")
        return None
        
    topic_path = publisher.topic_path(PROJECT_ID, topic_id)
    data_str = json.dumps(payload)
    data_bytes = data_str.encode("utf-8")
    
    try:
        future = publisher.publish(topic_path, data_bytes)
        message_id = future.result()
        print(f"[Pub/Sub] Published message {message_id} to {topic_path}")
        return message_id
    except Exception as e:
        print(f"[Pub/Sub Error] Failed to publish: {e}")
        # Automatically create topic if running in emulator and it doesn't exist
        if os.getenv("PUBSUB_EMULATOR_HOST") and "NotFound" in str(e):
            print(f"[Pub/Sub] Creating topic {topic_path} in emulator...")
            publisher.create_topic(request={"name": topic_path})
            future = publisher.publish(topic_path, data_bytes)
            return future.result()
        raise e

def decode_push_payload(request_body: dict) -> dict:
    """
    Decodes the base64-encoded message data from a Pub/Sub push request.
    """
    import base64
    if not request_body or "message" not in request_body:
        raise ValueError("Invalid Pub/Sub push format")
        
    encoded_data = request_body["message"].get("data")
    if not encoded_data:
        return {}
        
    decoded_bytes = base64.b64decode(encoded_data)
    decoded_str = decoded_bytes.decode("utf-8")
    return json.loads(decoded_str)
