import { Client } from 'pg';

const connectionString = process.env.DATABASE_URL;

async function setup() {
  const client = new Client({ connectionString });
  await client.connect();
  console.log('Connected to database.');
  
  await client.query('CREATE EXTENSION IF NOT EXISTS vector;');
  console.log('pgvector extension ensured.');
  
  await client.end();
}

setup().catch(console.error);
