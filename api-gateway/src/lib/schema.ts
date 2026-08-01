import { pgTable, text, timestamp, varchar, customType, boolean, integer, jsonb } from 'drizzle-orm/pg-core';

// We define a custom vector type for pgvector
const vector = customType<{ data: number[] }>({
  dataType() {
    return 'vector(768)';
  },
});

// --- Module 1: Auth & Profiles ---
export const userProfiles = pgTable('user_profiles', {
  id: varchar('id', { length: 255 }).primaryKey(), // Maps to Firebase UID
  email: varchar('email', { length: 255 }).notNull(),
  role: varchar('role', { length: 50 }).default('End-User').notNull(),
  ageBracket: varchar('age_bracket', { length: 20 }), // <18, 18-64, 65+
  highContrastMode: boolean('high_contrast_mode').default(false),
  dyslexicFont: boolean('dyslexic_font').default(false),
  fontScale: varchar('font_scale', { length: 10 }).default('1.0x'),
  plainLanguage: boolean('plain_language').default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// --- Module 5: B2B Authoring (Existing) ---
export const manuals = pgTable('manuals', {
  id: varchar('id', { length: 255 }).primaryKey(),
  userId: varchar('user_id', { length: 255 }).notNull(),
  title: text('title').notNull(),
  storageUrl: text('storage_url').notNull(),
  status: varchar('status', { length: 50 }).default('pending').notNull(),
  visibility: varchar('visibility', { length: 50 }).default('PRIVATE').notNull(), // UC-9.2 Product Visibility
  createdAt: timestamp('created_at').defaultNow().notNull(),
  version: integer('version').default(1).notNull(), // UC-6.3 Optimistic Locking
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

// --- Module 2 & 9: Products & Digital Product Passport (DPP) ---
export const products = pgTable('products', {
  id: varchar('id', { length: 255 }).primaryKey(), // GTIN or UUID
  brand: varchar('brand', { length: 255 }),
  category: varchar('category', { length: 255 }),
  voltageRating: varchar('voltage_rating', { length: 50 }),
  manualId: varchar('manual_id', { length: 255 }).references(() => manuals.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const productPassports = pgTable('product_passports', {
  id: varchar('id', { length: 255 }).primaryKey(),
  productId: varchar('product_id', { length: 255 }).references(() => products.id).notNull(),
  serialNumber: varchar('serial_number', { length: 255 }),
  carbonMetrics: jsonb('carbon_metrics'), // Public access
  bom: jsonb('bom'), // Bill of Materials (Restricted)
  svhc: jsonb('svhc'), // Restricted chemicals
});

// --- Module 6: Repair Hub Social Network ---
export const forumThreads = pgTable('forum_threads', {
  id: varchar('id', { length: 255 }).primaryKey(),
  productId: varchar('product_id', { length: 255 }).references(() => products.id),
  authorId: varchar('author_id', { length: 255 }).references(() => userProfiles.id),
  title: text('title').notNull(),
  isSolved: boolean('is_solved').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const forumPosts = pgTable('forum_posts', {
  id: varchar('id', { length: 255 }).primaryKey(),
  threadId: varchar('thread_id', { length: 255 }).references(() => forumThreads.id).notNull(),
  authorId: varchar('author_id', { length: 255 }).references(() => userProfiles.id),
  content: text('content').notNull(),
  upvotes: integer('upvotes').default(0).notNull(),
  isSolution: boolean('is_solution').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// --- Module 8: Analytics & Telemetry ---
export const telemetryEvents = pgTable('telemetry_events', {
  id: varchar('id', { length: 255 }).primaryKey(),
  eventType: varchar('event_type', { length: 100 }).notNull(), // e.g., 'qr_scan', 'manual_dropoff'
  userId: varchar('user_id', { length: 255 }), // Nullable for guests
  metadata: jsonb('metadata'), // Additional event data
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
