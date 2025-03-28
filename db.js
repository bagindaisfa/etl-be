require('dotenv').config();
const { Pool } = require('pg');
const format = require('pg-format');
const dayjs = require('dayjs');

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
    let values = [
      parseInt(limit, 10),
      parseInt(offset, 10),
      startDate,
      endDate,
    ];

    if (insertedBy.toLowerCase() !== 'all') {
      values.push(insertedBy);
    }
    // ✅ Validate table name to prevent SQL injection
    // const allowedTables = ['master_data', 'other_table']; // Add allowed tables
    // if (!allowedTables.includes(tableName)) {
    //   throw new Error('Invalid table name');
    // }

    // ✅ Main query with LIMIT & OFFSET
    const whereClause = `WHERE date BETWEEN $3::DATE AND $4::DATE ${
      insertedBy.toLowerCase() === 'all' ? '' : 'AND inserted_by = $5::TEXT'
    }`;
    const query = `
        SELECT * FROM ${tableName}
        ${whereClause}
        ORDER BY date ASC
        LIMIT $1 OFFSET $2
      `;

    const res = await pool.query(query, values);

    // ✅ Fix countQuery (startDate is now $1, not $3)
    const countQuery = `SELECT COUNT(*) FROM ${tableName} WHERE date BETWEEN $1::DATE AND $2::DATE ${
      insertedBy.toLowerCase() === 'all' ? '' : 'AND inserted_by = $3::TEXT'
    }`;
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

async function fetchDataExport(tableName, startDate, endDate, insertedBy) {
  try {
    let values = [startDate, endDate];

    if (insertedBy.toLowerCase() !== 'all') {
      values.push(insertedBy);
    }

    // ✅ Main query with LIMIT & OFFSET
    const whereClause = `WHERE date BETWEEN $1::DATE AND $2::DATE ${
      insertedBy.toLowerCase() === 'all' ? '' : 'AND inserted_by = $3::TEXT'
    }`;
    const query = `
        SELECT * FROM ${tableName}
        ${whereClause}
        ORDER BY date ASC
      `;

    const res = await pool.query(query, values);

    return {
      data: res.rows,
    };
  } catch (err) {
    console.error('Database Query Error:', err);
    throw err;
  }
}

async function hasUniqueConstraint(tableName, columnName) {
  const query = `
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = '${tableName}'::regclass
    AND conkey::text LIKE '%' || (
      SELECT attnum FROM pg_attribute
      WHERE attrelid = '${tableName}'::regclass
      AND attname = '${columnName}'
    )::text || '%'
    AND contype = 'u';
  `;

  const res = await pool.query(query);
  return res.rows.length > 0; // Returns true if unique constraint exists
}

