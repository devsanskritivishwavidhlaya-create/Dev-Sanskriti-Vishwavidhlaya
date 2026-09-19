import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

const staticOptions = {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
};

app.use(express.static('dist', staticOptions));
app.use(express.static('.', staticOptions));
app.use(express.static('public', staticOptions));

const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'db.json');

function readDB() {
  try {
    return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  } catch {
    return { students: [], courses: [], settings: { lastRollNo: null, lastEnrollSuffix: null, lastDmcNo: null } };
  }
}

function writeDB(data) {
  fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
}

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadsDir),
  filename: (_, file, cb) => cb(null, file.fieldname + '-' + Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname))
});
const upload = multer({ storage });

function parseCSV(text) {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let fields = [], insideQuote = false, currentField = '';
    for (const char of line) {
      if (char === '"') insideQuote = !insideQuote;
      else if (char === ',' && !insideQuote) { fields.push(currentField.trim()); currentField = ''; }
      else currentField += char;
    }
    fields.push(currentField.trim());
    const record = {};
    headers.forEach((h, idx) => { record[h] = (fields[idx] || '').replace(/^"|"$/g, '').trim(); });
    records.push(record);
  }
  return records;
}

function getRandomNonSundayDate(year, monthIndex, termIndex = 0) {
  const candidateDays = [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28];
  const day = candidateDays[(year * 7 + monthIndex * 13 + (termIndex + 1) * 17) % candidateDays.length];
  const d = new Date(year, monthIndex, day);
  if (d.getDay() === 0) {
    d.setDate(d.getDate() + 1);
  }
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function calculateIssueDate(session, termType, termName, termIndex, totalTerms) {
  const years = (session || '').match(/\b(20\d{2})\b/g);
  let startYear = 2024, finalYear = 2026;
  if (years) {
    if (years.length >= 2) { startYear = parseInt(years[0]); finalYear = parseInt(years[years.length - 1]); }
    else if (years.length === 1) { startYear = parseInt(years[0]); finalYear = startYear + 2; }
  }
  const isSemester = termType !== 'year';
  let issueMonthIndex = 7; // August
  let issueYear = finalYear;

  if (isSemester) {
    if (termIndex % 2 === 0) {
      // 1st, 3rd, 5th sem: exam in Dec, marksheet in Feb next year
      const examYear = startYear + Math.floor(termIndex / 2);
      issueMonthIndex = 1; // February
      issueYear = examYear + 1;
    } else {
      // 2nd, 4th, 6th sem: exam in June, marksheet in Aug
      const examYear = startYear + Math.floor(termIndex / 2) + 1;
      issueMonthIndex = 7; // August
      issueYear = examYear;
    }
  } else {
    // Year courses: exam in June, marksheet in Aug
    issueMonthIndex = 7; // August
    issueYear = startYear + termIndex + 1;
  }

  return getRandomNonSundayDate(issueYear, issueMonthIndex, termIndex);
}

function generateRollNumber(db) {
  if (db.settings.lastRollNo) { db.settings.lastRollNo++; return db.settings.lastRollNo; }
  const r = Math.floor(100000 + Math.random() * 900000);
  db.settings.lastRollNo = r;
  return r;
}

function generateEnrollmentNumber(db, sessionYear) {
  const prefix = sessionYear - 1;
  const suffix = db.settings.lastEnrollSuffix ? db.settings.lastEnrollSuffix + 1 : Math.floor(100000 + Math.random() * 900000);
  db.settings.lastEnrollSuffix = suffix;
  return `${prefix}${suffix}`;
}

function generateDmcNumber(db) {
  if (db.settings.lastDmcNo) { db.settings.lastDmcNo++; return db.settings.lastDmcNo; }
  const d = Math.floor(1000 + Math.random() * 9000);
  db.settings.lastDmcNo = d;
  return d;
}

// Get full database
app.get('/api/db', (_, res) => res.json(readDB()));

// Upload CSV courses
app.post('/api/courses/upload', upload.single('csvFile'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const parsed = parseCSV(fs.readFileSync(req.file.path, 'utf8'));
    const coursesMap = {};
    parsed.forEach(row => {
      const name = row['Course'];
      if (!name) return;
      const termName = row['Semester'] || row['Year'] || 'General';
      const termType = row['Semester'] ? 'semester' : (row['Year'] ? 'year' : 'general');
      if (!coursesMap[name]) coursesMap[name] = { name, type: termType, terms: {} };
      if (!coursesMap[name].terms[termName]) coursesMap[name].terms[termName] = [];
      coursesMap[name].terms[termName].push({
        code: row['Course Code'] || '',
        name: row['Subject'] || '',
        maxMarks: parseInt(row['Max Marks']) || 100,
        minMarks: parseInt(row['Min Marks']) || 40
      });
    });
    const db = readDB();
    Object.values(coursesMap).forEach(c => {
      const idx = db.courses.findIndex(x => x.name.toLowerCase() === c.name.toLowerCase());
      if (idx >= 0) db.courses[idx] = c; else db.courses.push(c);
    });
    writeDB(db);
    fs.unlinkSync(req.file.path);
    res.json({ message: 'CSV uploaded successfully', courses: db.courses });
  } catch (err) {
    console.error('CSV upload error:', err);
    res.status(500).json({ error: 'Failed to process CSV' });
  }
});

