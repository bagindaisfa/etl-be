require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const multer = require('multer');
const xlsx = require('xlsx');
const fs = require('fs');

const {
  registerUser,
  updateUser,
  login,
  fetchData,
  insertData,
  masterColumnName,
  insertMasterColumnNames,
} = require('./db');
const authenticateToken = require('./middleware');

const app = express();
app.use(express.json());

const SECRET_KEY = process.env.SECRET_KEY || 'B@judit0k02018';

// function section
const selectedColumns = [
  'C',
  'D',
  'E',
  'F',
  'K',
  'L',
  'Q',
  'R',
  'T',
  'U',
  'V',
  'W',
  'X',
  'Y',
  'Z',
  'AA',
  'AB',
  'AC',
  'AD',
  'AE',
  'AF',
  'AK',
  'AN',
  'AO',
  'AP',
  'AQ',
  'AR',
  'AS',
  'AT',
  'AU',
  'AV',
  'AW',
  'AX',
  'AY',
  'AZ',
  'BA',
  'BB',
  'BC',
  'BD',
  'BE',
  'BG',
  'BH',
  'BI',
  'BJ',
  'BK',
  'BL',
  'BM',
  'BN',
  'CM',
  'CN',
  'CO',
  'CP',
  'CQ',
  'CR',
  'CS',
  'CT',
  'CU',
  'CV',
  'CW',
  'CX',
  'CY',
  'CZ',
  'DA',
  'DB',
  'DC',
  'DD',
  'DE',
  'DF',
  'DG',
  'DW',
  'DX',
  'DY',
  'DZ',
  'EA',
  'EB',
  'EC',
  'EJ',
  'EK',
  'EN',
  'EO',
  'EP',
  'EQ',
  'ER',
  'ES',
  'ET',
  'EU',
  'EZ',
  'FA',
  'FB',
  'FC',
  'FD',
  'FE',
  'FF',
  'FG',
  'FH',
  'FJ',
  'FO',
  'FQ',
  'FR',
  'FS',
  'FT',
  'FU',
  'FV',
  'GD',
  'GE',
  'GH',
  'GI',
  'GP',
  'GQ',
  'GR',
  'GS',
];

// Helper function to convert column letters to index
function excelColumnToIndex(col) {
  let index = 0;
  for (let i = 0; i < col.length; i++) {
    index = index * 26 + (col.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
  }
  return index - 1; // Convert to 0-based index
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
app.post('/users/register', async (req, res) => {
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

    const token = jwt.sign(
      { id: user.id, username: user.username },
      SECRET_KEY,
      { expiresIn: '1h' }
    );
    res.json({ message: 'Login successful', token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/master_data', authenticateToken, async (req, res) => {
  try {
    const result = await fetchData();
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/master_column_name', authenticateToken, async (req, res) => {
  try {
    const { table_name } = req.body;
    const result = await masterColumnName(table_name);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post(
  '/upload',
  authenticateToken,
  upload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
      const { table_name, month, year } = req.body;
      const { username } = req.user;

      const days = getDaysInMonth(year, month);
      // Load the Excel file
      const workbook = xlsx.readFile(req.file.path);
      const sheetName = workbook.SheetNames[0]; // Select the first sheet
      const worksheet = workbook.Sheets[sheetName];

      // Convert the sheet to JSON (starting from row 7)
      const jsonData = xlsx.utils
        .sheet_to_json(worksheet, { range: 7, header: 1 }) // Read as array
        .slice(0, days) // Extract rows
        .map((row) =>
          Object.fromEntries(
            selectedColumns.map((col) => [
              col,
              row[excelColumnToIndex(col)] || null,
            ])
          )
        );

      // Insert into PostgreSQL
      const result = await insertData(
        username,
        table_name,
        selectedColumns,
        jsonData
      );

      // Delete file after processing
      fs.unlinkSync(req.file.path);

      res.json({ message: 'File processed successfully', result });
    } catch (err) {
      console.error('Error processing file:', err);
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
);

app.post('/master_column_name', authenticateToken, async (req, res) => {
  try {
    const { table_name, detail } = req.body;

    if (!table_name || !Array.isArray(detail) || detail.length === 0) {
      return res.status(400).json({ error: 'Invalid request body' });
    }

    await insertMasterColumnNames(table_name, detail);

    res.json({ message: 'Data inserted successfully' });
  } catch (err) {
    console.error('Error inserting data:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
