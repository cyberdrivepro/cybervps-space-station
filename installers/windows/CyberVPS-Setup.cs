using System;
using System.IO;
using System.Diagnostics;
using System.Text;
using System.Net;
using System.Security.Principal;
using Microsoft.Win32;
using System.ComponentModel;
using System.Collections.Generic;

namespace CyberVPS.Installer
{
    class Program
    {
        const string DEFAULT_SERVER = "https://cybervps-space-station.up.railway.app";
        const string DEFAULT_TOKEN = "cvps_enroll_master_token";
        const string INSTALLER_VERSION = "1.0.0";

        static string serverUrl = DEFAULT_SERVER;
        static string enrollmentToken = DEFAULT_TOKEN;
        static string customMachineId = "";
        static bool forceAdmin = false;
        static bool forceUser = false;
        static bool silentMode = false;
        static bool isUninstall = false;

        static int Main(string[] args)
        {
            ParseArguments(args);

            if (isUninstall)
            {
                return PerformUninstall();
            }

            bool isAdmin = IsRunningAsAdministrator();

            if (forceAdmin && !isAdmin)
            {
                return ElevateAndRerun(args);
            }

            if (!forceUser && !isAdmin)
            {
                // Interactive / Default: Try elevating first for 24/7 Service.
                // If user declines UAC, gracefully fallback to User mode.
                try
                {
                    if (!silentMode)
                    {
                        Console.WriteLine("[*] Requesting Administrator privilege for 24/7 background service registration...");
                    }
                    int elevateResult = ElevateAndRerun(args);
                    if (elevateResult == 0) return 0;
                }
                catch (Win32Exception)
                {
                    // User clicked "No" on UAC prompt - gracefully fallback to non-elevated user mode
                    if (!silentMode)
                    {
                        Console.WriteLine("[*] UAC elevation was declined. Automatically falling back to User-Level Mode (%LOCALAPPDATA%)...");
                    }
                }
            }

            // Decide target installation mode
            bool targetAdminMode = isAdmin && !forceUser;
            return PerformInstall(targetAdminMode);
        }

