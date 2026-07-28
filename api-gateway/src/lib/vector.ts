import { sql, eq, and, ilike } from 'drizzle-orm';
import { db } from './db';
import { manualChunks } from './schema';

export interface VectorSearchResult {
  id: string;
  manualId: string;
  content: string;
  distance?: number;
}

/**
 * Format a numeric array into a PostgreSQL pgvector string literal: '[0.1, 0.2, ...]'
 */
export function formatVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

/**
 * Performs cosine similarity search over manual_chunks using pgvector's <=> operator.
 */
export async function searchManualChunksByVector(params: {
  embedding: number[];
  manualId?: string;
  limit?: number;
}): Promise<VectorSearchResult[]> {
  const { embedding, manualId, limit = 5 } = params;
  const vectorStr = formatVectorLiteral(embedding);

  const distanceExpr = sql<number>`embedding <=> ${vectorStr}::vector`;

  try {
    const baseQuery = db
      .select({
        id: manualChunks.id,
        manualId: manualChunks.manualId,
        content: manualChunks.content,
        distance: distanceExpr,
      })
      .from(manualChunks);

    const query = manualId
      ? baseQuery.where(eq(manualChunks.manualId, manualId))
      : baseQuery;

    const results = await query
      .orderBy(distanceExpr)
      .limit(limit);

    return results;
  } catch (error) {
    console.error('Error executing vector search, falling back to text search:', error);
    return [];
  }
}

/**
 * Performs hybrid search combining ILIKE text matching and optional pgvector distance sorting.
 */
export async function hybridSearch(params: {
  queryText: string;
  embedding?: number[];
  manualId?: string;
  limit?: number;
}): Promise<VectorSearchResult[]> {
  const { queryText, embedding, manualId, limit = 5 } = params;

  if (embedding && embedding.length === 768) {
    const vectorResults = await searchManualChunksByVector({ embedding, manualId, limit });
    if (vectorResults.length > 0) {
      return vectorResults;
    }
  }

  // Text search fallback
  const searchPattern = `%${queryText}%`;
  const conditions = manualId
    ? and(eq(manualChunks.manualId, manualId), ilike(manualChunks.content, searchPattern))
    : ilike(manualChunks.content, searchPattern);

  const results = await db
    .select({
      id: manualChunks.id,
      manualId: manualChunks.manualId,
      content: manualChunks.content,
    })
    .from(manualChunks)
    .where(conditions)
    .limit(limit);

  return results.map((r) => ({ ...r, distance: 0 }));
}