// Get courses
app.get('/api/courses', (_, res) => res.json(readDB().courses));

// Upload photo
app.post('/api/upload-photo', upload.single('photo'), (req, res) => {
  try {
    if (req.body.image) {
      const base64 = req.body.image.replace(/^data:image\/\w+;base64,/, '');
      const filename = `photo-${Date.now()}-${Math.round(Math.random() * 1E9)}.png`;
      fs.writeFileSync(path.join(uploadsDir, filename), base64, { encoding: 'base64' });
      return res.json({ photoUrl: `/uploads/${filename}` });
    }
    if (req.file) return res.json({ photoUrl: `/uploads/${req.file.filename}` });
    res.status(400).json({ error: 'No image provided' });
  } catch (err) {
    console.error('Photo upload error:', err);
    res.status(500).json({ error: 'Failed to upload photo' });
  }
});

// Register student
app.post('/api/students', (req, res) => {
  try {
    const data = req.body;
    const db = readDB();

    if (data.name && (data.rollNo || data.courseName || data.course)) {
      const courseName = data.course || data.courseName || '';
      const yearMatch = (data.session || '').match(/\b(20\d{2})\b/g);
      const finalYear = yearMatch ? parseInt(yearMatch[yearMatch.length - 1]) : new Date().getFullYear();
      const rollNo = (data.rollNo || generateRollNumber(db)).toString();
      const enrollmentNo = (data.enrollmentNo || generateEnrollmentNumber(db, finalYear)).toString();
      const marksheets = data.marksheets || data.marksheetsData || {};
      const publishedDocs = data.publishedDocs || {
        idCard: true,
        marksheets: {},
        admitCards: {},
        results: {},
        idCards: {}
      };

      const student = {
        id: data.id || `std-${Date.now()}`,
        name: data.name,
        fatherName: data.fatherName || '',
        motherName: data.motherName || '',
        dob: data.dob || '',
        rollNo,
        enrollmentNo,
        course: courseName,
        session: data.session || '',
        email: data.email || '',
        photo: data.photo || '',
        schoolCollege: data.schoolCollege || '',
        centerCode: data.centerCode || 'DSVV-MAIN',
        marksheets,
        publishedDocs,
        isPublished: data.isPublished !== undefined ? data.isPublished : true,
        createdAt: data.createdAt || new Date().toISOString()
      };

      const existingIdx = db.students.findIndex(s => s.id === student.id || (student.rollNo && s.rollNo == student.rollNo));
      if (existingIdx >= 0) {
        db.students[existingIdx] = { ...db.students[existingIdx], ...student };
      } else {
        db.students.unshift(student);
      }
      writeDB(db);
      return res.json({ message: 'Student registered successfully', student });
    }

    return res.status(400).json({ error: 'Missing required fields' });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Failed to register student' });
  }
});

// Edit student
app.put('/api/students/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, fatherName, motherName, dob, photo, marksheetsData, isCompleteEdit, courseName, session } = req.body;
    const db = readDB();
    const idx = db.students.findIndex(s => s.id === id);
    if (idx < 0) return res.status(404).json({ error: 'Student not found' });

    const student = db.students[idx];
    if (name) student.name = name;
    if (fatherName) student.fatherName = fatherName;
    if (motherName) student.motherName = motherName;
    if (dob) student.dob = dob;
    if (photo !== undefined) student.photo = photo;

    if (isCompleteEdit) {
      if (courseName && courseName !== student.course) {
        const course = db.courses.find(c => c.name.toLowerCase() === courseName.toLowerCase());
        if (!course) return res.status(404).json({ error: 'Course not found' });
        student.course = courseName;
        const sessStr = session || student.session;
        const ym = sessStr.match(/\b(20\d{2})\b/g);
        const fy = ym ? parseInt(ym[ym.length - 1]) : new Date().getFullYear();
        const terms = Object.keys(course.terms);
        const newMs = {}, newPd = { idCard: student.publishedDocs?.idCard || false, marksheets: {}, admitCards: {}, results: {} };
        terms.forEach((t, i) => {
          newMs[t] = { dmcNo: generateDmcNumber(db).toString(), issueDate: calculateIssueDate(sessStr, course.type, t, i, terms.length), marks: {}, isPublished: false };
          newPd.marksheets[t] = false; newPd.admitCards[t] = false; newPd.results[t] = false;
        });
        student.marksheets = newMs;
        student.publishedDocs = newPd;
      }
      if (session && session !== student.session) {
        student.session = session;
        const ym = session.match(/\b(20\d{2})\b/g);
        if (ym) {
          const fy = parseInt(ym[ym.length - 1]);
          student.enrollmentNo = `${fy - 1}${student.enrollmentNo.slice(4)}`;
          const course = db.courses.find(c => c.name.toLowerCase() === student.course.toLowerCase());
          if (course) {
            const terms = Object.keys(course.terms);
            terms.forEach((t, i) => {
              if (student.marksheets[t]) student.marksheets[t].issueDate = calculateIssueDate(session, course.type, t, i, terms.length);
            });
          }
        }
      }
    }

    if (marksheetsData) {
      if (!student.marksheets) student.marksheets = {};
      Object.keys(marksheetsData).forEach(t => {
        if (student.marksheets[t]) {
          if (marksheetsData[t].marks !== undefined) student.marksheets[t].marks = marksheetsData[t].marks;
          if (marksheetsData[t].dmcNo !== undefined) student.marksheets[t].dmcNo = marksheetsData[t].dmcNo;
          if (marksheetsData[t].issueDate !== undefined) student.marksheets[t].issueDate = marksheetsData[t].issueDate;
          if (marksheetsData[t].subjects !== undefined) student.marksheets[t].subjects = marksheetsData[t].subjects;
        } else {
          student.marksheets[t] = marksheetsData[t];
        }
      });
    }

    db.students[idx] = student;
    writeDB(db);
    res.json({ message: 'Student updated successfully', student });
  } catch (err) {
    console.error('Edit error:', err);
    res.status(500).json({ error: 'Failed to update student' });
  }
});

