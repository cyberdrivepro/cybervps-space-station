/**
 * CYBERVPS SPACE STATION - CORE DOMAIN SERVICES CONTAINER
 * Orchestrates FleetManager, TerminalManager, FileManager, BridgeManager,
 * DoctorService, AuditService, AppManager, TunnelService, MeshManager
 */

const { FleetManager } = require('./fleet-manager');
const { TerminalManager } = require('./terminal-manager');
const { FileManager } = require('./file-manager');
const { BridgeManager } = require('./bridge-manager');
const DoctorService = require('./doctor-service');
const AuditService = require('./audit-service');
const AppManager = require('./app-manager');
const TunnelService = require('./tunnel-service');
const MeshManager = require('./mesh-manager');

class CoreServices {
  constructor(options = {}) {
    this.storage = options.storage || null;
    this.clusterState = options.clusterState || null;

    // 1. Audit Service
    this.auditService = new AuditService({
      storage: this.storage,
      enableConsole: options.enableConsole !== false
    });

    // 2. Fleet Manager
    this.fleetManager = new FleetManager(this.storage, {
      auditService: this.auditService
    });

    // 3. Bridge Manager
    this.bridgeManager = new BridgeManager(this.storage, {
      auditService: this.auditService
    });

    // 4. File Manager
    this.fileManager = new FileManager({
      fleetManager: this.fleetManager,
      auditService: this.auditService
    });

    // 5. Terminal Manager
    this.terminalManager = new TerminalManager({
      fleetManager: this.fleetManager,
      auditService: this.auditService
    });

    // 6. Application Manager
    this.appManager = new AppManager({
      fleetManager: this.fleetManager,
      auditService: this.auditService
    });

    // 7. Tunnel Service
    this.tunnelService = new TunnelService({
      storage: this.storage,
      auditService: this.auditService
    });

    // 8. Mesh Manager
    this.meshManager = new MeshManager({
      fleetManager: this.fleetManager,
      auditService: this.auditService
    });

    // 9. Doctor Service
    this.doctorService = new DoctorService({
      storage: this.storage,
      fleetManager: this.fleetManager,
      bridgeManager: this.bridgeManager,
      clusterState: this.clusterState
    });
  }

  async initialize() {
    if (this.storage && typeof this.storage.initialize === 'function') {
      await this.storage.initialize();
    }
    if (this.fleetManager && typeof this.fleetManager.init === 'function') {
      await this.fleetManager.init();
    }
    if (this.bridgeManager && typeof this.bridgeManager.init === 'function') {
      await this.bridgeManager.init();
    }
    await this.auditService.info('core_services_init', 'CyberVPS Space Station Core Domain Services successfully initialized');
    return this;
  }
}

module.exports = {
  CoreServices,
  FleetManager,
  TerminalManager,
  FileManager,
  BridgeManager,
  DoctorService,
  AuditService,
  AppManager,
  TunnelService,
  MeshManager
};
