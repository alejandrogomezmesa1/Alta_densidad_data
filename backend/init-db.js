import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const initializeDatabase = async (pool) => {
    let connection;
    try {
        const schemaPath = join(__dirname, 'schema.sql');
        const schemaSql = readFileSync(schemaPath, 'utf8');

        // Split on semicolons, filter out empty/whitespace-only statements,
        // and skip database-level directives that don't apply inside a pool
        // connection that is already scoped to the correct database.
        const statements = schemaSql
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0)
            .filter(s => !/^(CREATE DATABASE|USE )/i.test(s));

        connection = await pool.getConnection();

        for (const statement of statements) {
            await connection.query(statement);
        }

        console.log('Database schema initialized successfully.');
    } catch (error) {
        console.error('Warning: Could not initialize database schema:', error.message);
        // Do not rethrow — allow the server to start even if schema init fails
        // (e.g. tables already exist with a different engine, or DB is read-only).
    } finally {
        if (connection) connection.release();
    }
};

export default initializeDatabase;
