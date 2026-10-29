import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables from .env if present
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split(/\r?\n/).forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = (match[2] || '').trim().replace(/^['"]|['"]$/g, '');
    }
  });
}

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'dsvv_jwt_secret_secure_key_2026_default_replace';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'DEV SANSKRITI VISHWAVIDYALAYA';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || '$2b$10$2WPuyERzYaovzSXvBAkwq.Pvz65W8hhNgyqSLscdGqPTnSpIUAtoq';

// Security Headers
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// CORS Configuration - Restrict to university domains and trusted origins
const allowedOrigins = [
  'https://www.devsanskritivishwavidyalaya.com',
  'https://devsanskritivishwavidyalaya.com',
  'https://www.dsvv.ac.in',
  'https://dsvv.ac.in',
  'http://localhost:5000',
  'http://localhost:5001',
  'http://localhost:5173',
  'http://127.0.0.1:5000',
  'http://127.0.0.1:5001',
  'http://127.0.0.1:5173'
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.trycloudflare.com') || origin.endsWith('.vercel.app')) {
      return callback(null, true);
    }
    return callback(new Error('Blocked by CORS policy'));
  },
  credentials: true
}));

// Body Parsers with limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Rate Limiters
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { error: 'Too many requests from this IP, please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', generalLimiter);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { error: 'Too many login attempts. Please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const publicSearchLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  message: { error: 'Too many search requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many upload attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const staticOptions = {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
};

// Static file serving - ONLY built dist and public assets, NEVER current directory '.'
app.use(express.static('dist', staticOptions));
app.use(express.static('public', staticOptions));

const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'db.json');

function normalizeText(val) {
  return String(val ?? '').trim().replace(/\s+/g, ' ');
}

function sanitizeStudentRecord(s) {
  if (!s || typeof s !== 'object') return s;
  return {
    ...s,
    name: normalizeText(s.name).toUpperCase(),
    fatherName: normalizeText(s.fatherName).toUpperCase(),
    motherName: normalizeText(s.motherName).toUpperCase(),
    rollNo: normalizeText(s.rollNo),
    enrollmentNo: normalizeText(s.enrollmentNo),
    session: normalizeText(s.session).toUpperCase()
  };
}

