import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbName = process.env.DB_NAME || 'alta_densidad_data';

async function initDb() {
    let connection;
    try {
        // Step 1: Connect to MySQL WITHOUT specifying a database
        connection = await mysql.createConnection({
            host: process.env.DB_HOST,
            user: process.env.DB_USER,
            password: process.env.DB_PASS,
            port: process.env.DB_PORT || 3306,
            multipleStatements: true,
        });

        console.log('Connected to MySQL (no database selected).');

        // Step 2: Create the database if it doesn't exist
        await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\`;`);
        console.log(`Database "${dbName}" ensured.`);

        // Step 3: Select the database
        await connection.query(`USE \`${dbName}\`;`);
        console.log(`Using database "${dbName}".`);

        // Step 4: Read and execute the schema
        const schemaPath = path.join(__dirname, 'schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');
        await connection.query(schema);
        console.log('Schema executed successfully.');

    } catch (error) {
        console.error('Database initialization failed:', error.message);
        process.exit(1);
    } finally {
        if (connection) {
            await connection.end();
            console.log('Database connection closed.');
        }
    }
}

initDb();
