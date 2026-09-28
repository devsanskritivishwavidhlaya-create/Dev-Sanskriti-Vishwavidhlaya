const API_BASE = import.meta.env.VITE_API_URL || '';

async function request(url, options = {}) {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  getDb: () => request('/api/db'),
  
  createStudent: (data) => request('/api/students', { method: 'POST', body: JSON.stringify(data) }),
  
  updateStudent: (id, data) => request(`/api/students/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  
  deleteStudent: (id) => request(`/api/students/${id}`, { method: 'DELETE' }),
  
  publishStudent: (id, publishedDocs) => request(`/api/students/${id}/publish`, { method: 'POST', body: JSON.stringify({ publishedDocs }) }),
  
  uploadCsv: async (file) => {
    const formData = new FormData();
    formData.append('csvFile', file);
    const res = await fetch(`${API_BASE}/api/courses/upload`, { method: 'POST', body: formData });
    if (!res.ok) throw new Error('CSV upload failed');
    return res.json();
  },

  uploadPhoto: async (base64) => {
    const res = await fetch(`${API_BASE}/api/upload-photo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64 }),
    });
    if (!res.ok) throw new Error('Photo upload failed');
    return res.json();
  },

  searchPublic: (name, searchVal) => request(`/api/public/student?name=${encodeURIComponent(name)}&searchVal=${encodeURIComponent(searchVal)}`),

  importData: (data) => request('/api/import', { method: 'POST', body: JSON.stringify(data) }),
};