function readDB() {
  try {
    const raw = fs.readFileSync(dbPath, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(raw);
  } catch {
    return { students: [], courses: [], centers: [], settings: { lastRollNo: null, lastEnrollSuffix: null, lastDmcNo: null } };
  }
}

// Atomic file write to avoid race condition corruption
function writeDB(data) {
  if (data && Array.isArray(data.students)) {
    data.students = data.students.map(sanitizeStudentRecord);
  }
  const tempPath = `${dbPath}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempPath, dbPath);
}

// Remove sensitive credentials before serving db to client
function sanitizeDbForClient(db) {
  return {
    ...db,
    centers: (db.centers || []).map(c => {
      const { password, passwordHash, ...safeCenter } = c;
      return safeCenter;
    })
  };
}

// File Upload with Strict Whitelist & MIME Validation
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED_EXT = ['.jpg', '.jpeg', '.png', '.webp'];

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadsDir),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, 'photo-' + Date.now() + '-' + Math.round(Math.random() * 1E9) + ext);
  }
});

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXT.includes(ext) || !ALLOWED_MIME.includes(file.mimetype)) {
    return cb(new Error('Invalid file type. Only JPEG, PNG, and WebP images are permitted.'));
  }
  cb(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

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
      const examYear = startYear + Math.floor(termIndex / 2);
      issueMonthIndex = 1; // February
      issueYear = examYear + 1;
    } else {
      const examYear = startYear + Math.floor(termIndex / 2) + 1;
      issueMonthIndex = 7; // August
      issueYear = examYear;
    }
  } else {
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

// ============================================================
// AUTHENTICATION & ACCESS CONTROL MIDDLEWARE
// ============================================================

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired session. Please log in again.' });
    req.user = user;
    next();
  });
}

function requireAdmin(req, res, next) {
  authenticateToken(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied: Administrator privileges required.' });
    }
    next();
  });
}

function requireCenterOrAdmin(req, res, next) {
  authenticateToken(req, res, () => {
    if (req.user.role !== 'admin' && req.user.role !== 'center') {
      return res.status(403).json({ error: 'Access denied: Valid account required.' });
    }
    next();
  });
}

// ============================================================
// API ROUTES
// ============================================================

// Authentication Login Endpoint
app.post('/api/auth/login', authLimiter, (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required.' });
    }
    const u = String(username).trim();
    const p = String(password).trim();

    // 1. Verify Admin
    if (role === 'admin' || u.toUpperCase() === ADMIN_USERNAME.toUpperCase()) {
      const match = (u.toUpperCase() === ADMIN_USERNAME.toUpperCase()) && bcrypt.compareSync(p, ADMIN_PASSWORD_HASH);
      if (match) {
        const token = jwt.sign({ role: 'admin', username: u }, JWT_SECRET, { expiresIn: '12h' });
        return res.json({ token, role: 'admin', user: { name: 'Administrator' } });
      }
      return res.status(401).json({ error: 'Invalid Administrator Username or Password.' });
    }

    // 2. Verify Center
    const db = readDB();
    const q = u.toUpperCase();
    const center = (db.centers || []).find(c =>
      (c.centerCode && c.centerCode.toUpperCase() === q) || (c.email && c.email.toUpperCase() === q)
    );

    if (!center) {
      return res.status(401).json({ error: 'Invalid Center ID / Email or Password.' });
    }

    const match = center.passwordHash
      ? bcrypt.compareSync(p, center.passwordHash)
      : (center.password === p);

    if (!match) {
      return res.status(401).json({ error: 'Invalid Center ID / Email or Password.' });
    }

    if (center.status === 'pending') {
      return res.status(403).json({ error: 'Your Center account is currently pending approval by the University Administrator.' });
    }

    if (center.status === 'rejected') {
      return res.status(403).json({ error: 'Your Center registration was rejected by the University Administrator.' });
    }

    const token = jwt.sign({ role: 'center', centerId: center.id, centerCode: center.centerCode }, JWT_SECRET, { expiresIn: '12h' });
    const { password: _, passwordHash: __, ...safeCenter } = center;
    return res.json({ token, role: 'center', center: safeCenter });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Authentication failed.' });
  }
});

// Get Database (Protected: Admin or Center)
app.get('/api/db', requireCenterOrAdmin, (req, res) => {
  const db = readDB();
  res.json(sanitizeDbForClient(db));
});

// Upload CSV Courses (Protected: Admin)
app.post('/api/courses/upload', requireAdmin, upload.single('csvFile'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const parsed = parseCSV(fs.readFileSync(req.file.path, 'utf8'));
    const coursesMap = {};
    parsed.forEach(row => {
      const name = (row['Course'] || '').toUpperCase();
      if (!name) return;
      const termName = row['Semester'] || row['Year'] || 'General';
      const termType = row['Semester'] ? 'semester' : (row['Year'] ? 'year' : 'general');
      if (!coursesMap[name]) coursesMap[name] = { name, type: termType, terms: {} };
      if (!coursesMap[name].terms[termName]) coursesMap[name].terms[termName] = [];
      coursesMap[name].terms[termName].push({
        code: (row['Course Code'] || '').toUpperCase(),
        name: (row['Subject'] || '').toUpperCase(),
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

// Get Public Courses (Public syllabus information)
app.get('/api/courses', (_, res) => res.json(readDB().courses || []));

// Upload Student Photo (Protected: Admin or Center, with rate limit & type check)
app.post('/api/upload-photo', requireCenterOrAdmin, uploadLimiter, upload.single('photo'), (req, res) => {
  try {
    if (req.body.image) {
      const match = req.body.image.match(/^data:image\/(jpeg|png|webp);base64,/i);
      if (!match) {
        return res.status(400).json({ error: 'Invalid image format. Only JPEG, PNG, and WebP are allowed.' });
      }
      const base64 = req.body.image.replace(/^data:image\/\w+;base64,/, '');
      const ext = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
      const filename = `photo-${Date.now()}-${Math.round(Math.random() * 1E9)}.${ext}`;
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

// Register Student (Protected: Admin or Center)
app.post('/api/students', requireCenterOrAdmin, (req, res) => {
  try {
    const data = req.body;
    const db = readDB();

    if (data.name && (data.rollNo || data.courseName || data.course)) {
      const courseName = normalizeText(data.course || data.courseName || '');
      const yearMatch = (data.session || '').match(/\b(20\d{2})\b/g);
      const finalYear = yearMatch ? parseInt(yearMatch[yearMatch.length - 1]) : new Date().getFullYear();
      const rollNo = normalizeText(data.rollNo || generateRollNumber(db));
      const enrollmentNo = normalizeText(data.enrollmentNo || generateEnrollmentNumber(db, finalYear));
      const marksheets = data.marksheets || data.marksheetsData || {};
      const defaultPublishedDocs = {
        idCard: true,
        marksheets: {},
        admitCards: {},
        results: {},
        idCards: {}
      };
      Object.keys(marksheets).forEach(t => {
        defaultPublishedDocs.marksheets[t] = true;
        defaultPublishedDocs.admitCards[t] = true;
        defaultPublishedDocs.results[t] = true;
        defaultPublishedDocs.idCards[t] = true;
      });
      const publishedDocs = data.publishedDocs || defaultPublishedDocs;

      const student = sanitizeStudentRecord({
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
        centerCode: req.user.role === 'center' ? req.user.centerCode : (data.centerCode || 'DSVV-MAIN'),
        marksheets,
        publishedDocs,
        isPublished: data.isPublished !== undefined ? data.isPublished : true,
        createdAt: data.createdAt || new Date().toISOString()
      });

      const existingIdx = db.students.findIndex(s => s.id === student.id || (student.rollNo && String(s.rollNo).trim() === student.rollNo));
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

// Edit Student (Protected: Admin or Center)
app.put('/api/students/:id', requireCenterOrAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const {
      name, fatherName, motherName, dob, photo,
      rollNo, enrollmentNo, email, schoolCollege, centerCode,
      marksheetsData, publishedDocs, isPublished, isCompleteEdit, courseName, course, session
    } = req.body;
    const db = readDB();
    const idx = db.students.findIndex(s => s.id === id);
    if (idx < 0) return res.status(404).json({ error: 'Student not found' });

    const student = db.students[idx];

    // If center, ensure they only edit their own students
    if (req.user.role === 'center' && student.centerCode !== req.user.centerCode) {
      return res.status(403).json({ error: 'Access denied: You can only edit candidates of your own center.' });
    }

    if (name !== undefined) student.name = normalizeText(name).toUpperCase();
    if (fatherName !== undefined) student.fatherName = normalizeText(fatherName).toUpperCase();
    if (motherName !== undefined) student.motherName = normalizeText(motherName).toUpperCase();
    if (dob !== undefined) student.dob = dob;
    if (photo !== undefined) student.photo = photo;
    if (rollNo !== undefined) student.rollNo = normalizeText(rollNo);
    if (enrollmentNo !== undefined) student.enrollmentNo = normalizeText(enrollmentNo);
    if (email !== undefined) student.email = String(email || '').trim();
    if (schoolCollege !== undefined) student.schoolCollege = String(schoolCollege || '').trim();
    if (centerCode !== undefined && req.user.role === 'admin') student.centerCode = String(centerCode || '').trim();
    if (courseName || course) student.course = normalizeText(courseName || course);
    if (session !== undefined) student.session = normalizeText(session).toUpperCase();
    if (publishedDocs !== undefined) student.publishedDocs = publishedDocs;
    if (isPublished !== undefined) student.isPublished = isPublished;

    if (isCompleteEdit) {
      const targetCourseName = courseName || course;
      if (targetCourseName && targetCourseName !== student.course) {
        const courseObj = db.courses.find(c => c.name.toLowerCase() === targetCourseName.toLowerCase());
        if (courseObj) {
          student.course = targetCourseName;
          const sessStr = session || student.session;
          const terms = Object.keys(courseObj.terms);
          const newMs = {}, newPd = { idCard: student.publishedDocs?.idCard ?? true, marksheets: {}, admitCards: {}, results: {}, idCards: {} };
          terms.forEach((t, i) => {
            newMs[t] = { dmcNo: generateDmcNumber(db).toString(), issueDate: calculateIssueDate(sessStr, courseObj.type, t, i, terms.length), marks: {}, isPublished: true };
            newPd.marksheets[t] = true; newPd.admitCards[t] = true; newPd.results[t] = true; newPd.idCards[t] = true;
          });
          student.marksheets = newMs;
          if (!publishedDocs) student.publishedDocs = newPd;
        }
      }
    }

    if (marksheetsData) {
      if (!student.marksheets) student.marksheets = {};
      Object.keys(marksheetsData).forEach(t => {
        const msData = marksheetsData[t] || {};
        const sanitizedSubs = Array.isArray(msData.subjects) ? msData.subjects.map(s => ({
          ...s,
          code: (s.code || '').toUpperCase(),
          name: (s.name || '').toUpperCase(),
          minMarks: parseInt(s.minMarks) || 40,
          maxMarks: parseInt(s.maxMarks) || 100
        })) : undefined;

        if (student.marksheets[t]) {
          if (msData.marks !== undefined) student.marksheets[t].marks = msData.marks;
          if (msData.dmcNo !== undefined) student.marksheets[t].dmcNo = msData.dmcNo;
          if (msData.issueDate !== undefined) student.marksheets[t].issueDate = msData.issueDate;
          if (sanitizedSubs !== undefined) student.marksheets[t].subjects = sanitizedSubs;
        } else {
          student.marksheets[t] = {
            ...msData,
            ...(sanitizedSubs !== undefined ? { subjects: sanitizedSubs } : {})
          };
        }
      });
    }

    db.students[idx] = sanitizeStudentRecord(student);
    writeDB(db);
    res.json({ message: 'Student updated successfully', student: db.students[idx] });
  } catch (err) {
    console.error('Edit error:', err);
    res.status(500).json({ error: 'Failed to update student' });
  }
});

// Delete Student (Protected: Admin)
app.delete('/api/students/:id', requireAdmin, (req, res) => {
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

// Publish Documents (Protected: Admin)
app.post('/api/students/:id/publish', requireAdmin, (req, res) => {
  try {
    const { publishedDocs } = req.body;
    if (!publishedDocs) return res.status(400).json({ error: 'Missing publish config' });
    const db = readDB();
    const idx = db.students.findIndex(s => s.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'Student not found' });

    let any = publishedDocs.idCard || false;
    ['marksheets', 'admitCards', 'results', 'idCards'].forEach(k => {
      if (publishedDocs[k]) Object.values(publishedDocs[k]).forEach(v => { if (v) any = true; });
    });

    db.students[idx].publishedDocs = publishedDocs;
    db.students[idx].isPublished = any;
    Object.keys(db.students[idx].marksheets || {}).forEach(t => {
      db.students[idx].marksheets[t].isPublished = !!(publishedDocs.marksheets?.[t]);
    });
    writeDB(db);
    res.json({ message: 'Publish settings saved', student: db.students[idx] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to publish' });
  }
});

// Public Portal Search (Public, Rate Limited)
app.get('/api/public/student', publicSearchLimiter, (req, res) => {
  try {
    const { name, searchVal } = req.query;
    if (!name && !searchVal) return res.status(400).json({ error: 'Name and Roll/Enrollment required' });
    const db = readDB();
    const cleanName = normalizeText(name).toLowerCase();
    const cleanSearch = normalizeText(searchVal).replace(/\s+/g, '').toLowerCase();
    const student = db.students.find(s => {
      if (!s.isPublished) return false;
      const sName = normalizeText(s.name).toLowerCase();
      const sRoll = normalizeText(s.rollNo).replace(/\s+/g, '').toLowerCase();
      const sEnroll = normalizeText(s.enrollmentNo).replace(/\s+/g, '').toLowerCase();
      const nameMatch = cleanName ? sName === cleanName : true;
      const valMatch = cleanSearch ? (sRoll === cleanSearch || sEnroll === cleanSearch) : true;
      return nameMatch && valMatch;
    });
    if (!student) return res.status(404).json({ error: 'No matching published records found.' });
    const course = db.courses.find(c => normalizeText(c.name).toLowerCase() === normalizeText(student.course).toLowerCase());
    res.json({ student, course });
  } catch (err) {
    console.error('Public search error:', err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Bulk Import Database / Sync (Protected: Admin or Center)
app.post('/api/import', requireCenterOrAdmin, (req, res) => {
  try {
    const { students, courses, centers } = req.body;
    const db = readDB();

    if (req.user.role === 'admin') {
      if (students && Array.isArray(students)) db.students = students.map(sanitizeStudentRecord);
      if (courses && Array.isArray(courses)) db.courses = courses;
      if (centers && Array.isArray(centers)) {
        db.centers = centers.map(c => {
          if (c.password) {
            c.passwordHash = bcrypt.hashSync(c.password, 10);
            delete c.password;
          }
          return c;
        });
      }
    } else if (req.user.role === 'center') {
      // Center can only sync / update their own students or center details
      if (students && Array.isArray(students)) {
        students.forEach(st => {
          if (st.centerCode === req.user.centerCode) {
            const idx = db.students.findIndex(s => s.id === st.id);
            if (idx >= 0) db.students[idx] = sanitizeStudentRecord(st);
            else db.students.unshift(sanitizeStudentRecord(st));
          }
        });
      }
    }

    writeDB(db);
    res.json({
      message: 'Database imported successfully',
      counts: {
        students: db.students.length,
        courses: db.courses.length,
        centers: (db.centers || []).length
      }
    });
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

const server = app.listen(PORT, '0.0.0.0', () => console.log(`DSVV Server running securely on http://localhost:${PORT}`));

server.keepAliveTimeout = 120000;
server.headersTimeout = 125000;
