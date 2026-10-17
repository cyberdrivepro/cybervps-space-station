/**
 * CYBERVPS SPACE STATION - FRONTEND CENTRAL STATE STORE
 * Reactive state container with subscription listeners
 */

class StationState {
  constructor() {
    this.state = {
      backendUrl: this._getInitialBackend(),
      pairingKey: (typeof localStorage !== 'undefined') ? (localStorage.getItem('cvps_pairing_key') || null) : null,
      sessionToken: (typeof localStorage !== 'undefined') ? (localStorage.getItem('cvps_session_token') || null) : null,
      activeModule: 'overview',
      activeMachineId: (typeof localStorage !== 'undefined') ? (localStorage.getItem('cvps_active_machine') || null) : null,
      fleet: [],
      clusterNodes: [],
      systemHealth: { score: null, status: 'PENDING_VERIFICATION' },
      isConnecting: false,
      lastSyncTime: null,
      theme: (typeof localStorage !== 'undefined') ? (localStorage.getItem('cvps_theme') || 'cyberpunk') : 'cyberpunk',
      notifications: []
    };

    this.listeners = new Set();
  }

  _getInitialBackend() {
    if (typeof window === 'undefined') return 'http://localhost:8080';
    const params = new URLSearchParams(window.location.search);
    const backendParam = params.get('backend');
    if (backendParam) return backendParam.replace(/\/$/, '');
    
    // Check both potential storage keys for consistency
    const saved = localStorage.getItem('cvps_control_plane_url') || localStorage.getItem('cvps_server_url');
    const isHostedDomain = window.location.hostname && 
      (window.location.hostname.endsWith('github.io') || window.location.hostname.endsWith('netlify.app'));

    // If hosted on GitHub Pages or Netlify and stored target is loopback without explicit query param, auto-recover to Railway public endpoint
    const isLoopback = saved && (saved.includes('localhost') || saved.includes('127.0.0.1'));
    if (isHostedDomain && isLoopback) {
      console.warn('[CyberVPS] Hosted environment detected with stale loopback target. Auto-recovering to Railway public relay');
      const defaultCloud = 'https://cybervps-space-station.up.railway.app';
      try {
        localStorage.setItem('cvps_control_plane_url', defaultCloud);
        localStorage.setItem('cvps_server_url', defaultCloud);
      } catch (_) {}
      return defaultCloud;
    }

    if (saved) return saved.replace(/\/$/, '');

    // Default to Railway production if on GitHub Pages/Netlify, or origin if self-hosted
    if (isHostedDomain) {
      return 'https://cybervps-space-station.up.railway.app';
    }
    return (window.location.origin && window.location.origin.startsWith('http')) 
      ? window.location.origin 
      : 'https://cybervps-space-station.up.railway.app';
  }

  get(key) {
    return this.state[key];
  }

  set(key, value) {
    this.state[key] = value;
    if (typeof localStorage !== 'undefined') {
      if (key === 'backendUrl') {
        localStorage.setItem('cvps_control_plane_url', value);
        localStorage.setItem('cvps_server_url', value);
      }
      if (key === 'pairingKey') {
        if (value) localStorage.setItem('cvps_pairing_key', value);
        else localStorage.removeItem('cvps_pairing_key');
      }
      if (key === 'sessionToken') {
        if (value) localStorage.setItem('cvps_session_token', value);
        else localStorage.removeItem('cvps_session_token');
      }
      if (key === 'activeMachineId') {
        if (value) localStorage.setItem('cvps_active_machine', value);
        else localStorage.removeItem('cvps_active_machine');
      }
      if (key === 'theme') localStorage.setItem('cvps_theme', value);
    }

    this.notify(key, value);
  }

  update(partialState) {
    for (const [k, v] of Object.entries(partialState)) {
      this.set(k, v);
    }
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(key, value) {
    for (const listener of this.listeners) {
      try {
        listener(key, value, this.state);
      } catch (e) {
        console.error('State subscriber error:', e);
      }
    }
  }

  addNotification(type, message) {
    const notification = {
      id: Date.now().toString(36),
      type, // 'info', 'success', 'warning', 'error'
      message,
      timestamp: new Date().toLocaleTimeString()
    };
    this.state.notifications.unshift(notification);
    if (this.state.notifications.length > 20) this.state.notifications.pop();
    this.notify('notifications', this.state.notifications);
  }
}

if (typeof window !== 'undefined') {
  window.StationState = StationState;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StationState;
}
