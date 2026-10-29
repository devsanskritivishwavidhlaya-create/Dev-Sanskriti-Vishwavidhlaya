const API_BASE = import.meta.env.VITE_API_URL || '';

async function request(url, options = {}) {
  const token = typeof window !== 'undefined' ? sessionStorage.getItem('dsvv_auth_token') : null;
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...options.headers,
  };
  const res = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  login: (username, password, role) => request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password, role }),
  }),

  getCourses: () => request('/api/courses'),

  getDb: () => request('/api/db'),
  
  createStudent: (data) => request('/api/students', { method: 'POST', body: JSON.stringify(data) }),
  
  updateStudent: (id, data) => request(`/api/students/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  
  deleteStudent: (id) => request(`/api/students/${id}`, { method: 'DELETE' }),
  
  publishStudent: (id, publishedDocs) => request(`/api/students/${id}/publish`, { method: 'POST', body: JSON.stringify({ publishedDocs }) }),
  
  uploadCsv: async (file) => {
    const token = typeof window !== 'undefined' ? sessionStorage.getItem('dsvv_auth_token') : null;
    const formData = new FormData();
    formData.append('csvFile', file);
    const res = await fetch(`${API_BASE}/api/courses/upload`, {
      method: 'POST',
      headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      body: formData
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'CSV upload failed' }));
      throw new Error(err.error || 'CSV upload failed');
    }
    return res.json();
  },

  uploadPhoto: async (base64) => {
    const res = await request('/api/upload-photo', {
      method: 'POST',
      body: JSON.stringify({ image: base64 }),
    });
    return res;
  },

  searchPublic: (name, searchVal) => request(`/api/public/student?name=${encodeURIComponent(name)}&searchVal=${encodeURIComponent(searchVal)}`),

  importData: (data) => request('/api/import', { method: 'POST', body: JSON.stringify(data) }),
};
