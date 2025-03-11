const xlsx = require('xlsx');
const fs = require('fs');

// Load the Excel file
const workbook = xlsx.readFile('02. Master Data Februari.xlsx');

// Select the first sheet
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];

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

// Convert the sheet to JSON (starting from row 5, column B)
const jsonData = xlsx.utils
  .sheet_to_json(worksheet, {
    range: 7, // Start from row 7
    header: 1, // Get raw data as an array of arrays
  })
  .slice(0, 31) // Extract rows 7 to 37
  .map((row) =>
    Object.fromEntries(
      selectedColumns.map((col) => [col, row[excelColumnToIndex(col)]])
    )
  );

function excelColumnToIndex(col) {
  let index = 0;
  for (let i = 0; i < col.length; i++) {
    index = index * 26 + (col.charCodeAt(i) - 'A'.charCodeAt(0) + 1);
  }
  return index - 1; // Convert to 0-based index
}

insertData(jsonData)
  .then((res) => {
    console.log('Data inserted successfully:', res);
  })
  .catch((err) => {
    console.error('Error inserting data:', err);
  });

console.log('Data extracted successfully!', jsonData);