        static void ParseArguments(string[] args)
        {
            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i].Trim();
                if (a.Equals("--admin", StringComparison.OrdinalIgnoreCase) || a.Equals("/admin", StringComparison.OrdinalIgnoreCase))
                {
                    forceAdmin = true;
                }
                else if (a.Equals("--user", StringComparison.OrdinalIgnoreCase) || a.Equals("/user", StringComparison.OrdinalIgnoreCase))
                {
                    forceUser = true;
                }
                else if (a.Equals("--silent", StringComparison.OrdinalIgnoreCase) || a.Equals("/S", StringComparison.OrdinalIgnoreCase) || a.Equals("-s", StringComparison.OrdinalIgnoreCase) || a.Equals("/silent", StringComparison.OrdinalIgnoreCase))
                {
                    silentMode = true;
                }
                else if (a.Equals("--uninstall", StringComparison.OrdinalIgnoreCase) || a.Equals("/uninstall", StringComparison.OrdinalIgnoreCase) || a.Equals("/U", StringComparison.OrdinalIgnoreCase))
                {
                    isUninstall = true;
                }
                else if ((a.Equals("--server", StringComparison.OrdinalIgnoreCase) || a.Equals("-s", StringComparison.OrdinalIgnoreCase)) && i + 1 < args.Length)
                {
                    serverUrl = args[++i].Trim().TrimEnd('/');
                }
                else if ((a.Equals("--token", StringComparison.OrdinalIgnoreCase) || a.Equals("-t", StringComparison.OrdinalIgnoreCase)) && i + 1 < args.Length)
                {
                    enrollmentToken = args[++i].Trim();
                }
                else if ((a.Equals("--machine-id", StringComparison.OrdinalIgnoreCase) || a.Equals("-m", StringComparison.OrdinalIgnoreCase)) && i + 1 < args.Length)
                {
                    customMachineId = args[++i].Trim();
                }
                else if (a.Equals("--help", StringComparison.OrdinalIgnoreCase) || a.Equals("/?", StringComparison.OrdinalIgnoreCase) || a.Equals("-h", StringComparison.OrdinalIgnoreCase))
                {
                    ShowHelp();
                    Environment.Exit(0);
                }
            }
        }

        static void ShowHelp()
        {
            Console.WriteLine("================================================================");
            Console.WriteLine("🛰️  CYBERVPS SPACE STATION - NATIVE WINDOWS HOST AGENT INSTALLER");
            Console.WriteLine(string.Format("   Version: {0} (x64 Native Bootstrapper)", INSTALLER_VERSION));
            Console.WriteLine("================================================================");
            Console.WriteLine("Usage: CyberVPS-Setup-x64.exe [options]");
            Console.WriteLine();
            Console.WriteLine("Options:");
            Console.WriteLine("  --admin           Install in Administrator Mode (%ProgramData%, 24/7 Service)");
            Console.WriteLine("  --user            Install in User Mode (%LOCALAPPDATA%, no UAC required)");
            Console.WriteLine("  --server <url>    Central Control Plane Server URL");
            Console.WriteLine("  --token <token>   Fleet enrollment pairing token");
            Console.WriteLine("  --machine-id <id> Custom machine identifier (auto-detected if omitted)");
            Console.WriteLine("  --silent, /S      Headless silent installation (zero GUI popups)");
            Console.WriteLine("  --uninstall       Cleanly remove CyberVPS Agent, tasks, and autostart");
            Console.WriteLine("  --help, /?        Display this help message");
            Console.WriteLine("================================================================");
        }

        static bool IsRunningAsAdministrator()
        {
            try
            {
                WindowsIdentity id = WindowsIdentity.GetCurrent();
                WindowsPrincipal principal = new WindowsPrincipal(id);
                return principal.IsInRole(WindowsBuiltInRole.Administrator);
            }
            catch
            {
                return false;
            }
        }

        static int ElevateAndRerun(string[] originalArgs)
        {
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = Process.GetCurrentProcess().MainModule.FileName;
            psi.Verb = "runas";
            psi.UseShellExecute = true;

            List<string> cleanArgs = new List<string>(originalArgs);
            if (!cleanArgs.Contains("--admin") && !cleanArgs.Contains("/admin"))
            {
                cleanArgs.Add("--admin");
            }
            psi.Arguments = string.Join(" ", cleanArgs.ToArray());

            Process p = Process.Start(psi);
            p.WaitForExit();
            return p.ExitCode;
        }

        static int PerformInstall(bool isAdminMode)
        {
            string installDir = isAdminMode
                ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "CyberVPS")
                : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CyberVPS");

            string binDir = Path.Combine(installDir, "bin");
            string runDir = Path.Combine(installDir, "run");
            string logsDir = Path.Combine(installDir, "logs");
            string configFile = Path.Combine(installDir, "config.json");
            string agentScript = Path.Combine(installDir, "universal-agent.py");
            string cliScript = Path.Combine(binDir, "cybervps.py");
            string cmdWrapper = Path.Combine(binDir, "cybervps.cmd");

            if (!silentMode)
            {
                Console.WriteLine("================================================================");
                Console.WriteLine("🛰️  CYBERVPS SPACE STATION - INSTALLING HOST AGENT");
                Console.WriteLine("================================================================");
                Console.WriteLine(string.Format("  * Target Scope  : {0}", (isAdminMode ? "Machine-Wide (Administrator, 24/7 Service)" : "Current User (Standard, No UAC)")));
                Console.WriteLine(string.Format("  * Install Path  : {0}", installDir));
                Console.WriteLine(string.Format("  * Control Plane : {0}", serverUrl));
                Console.WriteLine("================================================================");
            }

            try
            {
                Directory.CreateDirectory(installDir);
                Directory.CreateDirectory(binDir);
                Directory.CreateDirectory(runDir);
                Directory.CreateDirectory(logsDir);

                // Stop any running agent processes
                StopExistingProcesses(installDir);

                // Deploy agent scripts
                DeployAgentFiles(agentScript, cliScript, cmdWrapper);

                // Write persistent configuration
                string machineId = string.IsNullOrEmpty(customMachineId) ? ("cvps_" + Environment.MachineName.ToLowerInvariant()) : customMachineId;
                WriteConfigFile(configFile, machineId, serverUrl, enrollmentToken);

                // Setup Shadow Redundancy Mirror for Self-Healing
                SetupShadowMirror(agentScript, isAdminMode);

                // Setup PATH environment variable
                RegisterPath(binDir, isAdminMode);

                // Setup Autostart Supervisor (Scheduled Task in Admin mode, Run key in User mode)
                string pythonExe = ResolvePythonExecutable();
                string pythonwExe = ResolvePythonwExecutable(pythonExe);

                if (isAdminMode)
                {
                    ConfigureAdminSupervisor(installDir, pythonwExe, agentScript, configFile, logsDir);
                }
                else
                {
                    ConfigureUserAutostart(installDir, pythonwExe, agentScript, configFile, logsDir);
                }

                // Start the agent process
                StartAgentProcess(pythonwExe, agentScript, configFile, logsDir, runDir);

                if (!silentMode)
                {
                    Console.WriteLine();
                    Console.WriteLine("================================================================");
                    Console.WriteLine("🎉 CYBERVPS HOST AGENT INSTALLED AND ACTIVATED!");
                    Console.WriteLine("================================================================");
                    Console.WriteLine(string.Format("  Machine ID   : {0}", machineId));
                    Console.WriteLine("  Dashboard    : https://cyberdrivepro.github.io/cybervps-space-station/");
                    Console.WriteLine("  CLI Tool     : cybervps status");
                    Console.WriteLine(string.Format("  Logs         : {0}", Path.Combine(logsDir, "agent.log")));
                    Console.WriteLine("================================================================");
                }

                return 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(string.Format("[X] Installation failed: {0}", ex.Message));
                if (!silentMode)
                {
                    Console.Error.WriteLine(ex.StackTrace);
                }
                return 1;
            }
        }

        static void DeployAgentFiles(string agentScript, string cliScript, string cmdWrapper)
        {
            string selfDir = AppDomain.CurrentDomain.BaseDirectory;
            string repoAgent = Path.Combine(selfDir, "..", "..", "agent", "universal-agent.py");
            string repoCli = Path.Combine(selfDir, "..", "..", "bin", "cybervps.py");

            if (File.Exists(Path.Combine(selfDir, "universal-agent.py")))
            {
                File.Copy(Path.Combine(selfDir, "universal-agent.py"), agentScript, true);
            }
            else if (File.Exists(repoAgent))
            {
                File.Copy(repoAgent, agentScript, true);
            }
            else
            {
                Console.WriteLine("[*] Fetching authoritative agent script from GitHub...");
                using (WebClient wc = new WebClient())
                {
                    wc.Headers["User-Agent"] = "CyberVPS-Windows-Setup/1.0";
                    wc.DownloadFile("https://raw.githubusercontent.com/cyberdrivepro/cybervps-space-station/main/agent/universal-agent.py", agentScript);
                }
            }

            if (File.Exists(Path.Combine(selfDir, "cybervps.py")))
            {
                File.Copy(Path.Combine(selfDir, "cybervps.py"), cliScript, true);
            }
            else if (File.Exists(repoCli))
            {
                File.Copy(repoCli, cliScript, true);
            }
            else
            {
                using (WebClient wc = new WebClient())
                {
                    wc.Headers["User-Agent"] = "CyberVPS-Windows-Setup/1.0";
                    wc.DownloadFile("https://raw.githubusercontent.com/cyberdrivepro/cybervps-space-station/main/bin/cybervps.py", cliScript);
                }
            }

            string cmdContent = "@echo off\r\n"
                + "setlocal\r\n"
                + "set \"CYBERVPS_HOME=%~dp0..\"\r\n"
                + "where python.exe >nul 2>nul\r\n"
                + "if %ERRORLEVEL% EQU 0 (\r\n"
                + "    python \"%CYBERVPS_HOME%\\bin\\cybervps.py\" %*\r\n"
                + ") else (\r\n"
                + "    where py.exe >nul 2>nul\r\n"
                + "    if %ERRORLEVEL% EQU 0 (\r\n"
                + "        py -3 \"%CYBERVPS_HOME%\\bin\\cybervps.py\" %*\r\n"
                + "    ) else (\r\n"
                + "        echo Python 3 is required to execute CyberVPS CLI. Please install Python from https://python.org >&2\r\n"
                + "        exit /b 1\r\n"
                + "    )\r\n"
                + ")\r\n";

            File.WriteAllText(cmdWrapper, cmdContent, Encoding.ASCII);
            Console.WriteLine("  [+] Agent runtime files deployed successfully.");
        }

        static void WriteConfigFile(string configFile, string machineId, string server, string token)
        {
            string json = "{\r\n"
                + string.Format("  \"server_url\": \"{0}\",\r\n", server)
                + "  \"server_urls\": [\r\n"
                + string.Format("    \"{0}\",\r\n", server)
                + "    \"https://cybervpsbackend4.getvoroa.com\",\r\n"
                + "    \"https://cybervps-space-station.up.railway.app\"\r\n"
                + "  ],\r\n"
                + string.Format("  \"token\": \"{0}\",\r\n", token)
                + string.Format("  \"machine_id\": \"{0}\",\r\n", machineId)
                + string.Format("  \"hostname\": \"{0}\",\r\n", Environment.MachineName)
                + string.Format("  \"installed_at\": \"{0:O}\",\r\n", DateTime.UtcNow)
                + "  \"ghost_mode\": true\r\n"
                + "}\r\n";

            File.WriteAllText(configFile, json, Encoding.UTF8);
            Console.WriteLine("  [+] Machine configuration persistent file created.");
        }

        static void SetupShadowMirror(string agentScript, bool isAdminMode)
        {
            try
            {
                string shadowDir = isAdminMode
                    ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CyberVPS")
                    : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "CyberVPS");

                Directory.CreateDirectory(shadowDir);
                string shadowScript = Path.Combine(shadowDir, "universal-agent.py");
                File.Copy(agentScript, shadowScript, true);
                Console.WriteLine(string.Format("  [+] Obsidian Self-Healing shadow mirror verified at: {0}", shadowScript));
            }
            catch (Exception ex)
            {
                Console.WriteLine(string.Format("  [!] Notice: Shadow mirror creation non-fatal warning: {0}", ex.Message));
            }
        }

        static void RegisterPath(string binDir, bool isAdminMode)
        {
            try
            {
                if (isAdminMode)
                {
                    using (RegistryKey envKey = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\Session Manager\Environment", true))
                    {
                        if (envKey != null)
                        {
                            string currPath = (envKey.GetValue("Path", "", RegistryValueOptions.DoNotExpandEnvironmentNames) as string) ?? "";
                            if (!currPath.ToLowerInvariant().Contains(binDir.ToLowerInvariant()))
                            {
                                envKey.SetValue("Path", currPath.TrimEnd(';') + ";" + binDir, RegistryValueKind.ExpandString);
                                Console.WriteLine("  [+] Added CyberVPS CLI to System PATH.");
                            }
                        }
                    }
                }
                else
                {
                    using (RegistryKey envKey = Registry.CurrentUser.OpenSubKey("Environment", true))
                    {
                        if (envKey != null)
                        {
                            string currPath = (envKey.GetValue("Path", "") as string) ?? "";
                            if (!currPath.ToLowerInvariant().Contains(binDir.ToLowerInvariant()))
                            {
                                envKey.SetValue("Path", currPath.TrimEnd(';') + ";" + binDir, RegistryValueKind.String);
                                Console.WriteLine("  [+] Added CyberVPS CLI to User PATH.");
                            }
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine(string.Format("  [!] PATH registration warning: {0}", ex.Message));
            }
        }

        static string ResolvePythonExecutable()
        {
            string pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
            string[] paths = pathEnv.Split(';');
            foreach (string p in paths)
            {
                string cand = Path.Combine(p.Trim(), "python.exe");
                if (File.Exists(cand)) return cand;
            }

            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string[] candDirs = new string[]
            {
                Path.Combine(localAppData, "Programs", "Python", "Python314", "python.exe"),
                Path.Combine(localAppData, "Programs", "Python", "Python313", "python.exe"),
                Path.Combine(localAppData, "Programs", "Python", "Python312", "python.exe"),
                Path.Combine(localAppData, "Programs", "Python", "Python311", "python.exe"),
                Path.Combine(localAppData, "Programs", "Python", "Python310", "python.exe"),
                @"C:\Python312\python.exe",
                @"C:\Python311\python.exe",
                @"C:\Python310\python.exe"
            };

            foreach (string cand in candDirs)
            {
                if (File.Exists(cand)) return cand;
            }

            return "python.exe";
        }

        static string ResolvePythonwExecutable(string pythonExe)
        {
            if (pythonExe.EndsWith("python.exe", StringComparison.OrdinalIgnoreCase))
            {
                string pyw = pythonExe.Substring(0, pythonExe.Length - 10) + "pythonw.exe";
                if (File.Exists(pyw)) return pyw;
            }
            return pythonExe;
        }

        static void ConfigureAdminSupervisor(string installDir, string pythonwExe, string agentScript, string configFile, string logsDir)
        {
            string taskName = "CyberVPSAgent";
            string logFile = Path.Combine(logsDir, "agent.log");
            string actionArg = string.Format("\"{0}\" --config \"{1}\" --log-file \"{2}\" --ghost", agentScript, configFile, logFile);

            try
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = "schtasks.exe";
                psi.Arguments = string.Format("/Create /TN \"{0}\" /TR \"\\\"{1}\\\" {2}\" /SC ONSTART /RU \"NT AUTHORITY\\SYSTEM\" /RL HIGHEST /F", taskName, pythonwExe, actionArg);
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;

                Process p = Process.Start(psi);
                p.WaitForExit();

                if (p.ExitCode == 0)
                {
                    Console.WriteLine("  [+] Registered 24/7 Windows SYSTEM Startup Task (CyberVPSAgent).");
                }
                else
                {
                    psi.Arguments = string.Format("/Create /TN \"{0}\" /TR \"\\\"{1}\\\" {2}\" /SC ONLOGON /RL HIGHEST /F", taskName, pythonwExe, actionArg);
                    Process p2 = Process.Start(psi);
                    p2.WaitForExit();
                    Console.WriteLine("  [+] Registered Windows Elevated Logon Task (CyberVPSAgent).");
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine(string.Format("  [!] Supervisor task warning: {0}", ex.Message));
            }
        }

        static void ConfigureUserAutostart(string installDir, string pythonwExe, string agentScript, string configFile, string logsDir)
        {
            string logFile = Path.Combine(logsDir, "agent.log");
            string cmdLine = string.Format("\"{0}\" \"{1}\" --config \"{2}\" --log-file \"{3}\" --ghost", pythonwExe, agentScript, configFile, logFile);

            try
            {
                using (RegistryKey runKey = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true))
                {
                    if (runKey != null)
                    {
                        runKey.SetValue("CyberVPSAgent", cmdLine, RegistryValueKind.String);
                        Console.WriteLine("  [+] Registered User Autostart Key (HKCU Run -> CyberVPSAgent).");
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine(string.Format("  [!] User autostart registration warning: {0}", ex.Message));
            }
        }

        static void StartAgentProcess(string pythonwExe, string agentScript, string configFile, string logsDir, string runDir)
        {
            string logFile = Path.Combine(logsDir, "agent.log");
            string pidFile = Path.Combine(runDir, "agent.pid");

            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = pythonwExe;
            psi.Arguments = string.Format("\"{0}\" --config \"{1}\" --log-file \"{2}\" --ghost", agentScript, configFile, logFile);
            psi.WorkingDirectory = Path.GetDirectoryName(agentScript);
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;

            try
            {
                Process p = Process.Start(psi);
                if (p != null)
                {
                    File.WriteAllText(pidFile, p.Id.ToString());
                    Console.WriteLine(string.Format("  [+] CyberVPS Host Agent daemon launched (PID: {0}).", p.Id));
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine(string.Format("  [!] Notice: Process spawn check: {0}", ex.Message));
            }
        }

        static void StopExistingProcesses(string installDir)
        {
            try
            {
                string pidFile = Path.Combine(installDir, "run", "agent.pid");
                if (File.Exists(pidFile))
                {
                    string pidStr = File.ReadAllText(pidFile).Trim();
                    int pid;
                    if (int.TryParse(pidStr, out pid))
                    {
                        try
                        {
                            Process p = Process.GetProcessById(pid);
                            if (p != null && !p.HasExited)
                            {
                                p.Kill();
                                p.WaitForExit(2000);
                            }
                        }
                        catch { }
                    }
                    File.Delete(pidFile);
                }
            }
            catch { }
        }

        static int PerformUninstall()
        {
            Console.WriteLine("================================================================");
            Console.WriteLine("🗑️  CYBERVPS SPACE STATION - UNINSTALLING HOST AGENT");
            Console.WriteLine("================================================================");

            try
            {
                Process p1 = Process.Start(new ProcessStartInfo("schtasks.exe", "/Delete /TN \"CyberVPSAgent\" /F") { CreateNoWindow = true, UseShellExecute = false });
                if (p1 != null) p1.WaitForExit();
                Process p2 = Process.Start(new ProcessStartInfo("schtasks.exe", "/Delete /TN \"CyberVPS-Space-Station-Agent\" /F") { CreateNoWindow = true, UseShellExecute = false });
                if (p2 != null) p2.WaitForExit();
                Console.WriteLine("  [*] Removed Windows Scheduled Tasks.");
            }
            catch { }

            try
            {
                using (RegistryKey r = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true))
                {
                    if (r != null)
                    {
                        r.DeleteValue("CyberVPSAgent", false);
                        r.DeleteValue("CyberVPS-Agent", false);
                    }
                }
                Console.WriteLine("  [*] Removed User Registry autostart keys.");
            }
            catch { }

            try
            {
                string[] pids = new string[]
                {
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "CyberVPS", "run", "agent.pid"),
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CyberVPS", "run", "agent.pid")
                };
                foreach (string pf in pids)
                {
                    if (File.Exists(pf))
                    {
                        int p;
                        if (int.TryParse(File.ReadAllText(pf).Trim(), out p))
                        {
                            try { Process pProc = Process.GetProcessById(p); if (pProc != null) pProc.Kill(); } catch { }
                        }
                        File.Delete(pf);
                    }
                }
            }
            catch { }

            Console.WriteLine("  [+] CyberVPS Host Agent successfully uninstalled.");
            Console.WriteLine("================================================================");
            return 0;
        }
    }
}
