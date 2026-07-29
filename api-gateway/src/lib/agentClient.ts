export async function dispatchToAgent(url: string, body: any, maxRetries = 3, customHeaders: Record<string, string> = {}): Promise<any> {
  const secret = process.env.AGENT_MESH_SECRET || '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...customHeaders,
  };

  if (secret) {
    headers['Authorization'] = `Bearer ${secret}`;
  }

  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });

      if (response.ok) {
        return await response.json();
      }

      // If it's a 4xx error (except 429 Too Many Requests), don't retry, it's a client/auth error
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        const errorText = await response.text();
        throw new Error(`AI Agent Mesh returned HTTP ${response.status}: ${errorText}`);
      }

      // If it's a 5xx or 429, we retry
      console.warn(`[AgentClient] Attempt ${attempt + 1} failed with status ${response.status} at ${url}. Retrying...`);
    } catch (error) {
      console.warn(`[AgentClient] Attempt ${attempt + 1} failed with error: ${error} at ${url}.`);
      if (attempt >= maxRetries - 1) {
        throw error;
      }
    }

    attempt++;
    if (attempt < maxRetries) {
      // Exponential backoff: 1s, 2s, 4s, etc.
      const backoffMs = Math.pow(2, attempt - 1) * 1000;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  throw new Error(`[AgentClient] Failed to reach Agent Mesh at ${url} after ${maxRetries} attempts.`);
}
