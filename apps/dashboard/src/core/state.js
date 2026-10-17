/**
 * CYBERVPS SPACE STATION - FRONTEND CENTRAL STATE STORE
 * Reactive state container with subscription listeners
 */

class StationState {
  constructor() {
    this.state = {
      backendUrl: this._getInitialBackend(),
      pairingKey: localStorage.getItem('cvps_pairing_key') || 'cybervps_pair_station_2026',
      sessionToken: localStorage.getItem('cvps_session_token') || null,
      activeModule: 'overview',
      activeMachineId: localStorage.getItem('cvps_active_machine') || null,
      fleet: [],
      clusterNodes: [],
      systemHealth: { score: 100, status: 'HEALTHY' },
      isConnecting: false,
      lastSyncTime: null,
      theme: localStorage.getItem('cvps_theme') || 'cyberpunk',
      notifications: []
    };

    this.listeners = new Set();
  }

  _getInitialBackend() {
    const params = new URLSearchParams(window.location.search);
    const backendParam = params.get('backend');
    if (backendParam) return backendParam.replace(/\/$/, '');
    
    const saved = localStorage.getItem('cvps_control_plane_url');
    if (saved) return saved.replace(/\/$/, '');

    // Default to origin if self-hosted, or Railway production if on GitHub Pages
    if (window.location.origin.includes('github.io')) {
      return 'https://cybervps-space-station.up.railway.app';
    }
    return window.location.origin || 'http://localhost:8080';
  }

  get(key) {
    return this.state[key];
  }

  set(key, value) {
    this.state[key] = value;
    if (key === 'backendUrl') localStorage.setItem('cvps_control_plane_url', value);
    if (key === 'pairingKey') localStorage.setItem('cvps_pairing_key', value);
    if (key === 'sessionToken') localStorage.setItem('cvps_session_token', value);
    if (key === 'activeMachineId') localStorage.setItem('cvps_active_machine', value || '');
    if (key === 'theme') localStorage.setItem('cvps_theme', value);

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