async function insertData(username, tableName, columnOrder, data) {
  try {
    if (data.length === 0) {
      console.log('No data to insert.');
      return { message: 'No data inserted' };
    }

    // Check if the table has a unique constraint on 'date'
    const hasUniqueDate = await hasUniqueConstraint(tableName, 'date');

    // Clean and format data
    const cleanedData = data.map((row) =>
      columnOrder.map((col) => {
        let cellValue = row[col];

        if (col.toLowerCase().includes('time')) {
          if (
            cellValue === null ||
            cellValue === undefined ||
            cellValue === ''
          ) {
            return '00:00:00'; // Or set to '00:00:00' if needed
          }

          if (typeof cellValue === 'number') {
            // Convert Excel time format (fractional days) to HH:mm:ss
            const hours = Math.floor(cellValue * 24);
            const minutes = Math.round((cellValue * 24 - hours) * 60);
            return dayjs()
              .hour(hours)
              .minute(minutes)
              .second(0)
              .format('HH:mm:ss');
          }

          return cellValue; // Keep as is if it's already a valid time string
        } else if (col.toLowerCase().includes('date')) {
          const date_value = isValidYYYYMMDD(cellValue)
            ? cellValue
            : convertDateFormat(cellValue);

          return date_value;
        } else {
          if (
            cellValue === null ||
            cellValue === undefined ||
            cellValue === ''
          ) {
            return 0; // Or set to '00:00:00' if needed
          }
        }

        return typeof cellValue === 'string'
          ? cellValue.trim() === '-'
            ? null
            : isNaN(cellValue.trim())
            ? cellValue.trim()
            : Number(cellValue.trim())
          : cellValue;
      })
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

    let query = `
      INSERT INTO ${tableName} (id, inserted_by, ${columnOrder.join(', ')})
      VALUES ${valuesPlaceholders}
    `;

    // Only apply ON CONFLICT if 'date' has a unique constraint
    if (hasUniqueDate) {
      query += `
        ON CONFLICT (date)
        DO UPDATE SET
            ${columnOrder.map((col) => `${col} = EXCLUDED.${col}`).join(', ')},
            inserted_by = EXCLUDED.inserted_by;
      `;
    }

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

async function insertDataCSVFormated(tableName, username, rows, columns) {
  try {
    // Ensure `inserted_by` is added to the columns
    const allColumns = [...columns];

    const formatDate = (dateStr) => {
      const parts = dateStr.split('/');
      if (parts.length === 3) {
        let [day, month, year] = parts;

        // Convert two-digit year to four-digit year (assuming 20xx)
        if (year.length === 2) {
          year = `20${year}`;
        }

        return `${year}-${month}-${day}`;
      }
      return dateStr; // Return unchanged if not in expected format
    };

    const formatTime = (timeStr) => {
      // Ensure it's a string and replace dots with colons
      return typeof timeStr === 'string'
        ? timeStr.replace(/\./g, ':')
        : timeStr;
    };

    const formatNumber = (numStr) => {
      if (typeof numStr === 'string' && numStr.includes(',')) {
        return numStr.replace(/,/g, '.'); // Replace commas with dots
      }
      return numStr;
    };

    // Convert dates if a column contains "date"

    const formattedRows = rows.map((row) =>
      row.map((value, index) =>
        columns[index]?.toLowerCase().includes('date')
          ? isValidYYYYMMDD(value)
            ? value
            : formatDate(value)
          : columns[index]?.toLowerCase().includes('time')
          ? formatTime(value)
          : formatNumber(value)
      )
    );

    // Construct the dynamic INSERT query
    const query = `
        INSERT INTO ${tableName} (${allColumns.join(', ')}, inserted_by) 
        VALUES ${formattedRows
          .map(
            (_, i) =>
              `(${Array(allColumns.length)
                .fill(0)
                .map((_, j) => `$${i * allColumns.length + j + 1}`)
                .join(', ')}, '${username}')`
          )
          .join(', ')}
      `;

    const flattenedValues = formattedRows.flat(); // Append username
    const res = await pool.query(query, flattenedValues);
    return res.rows[0];
  } catch (err) {
    console.error('Database Insert Error:', err);
    throw err;
  }
}

async function insertDataCSV(tableName, username, rows, columns) {
  try {
    // Ensure `inserted_by` is added to the columns
    const allColumns = [...columns];

    // Convert dates if a column contains "date"
    const formattedRows = rows.map((row) =>
      row.map((value, index) =>
        columns[index]?.toLowerCase().includes('date')
          ? convertDateFormat(value)
          : value
      )
    );

    // Construct the dynamic INSERT query
    const query = `
        INSERT INTO ${tableName} (${allColumns.join(', ')}, inserted_by) 
        VALUES ${formattedRows
          .map(
            (_, i) =>
              `(${Array(allColumns.length)
                .fill(0)
                .map((_, j) => `$${i * allColumns.length + j + 1}`)
                .join(', ')}, '${username}')`
          )
          .join(', ')}
      `;

    const flattenedValues = formattedRows.flat(); // Append username
    const res = await pool.query(query, flattenedValues);
    return res.rows[0];
  } catch (err) {
    console.error('Database Insert Error:', err);
    throw err;
  }
}

function convertDateFormat(dateString) {
  const [day, month, year] = dateString.split('/');
  return `${year}-${month}-${day}`; // Convert to YYYY-MM-DD format
}

function isValidYYYYMMDD(dateStr) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

async function getTableColumns(tableName) {
  try {
    const query = `
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = $1 
        AND column_name <> 'id'
        AND column_name <> 'inserted_by'
        AND column_name <> 'created_at'
        ORDER BY ordinal_position;
      `;
    const result = await pool.query(query, [tableName]);
    return result.rows.map((row) => row.column_name);
  } catch (err) {
    console.error('Error fetching table columns:', err);
    throw err;
  }
}

async function getTableExported(tableName) {
  try {
    const query = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = $1
      ORDER BY ordinal_position;
    `;
    const result = await pool.query(query, [tableName]);
    return result.rows.map((row) => row.column_name);
  } catch (err) {
    console.error('Error fetching table columns:', err);
    throw err;
  }
}

async function hasUniqueConstraint(tableName, columnName) {
  const query = `
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = '${tableName}'::regclass
    AND conkey::text LIKE '%' || (
      SELECT attnum FROM pg_attribute
      WHERE attrelid = '${tableName}'::regclass
      AND attname = '${columnName}'
    )::text || '%'
    AND contype = 'u';
  `;

  const res = await pool.query(query);
  return res.rows.length > 0; // Returns true if unique constraint exists
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
  getTableColumns,
  getTableExported,
  insertDataCSVFormated,
  fetchDataExport,
};
