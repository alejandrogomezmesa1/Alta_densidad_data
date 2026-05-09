const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

// Helper to simulate API delay in Demo Mode
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

class ApiService {
  constructor() {
    this.isDemoMode = localStorage.getItem('demoMode') === 'true';
  }

  setDemoMode(enabled) {
    this.isDemoMode = enabled;
    localStorage.setItem('demoMode', enabled);
  }

  getDemoMode() {
    return this.isDemoMode;
  }

  // --- AUTH METHODS ---
  async login(username, password) {
    const response = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Login failed');
    
    localStorage.setItem('alta_token', data.token);
    localStorage.setItem('alta_user', data.username);
    return data;
  }

  logout() {
    localStorage.removeItem('alta_token');
    localStorage.removeItem('alta_user');
    window.location.reload();
  }

  getToken() {
    return localStorage.getItem('alta_token');
  }

  isAuthenticated() {
    return !!this.getToken();
  }

  // Local Storage Helpers
  _getLocalData(endpoint) {
    const data = localStorage.getItem(`demo_${endpoint}`);
    return data ? JSON.parse(data) : [];
  }

  _saveLocalData(endpoint, data) {
    localStorage.setItem(`demo_${endpoint}`, JSON.stringify(data));
  }

  // Central Request Handler
  async request(endpoint, options = {}) {
    if (this.isDemoMode) {
      return this._handleDemoRequest(endpoint, options);
    }

    try {
      const token = this.getToken();
      const response = await fetch(`${API_URL}${endpoint}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          ...options.headers,
        },
      });

      if (response.status === 401 || response.status === 403) {
        // Token expired or invalid
        if (!this.isDemoMode && endpoint !== '/auth/login') {
            localStorage.removeItem('alta_token');
            // We don't reload here to avoid loops, let the UI handle it
        }
      }

      if (!response.ok) {
        throw new Error(`API Error: ${response.statusText}`);
      }

      // Handle empty responses (like 204 No Content or simple OK messages)
      const text = await response.text();
      return text ? JSON.parse(text) : {};
    } catch (error) {
      console.warn(`API call to ${endpoint} failed. Suggesting Demo Mode.`, error);
      throw error;
    }
  }

  // --- DEMO MODE LOGIC ---
  async _handleDemoRequest(endpoint, options) {
    await delay(300); // Simulate network latency
    const method = options.method || 'GET';
    const baseEndpoint = endpoint.split('/')[1] || endpoint.substring(1); // e.g., /products -> products, /sales/123 -> sales
    const resource = baseEndpoint.split('?')[0];
    
    let data = this._getLocalData(resource);

    switch (method) {
      case 'GET':
        return data;
      case 'POST':
        const newItem = { id: Date.now(), ...JSON.parse(options.body), createdAt: new Date().toISOString() };
        this._saveLocalData(resource, [...data, newItem]);
        return newItem;
      case 'PUT':
        const updateId = parseInt(endpoint.split('/').pop());
        const updates = JSON.parse(options.body);
        const index = data.findIndex(item => item.id === updateId);
        if (index !== -1) {
          data[index] = { ...data[index], ...updates };
          this._saveLocalData(resource, data);
          return data[index];
        }
        throw new Error('Item not found in demo mode');
      case 'DELETE':
        const deleteId = parseInt(endpoint.split('/').pop());
        const filteredData = data.filter(item => item.id !== deleteId);
        this._saveLocalData(resource, filteredData);
        return { message: 'Deleted (Demo)' };
      default:
        return data;
    }
  }

  // Quick Methods
  get(endpoint) { return this.request(endpoint); }
  post(endpoint, body) { return this.request(endpoint, { method: 'POST', body: JSON.stringify(body) }); }
  put(endpoint, body) { return this.request(endpoint, { method: 'PUT', body: JSON.stringify(body) }); }
  delete(endpoint) { return this.request(endpoint, { method: 'DELETE' }); }
}

export const api = new ApiService();