// Delete student
app.delete('/api/students/:id', (req, res) => {
  try {
    const db = readDB();
    const idx = db.students.findIndex(s => s.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'Student not found' });
    db.students.splice(idx, 1);
    writeDB(db);
    res.json({ message: 'Student deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete student' });
  }
});

// Publish documents
app.post('/api/students/:id/publish', (req, res) => {
  try {
    const { publishedDocs } = req.body;
    if (!publishedDocs) return res.status(400).json({ error: 'Missing publish config' });
    const db = readDB();
    const idx = db.students.findIndex(s => s.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'Student not found' });

    let any = publishedDocs.idCard || false;
    ['marksheets', 'admitCards', 'results'].forEach(k => {
      if (publishedDocs[k]) Object.values(publishedDocs[k]).forEach(v => { if (v) any = true; });
    });

    db.students[idx].publishedDocs = publishedDocs;
    db.students[idx].isPublished = any;
    Object.keys(db.students[idx].marksheets).forEach(t => {
      db.students[idx].marksheets[t].isPublished = !!(publishedDocs.marksheets?.[t]);
    });
    writeDB(db);
    res.json({ message: 'Publish settings saved', student: db.students[idx] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to publish' });
  }
});

// Public portal search
app.get('/api/public/student', (req, res) => {
  try {
    const { name, searchVal } = req.query;
    if (!name || !searchVal) return res.status(400).json({ error: 'Name and Roll/Enrollment required' });
    const db = readDB();
    const cleanName = String(name).trim().toLowerCase();
    const cleanSearch = String(searchVal).trim().toLowerCase();
    const student = db.students.find(s =>
      s.isPublished &&
      String(s.name || '').trim().toLowerCase() === cleanName &&
      (String(s.rollNo || '').trim().toLowerCase() === cleanSearch || String(s.enrollmentNo || '').trim().toLowerCase() === cleanSearch)
    );
    if (!student) return res.status(404).json({ error: 'No matching published records found.' });
    const course = db.courses.find(c => String(c.name || '').toLowerCase() === String(student.course || '').toLowerCase());
    res.json({ student, course });
  } catch (err) {
    console.error('Public search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Bulk import database (for migration)
app.post('/api/import', (req, res) => {
  try {
    const { students, courses, centers } = req.body;
    const db = readDB();
    if (students && Array.isArray(students)) db.students = students;
    if (courses && Array.isArray(courses)) db.courses = courses;
    if (centers && Array.isArray(centers)) db.centers = centers;
    writeDB(db);
    res.json({ message: 'Database imported successfully', counts: { students: db.students.length, courses: db.courses.length, centers: db.centers.length } });
  } catch (err) {
    console.error('Import error:', err);
    res.status(500).json({ error: 'Failed to import database' });
  }
});

// Global Express Error Handler
app.use((err, req, res, next) => {
  if (err.type === 'request.aborted' || err.code === 'ECONNABORTED' || err.message === 'request aborted') {
    console.warn(`[Client Abort] Request aborted by client: ${req.method} ${req.url}`);
    if (!res.headersSent) {
      return res.status(400).json({ error: 'Request aborted by client' });
    }
    return;
  }
  if (err.type === 'entity.too.large' || err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'Payload or file too large' });
  }
  console.error('Unhandled server error:', err);
  if (!res.headersSent) {
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  }
});

const server = app.listen(PORT, '0.0.0.0', () => console.log(`DSVV Server running on http://localhost:${PORT}`));

server.keepAliveTimeout = 120000;
server.headersTimeout = 125000;
