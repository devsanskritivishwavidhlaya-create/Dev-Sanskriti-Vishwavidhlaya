import React from 'react';

// Converts term names like "1st Semester" to Roman with suffix "IST SEMESTER", "IIND SEMESTER", etc.
export function formatTermToRoman(termName) {
  if (!termName) return '';
  return String(termName)
    .replace(/\b1st\b/gi, 'IST')
    .replace(/\b2nd\b/gi, 'IIND')
    .replace(/\b3rd\b/gi, 'IIIRD')
    .replace(/\b4th\b/gi, 'IVTH')
    .replace(/\b5th\b/gi, 'VTH')
    .replace(/\b6th\b/gi, 'VITH')
    .replace(/\b7th\b/gi, 'VIITH')
    .replace(/\b8th\b/gi, 'VIIITH')
    .replace(/\b9th\b/gi, 'IXTH')
    .replace(/\b10th\b/gi, 'XTH')
    .toUpperCase();
}

// Generates a random date in the given month/year guaranteeing it is NEVER a Sunday
export function getRandomNonSundayDate(year, monthIndex, termIndex = 0) {
  const candidateDays = [16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28];
  const day = candidateDays[(year * 7 + monthIndex * 13 + (termIndex + 1) * 17) % candidateDays.length];
  const d = new Date(year, monthIndex, day);
  if (d.getDay() === 0) {
    // If Sunday, shift to Monday (+1 day)
    d.setDate(d.getDate() + 1);
  }
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// Calculates Examination Session (e.g. DEC 2023 / JUNE 2024) and Date of Issue
export function calculateSemesterDetails(sessionStr, courseType, termName, termIndex = 0, totalTerms = 1, existingIssueDate = null) {
  const years = (sessionStr || '').match(/\b(20\d{2})\b/g);
  let startYear = 2024;
  let finalYear = 2026;
  if (years && years.length >= 2) {
    startYear = parseInt(years[0]);
    finalYear = parseInt(years[years.length - 1]);
  } else if (years && years.length === 1) {
    startYear = parseInt(years[0]);
    finalYear = startYear + 2;
  }

  const isSemester = courseType !== 'year';
  let examMonth = 'JUNE';
  let examYear = finalYear;
  let issueMonthIndex = 7; // August (0-indexed: 7 is August)
  let issueYear = finalYear;

  if (isSemester) {
    if (termIndex % 2 === 0) {
      // ODD semester: 1st Sem (0), 3rd Sem (2), 5th Sem (4)...
      // Exam in DEC of academic year, Marksheet in FEBRUARY of next year
      examMonth = 'DEC';
      examYear = startYear + Math.floor(termIndex / 2);
      issueMonthIndex = 1; // February
      issueYear = examYear + 1;
    } else {
      // EVEN semester: 2nd Sem (1), 4th Sem (3), 6th Sem (5)...
      // Exam in JUNE of academic year, Marksheet in AUGUST of that year
      examMonth = 'JUNE';
      examYear = startYear + Math.floor(termIndex / 2) + 1;
      issueMonthIndex = 7; // August
      issueYear = examYear;
    }
  } else {
    // YEAR-based courses: 1st Year (0), 2nd Year (1), 3rd Year (2)...
    // Exam in JUNE, Marksheet in AUGUST
    examMonth = 'JUNE';
    examYear = startYear + termIndex + 1;
    issueMonthIndex = 7; // August
    issueYear = examYear;
  }

  const romanTerm = formatTermToRoman(termName);
  const examSessionText = `${romanTerm} EXAMINATION ${examMonth}-${examYear}`;

  let displayIssueDate = '';
  if (existingIssueDate && String(existingIssueDate).trim() !== '') {
    const raw = String(existingIssueDate).trim();
    const parts = raw.split(/[-/]/).map(Number);
    if (parts.length === 3) {
      let dd = parts[0], mm = parts[1], yyyy = parts[2];
      if (parts[0] > 1000) { yyyy = parts[0]; mm = parts[1]; dd = parts[2]; }
      const dObj = new Date(yyyy, mm - 1, dd);
      if (dObj.getDay() === 0) {
        dObj.setDate(dObj.getDate() + 1);
        dd = dObj.getDate();
      }
      displayIssueDate = `${String(dd).padStart(2, '0')}/${String(mm).padStart(2, '0')}/${yyyy}`;
    } else {
      displayIssueDate = getRandomNonSundayDate(issueYear, issueMonthIndex, termIndex);
    }
  } else {
    displayIssueDate = getRandomNonSundayDate(issueYear, issueMonthIndex, termIndex);
  }

  return {
    examMonth,
    examYear,
    issueYear,
    issueMonthIndex,
    examSessionText,
    displayIssueDate,
    romanTerm
  };
}

export default function MarksheetTemplate({ student, course, termName }) {
  if (!student || !course || !termName) return null;

  // Ordered list of course terms (e.g. ["1st Semester", "2nd Semester", ..., "6th Semester"])
  const courseTerms = course?.terms ? Object.keys(course.terms) : (student?.marksheets ? Object.keys(student.marksheets) : [termName]);
  const totalTermsCount = courseTerms.length > 0 ? courseTerms.length : 1;
  const currentTermIndex = Math.max(0, courseTerms.findIndex(t => t.toLowerCase() === termName.toLowerCase()));

  const marksheet = student.marksheets?.[termName] || { dmcNo: '', issueDate: '', marks: {} };
  const subjects = course.terms?.[termName] || [];
  const marks = marksheet.marks || {};

  // Dynamic Exam Session & Issue Date calculation based on term position & final session
  const { examSessionText, displayIssueDate } = calculateSemesterDetails(
    student.session,
    course.type,
    termName,
    currentTermIndex,
    totalTermsCount,
    marksheet.issueDate
  );

  // Subject breakdown and totals calculation
  let totalThMax = 0, totalPrMax = 0, totalAsgMax = 0, totalMax = 0;
  let totalThMin = 0, totalPrMin = 0, totalAsgMin = 0, totalMin = 0;
  let totalThObt = 0, totalPrObt = 0, totalAsgObt = 0, totalObt = 0;
  let hasFailed = false;

  const processedSubjects = subjects.map(sub => {
    const rawObt = marks[sub.code];
    const obtNum = (rawObt !== undefined && rawObt !== '') ? Math.min(100, parseInt(rawObt)) : 0;

    // Fixed standard structure: Theory (60), Practical (30), Assignment (10) -> Total 100
    const thMax = 60;
    const prMax = 30;
    const asgMax = 10;
    const maxM = 100;

    // Minimum passing marks (40% of each component: 24 Th / 12 Pr / 4 Asg -> Total 40)
    const thMin = 24;
    const prMin = 12;
    const asgMin = 4;
    const minM = 40;

    let thObt = 0, prObt = 0, asgObt = 0;
    if (rawObt !== undefined && rawObt !== '') {
      const seed = (sub.code || sub.name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
      const variation = ((seed % 9) - 4) / 200; // slight natural fluctuation ±2%
      thObt = Math.round(obtNum * (0.60 + variation));
      prObt = Math.round(obtNum * (0.30 - variation * 0.7));

      // Clamp to ensure obtained marks never exceed component max marks
      thObt = Math.min(thMax, Math.max(0, thObt));
      prObt = Math.min(prMax, Math.max(0, prObt));
      asgObt = obtNum - thObt - prObt;

      if (asgObt > asgMax) {
        const excess = asgObt - asgMax;
        asgObt = asgMax;
        if (thObt + excess <= thMax) {
          thObt += excess;
        } else {
          prObt = Math.min(prMax, prObt + excess);
        }
      } else if (asgObt < 0) {
        const deficit = -asgObt;
        asgObt = 0;
        if (thObt - deficit >= 0) {
          thObt -= deficit;
        } else {
          prObt = Math.max(0, prObt - deficit);
        }
      }
    }

    if (obtNum < minM) hasFailed = true;

    totalThMax += thMax; totalPrMax += prMax; totalAsgMax += asgMax; totalMax += maxM;
    totalThMin += thMin; totalPrMin += prMin; totalAsgMin += asgMin; totalMin += minM;
    totalThObt += thObt; totalPrObt += prObt; totalAsgObt += asgObt; totalObt += obtNum;

    return {
      code: sub.code,
      name: sub.name,
      thMax, prMax, asgMax, maxM,
      thMin, prMin, asgMin, minM,
      thObt, prObt, asgObt, obtNum
    };
  });

  // Calculate percentage and division for current term
  const percentage = totalMax > 0 ? ((totalObt / totalMax) * 100) : 0;
  let termResult = 'Pass';
  let termDivision = 'FIRST';
  if (hasFailed || percentage < 33) {
    termResult = 'Fail';
    termDivision = 'FAIL';
  } else if (percentage >= 60) {
    termDivision = 'FIRST';
  } else if (percentage >= 45) {
    termDivision = 'SECOND';
  } else {
    termDivision = 'THIRD';
  }

  // Multi-term summaries across all semesters (1st to 6th/8th)
  // Progressive SGPA (per semester) and CGPA (cumulative up to each semester)
  let grandTotalObt = 0;
  let grandTotalMax = 0;
  let runningCumObt = 0;
  let runningCumMax = 0;

  const termSummaries = courseTerms.map((tName, idx) => {
    const tSubjects = course.terms?.[tName] || [];
    const tMarks = student.marksheets?.[tName]?.marks || {};
    let tMax = 0, tObt = 0;

    tSubjects.forEach(s => {
      tMax += parseInt(s.maxMarks) || 100;
      if (tMarks[s.code] !== undefined && tMarks[s.code] !== '') {
        tObt += parseInt(tMarks[s.code]) || 0;
      }
    });

    const isCurrentOrPast = idx <= currentTermIndex;
    if (isCurrentOrPast) {
      grandTotalObt += tObt;
      grandTotalMax += tMax;
      runningCumObt += tObt;
      runningCumMax += tMax;
    }

    const sgpaVal = isCurrentOrPast && tMax > 0 ? ((tObt / tMax) * 10).toFixed(2) : '***';
    const cgpaVal = isCurrentOrPast && runningCumMax > 0 ? ((runningCumObt / runningCumMax) * 10).toFixed(2) : '***';

    return {
      term: tName,
      romanTerm: formatTermToRoman(tName),
      total: isCurrentOrPast ? tObt : '***',
      max: isCurrentOrPast ? tMax : '***',
      sgpa: sgpaVal,
      cgpa: cgpaVal,
      isCurrentOrPast
    };
  });

  // Fallback if current term total is greater
  if (grandTotalObt === 0 && totalObt > 0) {
    grandTotalObt = totalObt;
    grandTotalMax = totalMax;
  }

  // Calculate percentage, current semester SGPA, and progressive CGPA
  const grandPercentage = grandTotalMax > 0 ? ((grandTotalObt / grandTotalMax) * 100) : 0;
  const currentSGPA = totalMax > 0 ? ((totalObt / totalMax) * 10).toFixed(2) : '0.00';
  const currentCGPA = grandTotalMax > 0 ? ((grandTotalObt / grandTotalMax) * 10).toFixed(2) : currentSGPA;

  let result = 'Pass';
  let division = 'FIRST';
  if (hasFailed || grandPercentage < 33) {
    result = 'Fail';
    division = 'FAIL';
  } else if (grandPercentage >= 60) {
    division = 'FIRST';
  } else if (grandPercentage >= 45) {
    division = 'SECOND';
  } else {
    division = 'THIRD';
  }

  // Determine number of columns for bottom grid (e.g. 3 cols for 6 terms, 4 cols for 8 terms, 2 cols for 4 terms)
  const gridCols = totalTermsCount > 6 ? 4 : (totalTermsCount > 3 ? 3 : (totalTermsCount === 1 ? 1 : 2));
  const isYearCourse = course?.type === 'year';

  return (
    <div className="marksheet-a4-landscape-wrapper">
      <div className="marksheet-a4-landscape">
        {/* High-Res Background Image from sample.jpg */}
        <img 
          src="sample.jpg?v=20260915" 
          alt="Marksheet Background" 
          className="marksheet-bg-img"
        />

        {/* Content Overlay */}
        <div className="marksheet-content-overlay">
          
          {/* Top Spacing to align below pre-printed University Title & Statement of Marks */}
          <div className="ms-header-spacer"></div>

          {/* Sr. No. (DMC Number) Top Right */}
          <div className="ms-sr-no">
            Sr. No. : {marksheet.dmcNo ? `G${marksheet.dmcNo}` : `G${student.rollNo}`}
          </div>

          {/* Course Name Header */}
          <div className="ms-course-header">
            {student.course}
          </div>

          {/* Examination Session Title (e.g. IST SEMESTER EXAMINATION DEC-2023) */}
          <div className="ms-exam-session">
            {examSessionText}
          </div>

          {/* Student Profile Info Grid (2 Columns: Left 62%, Right 38%) */}
          <div className="ms-student-profile-grid">
            <div className="ms-profile-left">
              <div className="ms-profile-row">
                <span className="ms-lbl">Name</span>
                <span className="ms-colon">:</span>
                <span className="ms-val">{student.name}</span>
              </div>
              <div className="ms-profile-row">
                <span className="ms-lbl">F/H Name</span>
                <span className="ms-colon">:</span>
                <span className="ms-val">{student.fatherName}</span>
              </div>
              <div className="ms-profile-row">
                <span className="ms-lbl">M's Name</span>
                <span className="ms-colon">:</span>
                <span className="ms-val">{student.motherName}</span>
              </div>
            </div>

            <div className="ms-profile-right">
              <div className="ms-profile-row">
                <span className="ms-lbl-r">Roll. No.</span>
                <span className="ms-colon">:</span>
                <span className="ms-val">{student.rollNo}</span>
              </div>
              <div className="ms-profile-row">
                <span className="ms-lbl-r">Enroll No.</span>
                <span className="ms-colon">:</span>
                <span className="ms-val">{student.enrollmentNo}</span>
              </div>
              {student.schoolCollege && (
                <div className="ms-profile-row">
                  <span className="ms-lbl-r">School/College</span>
                  <span className="ms-colon">:</span>
                  <span className="ms-val">{student.schoolCollege}</span>
                </div>
              )}
            </div>
          </div>

          {/* Main Marks Table (55% Subject, 45% Numerical Marks) */}
          <div className="ms-table-container">
            <table className="ms-main-table">
              <colgroup>
                <col style={{ width: '55%' }} />
                <col style={{ width: '4.33%' }} />
                <col style={{ width: '4.33%' }} />
                <col style={{ width: '4.33%' }} />
                <col style={{ width: '4.33%' }} />
                <col style={{ width: '4.33%' }} />
                <col style={{ width: '4.33%' }} />
                <col style={{ width: '3.83%' }} />
                <col style={{ width: '3.83%' }} />
                <col style={{ width: '3.83%' }} />
                <col style={{ width: '7.5%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th rowSpan={2} className="th-subject">Subject</th>
                  <th colSpan={3} className="th-group">Maximum Marks</th>
                  <th colSpan={3} className="th-group">Minimum Marks</th>
                  <th colSpan={3} className="th-group">Marks Obtained</th>
                  <th rowSpan={2} className="th-total">Total</th>
                </tr>
                <tr className="th-sub-row">
                  <th>Th</th><th>Pr</th><th>Asg</th>
                  <th>Th</th><th>Pr</th><th>Asg</th>
                  <th>Th</th><th>Pr</th><th>Asg</th>
                </tr>
              </thead>
              <tbody>
                {processedSubjects.map((sub, idx) => (
                  <tr key={sub.code || idx}>
                    <td className="td-subject-name">{sub.name}</td>
                    <td className="td-num">{sub.thMax}</td>
                    <td className="td-num">{sub.prMax}</td>
                    <td className="td-num">{sub.asgMax}</td>
                    <td className="td-num">{sub.thMin}</td>
                    <td className="td-num">{sub.prMin}</td>
                    <td className="td-num">{sub.asgMin}</td>
                    <td className="td-num">{sub.thObt}</td>
                    <td className="td-num">{sub.prObt}</td>
                    <td className="td-num">{sub.asgObt}</td>
                    <td className="td-num td-row-total">{sub.obtNum}</td>
                  </tr>
                ))}

                {/* Total Row */}
                <tr className="tr-total-row">
                  <td className="td-total-lbl">Total</td>
                  <td className="td-num">{totalThMax}</td>
                  <td className="td-num">{totalPrMax}</td>
                  <td className="td-num">{totalAsgMax}</td>
                  <td className="td-num">{totalThMin}</td>
                  <td className="td-num">{totalPrMin}</td>
                  <td className="td-num">{totalAsgMin}</td>
                  <td className="td-num">{totalThObt}</td>
                  <td className="td-num">{totalPrObt}</td>
                  <td className="td-num">{totalAsgObt}</td>
                  <td className="td-num td-grand-total">{totalObt}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Bottom section: wraps summary + footer so they anchor together at bottom */}
          <div className="ms-bottom-section">
            {/* Bottom Summary Section (Multi-Semester Marks Summary & Grand Total / Division) */}
            <div className="ms-bottom-summary-grid">
              
              {/* Multi-Term Summary Table across all semesters/years */}
              <div className="ms-multi-term-container">
                <div className="ms-marks-vertical-tag">
                  <span>M</span><span>A</span><span>R</span><span>K</span><span>S</span>
                </div>
                <div 
                  className="ms-terms-grid-table"
                  style={{
                    gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
                    gridTemplateRows: totalTermsCount > (gridCols === 1 ? 1 : (gridCols === 2 ? 2 : 2)) ? 'repeat(2, 1fr)' : 'repeat(2, 1fr)'
                  }}
                >
                  {termSummaries.map((ts, idx) => {
                    const isLastCol = (idx + 1) % gridCols === 0 || idx === totalTermsCount - 1;
                    const isBottomRow = totalTermsCount > gridCols ? idx >= gridCols : false;

                    return (
                      <div 
                        key={ts.term || idx} 
                        className="ms-term-cell"
                        style={{
                          borderRight: isLastCol ? 'none' : '1.5px solid #000',
                          borderBottom: isBottomRow ? 'none' : '1.5px solid #000'
                        }}
                      >
                        <div className="ms-term-hdr">{ts.romanTerm || ts.term}</div>
                        <div className="ms-term-body">
                          {isYearCourse ? (
                            <div className="ms-term-subgrid-year">
                              <div className="ms-subcol">
                                <span className="ms-subhdr">Total</span>
                                <span className="ms-subval">{ts.total}</span>
                              </div>
                              <div className="ms-subcol">
                                <span className="ms-subhdr">Out of</span>
                                <span className="ms-subval">{ts.max}</span>
                              </div>
                            </div>
                          ) : (
                            <div className="ms-term-subgrid-sem">
                              <div className="ms-sem-row">
                                <div className="ms-sem-item">
                                  <span className="ms-sem-k">Total:</span>
                                  <span className="ms-sem-v">{ts.total}</span>
                                </div>
                                <div className="ms-sem-item">
                                  <span className="ms-sem-k">Out of:</span>
                                  <span className="ms-sem-v">{ts.max}</span>
                                </div>
                              </div>
                              <div className="ms-sem-row">
                                <div className="ms-sem-item">
                                  <span className="ms-sem-k">SGPA:</span>
                                  <span className="ms-sem-v">{ts.sgpa}</span>
                                </div>
                                <div className="ms-sem-item">
                                  <span className="ms-sem-k">CGPA:</span>
                                  <span className="ms-sem-v">{ts.cgpa}</span>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Grand Total, SGPA, CGPA, Result & Division Box */}
              <div className="ms-grand-summary-box">
                {isYearCourse ? (
                  <table className="ms-grand-table">
                    <thead>
                      <tr>
                        <th colSpan={2}>GRAND TOTAL</th>
                        <th rowSpan={2} style={{ verticalAlign: 'middle', width: '25%' }}>RESULT</th>
                        <th rowSpan={2} style={{ verticalAlign: 'middle', width: '25%' }}>DIVISION</th>
                      </tr>
                      <tr className="ms-grand-subhdr-row">
                        <th style={{ width: '25%' }}>Total</th>
                        <th style={{ width: '25%' }}>Out of</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="ms-grand-metric-val">{grandTotalObt}</td>
                        <td className="ms-grand-metric-val">{grandTotalMax}</td>
                        <td className="ms-grand-metric-val" style={{ color: result === 'Pass' ? '#000' : '#dc2626' }}>
                          {result}
                        </td>
                        <td className="ms-grand-metric-val">
                          {division}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                ) : (
                  <table className="ms-grand-table">
                    <thead>
                      <tr>
                        <th style={{ width: '30%' }}>GRAND TOTAL</th>
                        <th style={{ width: '16%' }}>SGPA</th>
                        <th style={{ width: '16%' }}>CGPA</th>
                        <th style={{ width: '18%' }}>RESULT</th>
                        <th style={{ width: '20%' }}>DIVISION</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>
                          <div className="ms-grand-sublbl">Total / Out of</div>
                          <div className="ms-grand-subval">
                            {grandTotalObt} / {grandTotalMax}
                          </div>
                        </td>
                        <td className="ms-grand-metric-val">
                          {currentSGPA}
                        </td>
                        <td className="ms-grand-metric-val">
                          {currentCGPA}
                        </td>
                        <td className="ms-grand-metric-val" style={{ color: result === 'Pass' ? '#000' : '#dc2626' }}>
                          {result}
                        </td>
                        <td className="ms-grand-metric-val">
                          {division}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                )}
              </div>

            </div>

            {/* Footer Legends, Centered Official Seal & Registrar Signature */}
            <div className="ms-footer-bar">
              <div className="ms-legend-left">
                <div>C = CARRY FORWARD</div>
                <div>* = FAIL IN SUBJECT</div>
                <div>G = PASS BY GRACE</div>
                <div>ABS = ABSENT</div>
                <div className="ms-issue-date">
                  Date of Issue <strong>{displayIssueDate}</strong>
                </div>
              </div>

              {/* University Seal Image positioned bottom center */}
              <div className="ms-seal-center">
                <img src="Seal.png" alt="University Seal" className="ms-seal-img" />
                <span className="ms-seal-text">Seal</span>
              </div>

              <div className="ms-signature-right">
                <img src="Signature.png" alt="Signature" className="ms-sig-img" />
                <div className="ms-sig-lbl">Registrar</div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
