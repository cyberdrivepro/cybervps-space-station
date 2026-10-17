/**
 * CYBERVPS SPACE STATION - CLIENT-SIDE HASH ROUTER
 * Maps 19 Operations Modules, Query Parameters, and History State
 */

class StationRouter {
  constructor(stateStore) {
    this.store = stateStore;
    this.routes = new Map();
    this.defaultRoute = 'overview';

    this.moduleTitles = {
      overview: 'System Overview & Control Plane',
      fleet: 'Enrolled Instances Fleet',
      recovery: 'Disaster Recovery & Full-Wipe Re-Enrollment',
      apps: 'Application Discovery & Live Viewer',
      rdp: 'Remote Desktop (RDP / noVNC / RustDesk)',
      cluster: 'Multi-Backend HA Manager (Ender Dragon Mesh)',
      hosting: 'Custom Website & Application Hosting',
      wireguard: 'WireGuard Mesh Network & Infrastructure',
      intel: 'Device Intel & Hardware Neofetch',
      files: 'File Manager & SFTP Explorer',
      terminal: 'Web Terminal & ConPTY Shell',
      processes: 'Process & Services Inspector',
      bridge: 'TCP Port Bridge (Localhost Mode)',
      mesh: 'Virtual Network Mesh (10.77.0.0/24)',
      ports: 'All-Port Network Explorer',
      tunnels: 'Public Tunnels & Ingress Gateways',
      doctor: 'System Doctor (16-Point Deep Diagnostics)',
      audit: 'Audit Security Trail & Logs',
      settings: 'Control Plane Settings & Backend Config'
    };

    window.addEventListener('hashchange', () => this.handleHashChange());
  }

  registerRoute(routeId, renderHandler) {
    this.routes.set(routeId, renderHandler);
  }

  init() {
    this.handleHashChange();
  }

  handleHashChange() {
    const hash = window.location.hash.replace(/^#\/?/, '') || this.defaultRoute;
    const [pathPart, queryPart] = hash.split('?');
    const routeId = pathPart || this.defaultRoute;

    if (queryPart) {
      const params = new URLSearchParams(queryPart);
      const machineId = params.get('machine_id');
      if (machineId) {
        this.store.set('activeMachineId', machineId);
      }
    }

    this.store.set('activeModule', routeId);
    this.updateActiveNavUI(routeId);

    const title = this.moduleTitles[routeId] || 'CyberVPS Space Station';
    document.title = `${title} | CyberVPS Space Station`;

    if (this.routes.has(routeId)) {
      const handler = this.routes.get(routeId);
      handler(this.store.state);
    }
  }

  navigate(routeId, params = {}) {
    let hash = `#${routeId}`;
    const keys = Object.keys(params);
    if (keys.length > 0) {
      const qs = new URLSearchParams(params).toString();
      hash += `?${qs}`;
    }
    window.location.hash = hash;
  }

  updateActiveNavUI(activeId) {
    const navItems = document.querySelectorAll('[data-route]');
    navItems.forEach(el => {
      const target = el.getAttribute('data-route');
      if (target === activeId) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    });
  }
}

if (typeof window !== 'undefined') {
  window.StationRouter = StationRouter;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StationRouter;
}
