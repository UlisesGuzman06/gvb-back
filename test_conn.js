const { Client } = require('pg');
const client = new Client({
  connectionString: "postgresql://postgres.msbbagkgbpcebzcnsuea:ezequiel45966443@aws-0-us-east-2.pooler.supabase.com:6543/postgres",
  ssl: {
    rejectUnauthorized: false
  }
});
client.connect()
  .then(() => {
    console.log("Connected successfully!");
    return client.query('SELECT COUNT(*) FROM "Match"');
  })
  .then(res => {
    console.log("Match count:", res.rows[0].count);
    return client.end();
  })
  .catch(err => {
    console.error("Connection failed:", err);
  });
