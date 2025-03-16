require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const multer = require('multer');
const xlsx = require('xlsx');
const csvParser = require('csv-parser');
const fs = require('fs');
const cookieParser = require('cookie-parser');

const {
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
} = require('./db');
const authenticateToken = require('./middleware');

const allowedOrigins = [
  'http://localhost:5173',
  'http://151.106.112.134:5173',
  'https://etl-system-core.com',
];

const app = express();
app.use(express.json());

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, origin); // Allow the requested origin
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  })
);
app.use(cookieParser()); // Middleware to parse cookies

const SECRET_KEY = process.env.SECRET_KEY || 'B@judit0k02018';

// function section
// Helper function to convert column letters to index

function excelColumnToIndex(column) {
  let index = 0;
  for (let i = 0; i < column.length; i++) {
    index = index * 26 + (column.charCodeAt(i) - 64);
  }
  return index - 1;
}

function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}
// end function section

// Multer setup for handling file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/'); // Ensure 'uploads' directory exists
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  },
});
const upload = multer({ storage });

app.get('/', (req, res) => {
  res.send('API is running...');
});

// Register User
app.post('/users/register', authenticateToken, async (req, res) => {
  const { username, password } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await registerUser({ username, hashedPassword });
    res.status(201).json({ message: 'User registered', user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.put('/users/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { username, password } = req.body;

  try {
    let updateFields = [];
    let values = [];
    let index = 1;

    if (username) {
      updateFields.push(`username = $${index++}`);
      values.push(username);
    }
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      updateFields.push(`password = $${index++}`);
      values.push(hashedPassword);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    values.push(id);

    const result = await updateUser(updateFields, index, values);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ message: 'User updated', user: result.rows[0] });
  } catch (err) {
    console.error('Error updating user:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Login User
app.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await login(username);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, username: user.username },
      SECRET_KEY,
      { expiresIn: '1h' }
    );

    // Store token in HttpOnly Cookie
    res.cookie('auth_token', token, {
      httpOnly: true, // Prevents JavaScript access
      secure: false, // Use HTTPS in production
      sameSite: 'Strict', // Protects against CSRF attacks
      maxAge: 60 * 60 * 1000, // 1 hour expiration
    });

    res.json({ message: 'Login successful', user: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/logout', (req, res) => {
  res.clearCookie('auth_token'); // Clear the auth cookie
  res.json({ message: 'Logged out successfully' });
});

app.get('/master_data', authenticateToken, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      table_name,
      start_date,
      end_date,
      inserted_by,
    } = req.query;

    if (!table_name) {
      return res.status(400).json({ error: 'table_name is required' });
    }

    const result = await fetchData(
      table_name,
      page,
      limit,
      start_date,
      end_date,
      inserted_by
    );
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get(
  '/master_column_name/:table_name',
  authenticateToken,
  async (req, res) => {
    try {
      const { table_name } = req.params;
      const result = await masterColumnName(table_name);
      res.json(result.rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
);

app.post(
  '/upload',
  authenticateToken,
  upload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const { table_name, month, year, range } = req.body;
      const { username } = req.user;

      // Get days in month
      const days = getDaysInMonth(year, month);

      // Fetch column mappings from DB
      const selectedColumns = await getDataMappings(table_name);
      if (!selectedColumns || Object.keys(selectedColumns).length === 0) {
        return res
          .status(400)
          .json({ error: 'Invalid table or no mappings found' });
      }

      // Load the Excel file
      const workbook = xlsx.readFile(req.file.path);
      const sheetName = workbook.SheetNames[0]; // First sheet
      const worksheet = workbook.Sheets[sheetName];

      // Convert sheet to JSON (starting from row 7)
      const jsonData = xlsx.utils
        .sheet_to_json(worksheet, { range: range - 1, header: 1 })
        .slice(0, days) // Limit rows based on the month
        .map((row) =>
          Object.fromEntries(
            Object.entries(selectedColumns).map(([headerCell, columnName]) => {
              let value = row[excelColumnToIndex(headerCell)] || null;

              // Check if this column is supposed to be a date
              if (
                columnName.toLowerCase().includes('date') &&
                typeof value === 'number' &&
                value > 40000
              ) {
                value = xlsx.SSF.format('yyyy-mm-dd', value); // Convert serial number to date
              }

              return [columnName, value];
            })
          )
        );

      // Insert data into PostgreSQL
      const result = await insertData(
        username,
        table_name,
        Object.values(selectedColumns),
        jsonData
      );

      res.json({ message: 'File processed successfully', result });
    } catch (err) {
      console.error('Error processing file:', err);
      res.status(500).json({ error: 'Internal Server Error' });
    } finally {
      // Ensure file is deleted
      if (req.file && req.file.path) {
        fs.unlink(req.file.path, (err) => {
          if (err) console.error('Error deleting file:', err);
        });
      }
    }
  }
);

app.post(
  '/upload/csv',
  authenticateToken,
  upload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const { table_name, range_start, range_end } = req.body;
      const { username } = req.user;

      // Fetch column names dynamically from PostgreSQL
      const columns = await getTableColumns(table_name);
      if (!columns.length) {
        return res
          .status(400)
          .json({ error: 'Invalid table name or no columns found' });
      }

      const rows = [];
      let rowIndex = 0;

      // Read CSV and extract data
      fs.createReadStream(req.file.path)
        .pipe(csvParser())
        .on('data', (row) => {
          rowIndex++;
          if (rowIndex >= range_start - 1 && rowIndex <= range_end - 1) {
            const values = Object.values(row).map((v) => (v ? v : null));
            rows.push(values);
          }
        })
        .on('end', async () => {
          try {
            await insertDataCSV(table_name, username, rows, columns);

            res.json({ message: 'File processed successfully' });
          } catch (err) {
            console.error('Database Insert Error:', err);
            res.status(500).json({ error: 'Failed to insert data' });
          } finally {
            fs.unlink(req.file.path, (err) => {
              if (err) console.error('Error deleting file:', err);
            });
          }
        });
    } catch (err) {
      console.error('File Processing Error:', err);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
);

app.post('/data_maping', authenticateToken, async (req, res) => {
  try {
    const { table_name, detail } = req.body;

    if (!table_name || !Array.isArray(detail) || detail.length === 0) {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    await insertDataMappings(table_name, detail);

    res.json({ message: 'Data inserted successfully' });
  } catch (err) {
    console.error('Error inserting data:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/table_headers', authenticateToken, async (req, res) => {
  try {
    const { table_name, headers } = req.body;
    const result = await insertHeaders(table_name, headers);
    res
      .status(201)
      .json({ message: 'Headers saved successfully', id: result.id });
  } catch (err) {
    console.error('Error saving headers:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET: Retrieve nested headers
app.get('/table_headers/:table_name', authenticateToken, async (req, res) => {
  try {
    const { table_name } = req.params;
    const result = await getHeaders(table_name);
    if (!result) {
      return res.status(404).json({ error: 'Headers not found' });
    }

    res.status(200).json(result);
  } catch (err) {
    console.error('Error fetching headers:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/table_name', authenticateToken, async (req, res) => {
  try {
    const result = await getTableNames();
    if (!result) {
      return res.status(404).json({ error: 'Table Names not found' });
    }
    res.status(200).json(result);
  } catch (err) {
    console.error('Error fetching table Names:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/get_users', authenticateToken, async (req, res) => {
  try {
    const result = await getUser();
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () =>
  console.log(`Server running on port ${PORT}`)
);
