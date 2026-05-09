const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

class ApiService {
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

  // Central Request Handler
  async request(endpoint, options = {}) {
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
        if (endpoint !== '/auth/login') {
            localStorage.removeItem('alta_token');
            // Notify or redirect to login
        }
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Error del servidor: ${response.statusText}`);
      }

      const text = await response.text();
      return text ? JSON.parse(text) : {};
    } catch (error) {
      console.error(`API call to ${endpoint} failed:`, error);
      // Re-throw to be handled by the UI
      if (error.message === 'Failed to fetch') {
          throw new Error('No se pudo conectar con el servidor. Por favor, verifica tu conexión.');
      }
      throw error;
    }
  }

  // Quick Methods
  get(endpoint) { return this.request(endpoint); }
  post(endpoint, body) { return this.request(endpoint, { method: 'POST', body: JSON.stringify(body) }); }
  put(endpoint, body) { return this.request(endpoint, { method: 'PUT', body: JSON.stringify(body) }); }
  delete(endpoint) { return this.request(endpoint, { method: 'DELETE' }); }
}

export const api = new ApiService();
