# Universal All-Port Networking Guide (Ports 1–65535)

## 1. Overview
CyberVPS Space Station rejects artificial restrictions on port numbers. It provides full, permission-aware access across the entire assignable TCP and UDP spectrum.

## 2. Port Boundaries & Special Handling
- **Port 0 (Special/Reserved)**:
  In BSD and POSIX sockets, binding to port 0 signals the operating system to dynamically allocate an available ephemeral port. Port 0 cannot be used as an ordinary destination endpoint for reachable network services and is rejected by the validation engine.
- **Ports 1–1023 (Privileged System Ports)**:
  Traditionally require `root` or `CAP_NET_BIND_SERVICE` on Linux to bind. However, connecting outbound to an existing listening service on these ports does NOT require root!
- **Ports 1024–49151 (Registered Ports)**:
  Common development servers, web services, and databases (e.g. 3000, 5000, 6767, 8080, 22220).
- **Ports 49152–65535 (Dynamic / Private / Ephemeral Ports)**:
  Fully supported for dynamic allocation, custom microservices, and fallback conflict resolution.

## 3. Conflict-Safe Local Port Allocation
When the Windows Client attempts to map a remote port (e.g., remote 6767 -> local 16767):
1. It attempts to bind `127.0.0.1:16767`.
2. If `EADDRINUSE` occurs (e.g. an existing local program is already using 16767), the client:
   - Does NOT terminate or modify the existing process.
   - Binds to port `0`, letting Windows assign an available free port.
   - Updates the mapping table with the resolved port.
   - Flags `hasConflict: true` in the dashboard so the user is aware.

## 4. Mode A vs Mode B

| Feature | Mode A: TCP Port Bridge | Mode B: Virtual Private Network |
|---|---|---|
| **Mechanism** | Userspace TCP stream forwarding | IP packet routing over virtual subnet |
| **Addressing** | `127.0.0.1:<local_port>` | Dedicated Virtual IP (`10.77.0.X`) |
| **Privileges** | Pure userspace (Root/Admin NOT required) | Requires TUN/TAP driver (Root or Administrator) |
| **Protocols** | TCP (and UDP datagram bridge) | All IP traffic (TCP, UDP, ICMP) |
