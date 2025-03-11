require('dotenv').config();
const { Pool } = require('pg');
const format = require('pg-format');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function fetchData(tableName) {
  try {
    const res = await pool.query(`SELECT * FROM ${tableName}`);
    return res;
  } catch (err) {
    console.error(err);
  } finally {
    pool.end(); // Close the pool
  }
}

async function insertData(username, tableName, columnOrder, data) {
  try {
    const cleanedData = data.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key,
          typeof value === 'string'
            ? value.trim() === '-' // Convert "-" to null
              ? null
              : isNaN(value.trim()) // If value is non-numeric, keep as string
              ? value.trim()
              : Number(value.trim()) // Convert numeric strings to numbers
            : value,
        ])
      )
    );
    const formattedData = cleanedData.map((row) =>
      columnOrder.map((col) => row[col] || null)
    );

    const query = `
        INSERT INTO ${tableName} VALUES ${formattedData
      .map(
        (_, i) =>
          `(gen_random_uuid(),'${username}',${columnOrder
            .map((_, j) => `$${i * columnOrder.length + j + 1}`)
            .join(', ')})`
      )
      .join(', ')} ON CONFLICT (date) DO NOTHING;`;

    const values = formattedData.flat();
    const res = await pool.query(query, values);
    return res;
  } catch (err) {
    console.error('Error inserting data:', err);
    throw err;
  }
}

async function registerUser(data) {
  try {
    const query =
      'INSERT INTO users_authentication (username, password) VALUES ($1, $2) RETURNING id, username';
    const res = await pool.query(query, [data.username, data.hashedPassword]);
    return res;
  } catch (err) {
    console.error('Error register user:', err);
    throw err;
  }
}

async function updateUser(updateFields, index, values) {
  try {
    const query = `UPDATE users_authentication SET ${updateFields.join(
      ', '
    )} WHERE id = $${index} RETURNING id, username`;

    const result = await pool.query(query, values);
    return result;
  } catch (err) {
    console.error('Error update user:', err);
    throw err;
  }
}

async function login(username) {
  try {
    const query = 'SELECT * FROM users_authentication WHERE username = $1';
    const res = await pool.query(query, [username]);
    return res;
  } catch (err) {
    console.error('Error login user:', err);
    throw err;
  }
}

async function masterColumnName(tableName) {
  try {
    const res = await pool.query(`SELECT column_name
      FROM information_schema.columns
      WHERE table_name = '${tableName}' ORDER BY ordinal_position;`);
    return res;
  } catch (err) {
    console.error(err);
  } finally {
    pool.end(); // Close the pool
  }
}

async function insertMasterColumnNames(tableName, details) {
  try {
    const values = [];
    const placeholders = details
      .map((_, i) => `($1, $${i * 2 + 2}, $${i * 2 + 3})`)
      .join(', ');

    for (const { header_cell, column_name } of details) {
      values.push(header_cell, column_name);
    }

    const query = `
        INSERT INTO public.data_mapping (table_name, header_cell, column_name)
        VALUES ${placeholders};
      `;

    await pool.query(query, [tableName, ...values]);
  } catch (err) {
    console.error('Error inserting data:', err);
    throw err;
  }
}

module.exports = {
  registerUser,
  updateUser,
  login,
  fetchData,
  insertData,
  masterColumnName,
  insertMasterColumnNames,
};
