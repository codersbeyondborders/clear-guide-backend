import { pgTable, text, timestamp, varchar, customType } from 'drizzle-orm/pg-core';

// We define a custom vector type for pgvector
const vector = customType<{ data: number[] }>({
  dataType() {
    return 'vector(768)';
  },
});

export const manuals = pgTable('manuals', {
  id: varchar('id', { length: 255 }).primaryKey(),
  userId: varchar('user_id', { length: 255 }).notNull(),
  title: text('title').notNull(),
  storageUrl: text('storage_url').notNull(),
  status: varchar('status', { length: 50 }).default('pending').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const manualChunks = pgTable('manual_chunks', {
  id: varchar('id', { length: 255 }).primaryKey(),
  manualId: varchar('manual_id', { length: 255 }).references(() => manuals.id).notNull(),
  content: text('content').notNull(),
  // Full Text Search vector (tsvector)
  ftsVector: text('fts_vector'), 
  // Semantic Search vector (pgvector)
  embedding: vector('embedding', 768), 
});
