require('dotenv').config();
const { Pool } = require('pg');
const format = require('pg-format');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function fetchData(
  tableName,
  page,
  limit,
  startDate,
  endDate,
  insertedBy
) {
  try {
    const offset = (page - 1) * limit;
    const values = [
      parseInt(limit, 10),
      parseInt(offset, 10),
      startDate,
      endDate,
      insertedBy,
    ];

    // ✅ Validate table name to prevent SQL injection
    // const allowedTables = ['master_data', 'other_table']; // Add allowed tables
    // if (!allowedTables.includes(tableName)) {
    //   throw new Error('Invalid table name');
    // }

    // ✅ Main query with LIMIT & OFFSET
    const whereClause = `WHERE date BETWEEN $3::DATE AND $4::DATE AND inserted_by = $5::TEXT`;
    const query = `
        SELECT * FROM ${tableName}
        ${whereClause}
        ORDER BY date ASC
        LIMIT $1 OFFSET $2
      `;

    const res = await pool.query(query, values);

    // ✅ Fix countQuery (startDate is now $1, not $3)
    const countQuery = `SELECT COUNT(*) FROM ${tableName} WHERE date BETWEEN $1::DATE AND $2::DATE AND inserted_by = $3::TEXT`;
    const countValues = values.slice(2); // ✅ Use only [startDate, endDate, insertedBy]

    const countResult = await pool.query(countQuery, countValues);
    const totalRows = parseInt(countResult.rows[0].count, 10);

    return {
      totalRows,
      totalPages: Math.ceil(totalRows / limit),
      currentPage: Number(page),
      data: res.rows,
    };
  } catch (err) {
    console.error('Database Query Error:', err);
    throw err;
  }
}

async function insertData(username, tableName, columnOrder, data) {
  try {
    if (data.length === 0) {
      console.log('No data to insert.');
      return { message: 'No data inserted' };
    }

    // Clean and format data
    const cleanedData = data.map((row) =>
      columnOrder.map((col) =>
        typeof row[col] === 'string'
          ? row[col].trim() === '-'
            ? null
            : isNaN(row[col].trim())
            ? row[col].trim()
            : Number(row[col].trim())
          : row[col]
      )
    );

    // Generate parameterized placeholders
    let paramIndex = 2; // Start after $1 (username)
    const valuesPlaceholders = cleanedData
      .map(
        () =>
          `(gen_random_uuid(), $1, ${columnOrder
            .map(() => `$${paramIndex++}`)
            .join(', ')})`
      )
      .join(', ');

    // Flatten values array
    const values = [username, ...cleanedData.flat()];

    // ✅ Corrected ON CONFLICT clause
    const query = `
          INSERT INTO ${tableName} (id, inserted_by, ${columnOrder.join(', ')})
          VALUES ${valuesPlaceholders}
          ON CONFLICT (date)
          DO UPDATE SET
              ${columnOrder
                .map((col) => `${col} = EXCLUDED.${col}`)
                .join(', ')},
              inserted_by = EXCLUDED.inserted_by;`;

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
      'INSERT INTO users_authentication (username, password, is_super_admin) VALUES ($1, $2, false) RETURNING id, username, is_super_admin';
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
    )} WHERE id = $${index} RETURNING id, username, is_super_admin`;

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

async function getUser() {
  try {
    const query = 'SELECT username FROM users_authentication';
    const res = await pool.query(query);
    return res;
  } catch (err) {
    console.error('Error get user:', err);
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
    throw err;
  }
}

async function insertDataMappings(tableName, details) {
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

async function getDataMappings(tableName) {
  try {
    const res = await pool.query(
      `SELECT header_cell, column_name FROM public.data_mapping WHERE table_name = $1;`,
      [tableName]
    );

    return res.rows.reduce((acc, row) => {
      acc[row.header_cell] = row.column_name;
      return acc;
    }, {});
  } catch (err) {
    console.error('Error fetching data mappings:', err);
    throw err;
  }
}

async function insertHeaders(tableName, headers) {
  try {
    const query = `
        INSERT INTO table_headers (table_name, headers)
        VALUES ($1, $2) RETURNING id;
      `;
    const values = [tableName, JSON.stringify(headers)]; // Convert headers to JSON string

    const res = await pool.query(query, values);
    return res.rows[0]; // Return inserted row ID
  } catch (err) {
    console.error('Database Insert Error:', err);
    throw err;
  }
}

async function getHeaders(tableName) {
  try {
    const query = `
            SELECT headers FROM table_headers
            WHERE table_name = $1
            ORDER BY created_at;
        `;
    const values = [tableName];
    const res = await pool.query(query, values);

    return res.rows;
  } catch (err) {
    console.error('Database Fetch Error:', err);
    throw err;
  }
}

async function getTableNames() {
  try {
    const query = `SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public';`;
    const res = await pool.query(query);
    return res.rows;
  } catch (err) {
    console.error('Table Name Fetch Error:', err);
    throw err;
  }
}

async function insertDataCSV(tableName, username, rows) {
  try {
    const formattedRows = rows.map((row) => {
      return [convertDateFormat(row[0]), ...row.slice(1)];
    });

    const query = `
        INSERT INTO ${tableName} 
        (date, time, value_1, value_2, value_3, value_4, value_5, value_6, value_7, 
         value_8, value_9, value_10, value_11, value_12, value_13, value_14, value_15, value_16, inserted_by) 
        VALUES ${formattedRows
          .map(
            (_, i) =>
              `(${Array(18)
                .fill(0)
                .map((_, j) => `$${i * 18 + j + 1}`)
                .join(', ')}, '${username}')`
          )
          .join(', ')}
      `;

    const flattenedValues = formattedRows.flat();

    const res = await pool.query(query, flattenedValues);
    return res.rows[0]; // Return inserted row ID
  } catch (err) {
    console.error('Database Insert Error:', err);
    throw err;
  }
}

function convertDateFormat(dateString) {
  const [day, month, year] = dateString.split('/');
  return `${year}-${month}-${day}`; // Convert to YYYY-MM-DD format
}

module.exports = {
  registerUser,
  updateUser,
  login,
  fetchData,
  insertData,
  masterColumnName,
  insertDataMappings,
  getDataMappings,
  insertHeaders,
  getHeaders,
  getTableNames,
  getUser,
  insertDataCSV,
};
