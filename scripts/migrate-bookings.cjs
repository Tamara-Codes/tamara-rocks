const fs = require('node:fs');
const { neon } = require('@neondatabase/serverless');
const { sqlStatements } = require('./sql-statements.cjs');
async function main() {
    const url = process.env.BOOKINGS_DATABASE_URL || process.env.DATABASE_URL_UNPOOLED;
    if (!url || new URL(url).hostname.includes('-pooler')) throw new Error('Use a direct database connection.');
    const sql = neon(url);
    const statements = sqlStatements(fs.readFileSync('migrations/20261119_workshop_bookings.sql', 'utf8'));
    await sql.transaction(statements.map(statement => sql.query(statement)));
    console.log(`Paid booking migration applied atomically (${statements.length} statements).`);
}
main().catch(error => { console.error('Paid booking migration failed:', error.code || '', String(error.message).replace(/postgres(?:ql)?:\/\/\S+/g, '[redacted]')); process.exitCode = 1; });
