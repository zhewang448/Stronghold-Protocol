using System.Diagnostics;
using System.Text.RegularExpressions;

namespace StrongholdProtocolLauncher.Services;

public sealed record NodeRuntime(string Executable, string Version, int Major)
{
    public bool IsSupported => Major >= 22;

    public static NodeRuntime? Find()
    {
        var candidates = new List<string> { Path.Combine(BootstrapInstaller.RuntimeDirectory, "node.exe") };
        var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        candidates.Add(Path.Combine(programFiles, "nodejs", "node.exe"));
        var programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        candidates.Add(Path.Combine(programFilesX86, "nodejs", "node.exe"));
        candidates.Add(Path.Combine(AppContext.BaseDirectory, "node.exe"));
        foreach (var directory in (Environment.GetEnvironmentVariable("PATH") ?? string.Empty).Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
            candidates.Add(Path.Combine(directory.Trim('"'), "node.exe"));

        NodeRuntime? unsupported = null;
        foreach (var candidate in candidates.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (!File.Exists(candidate)) continue;
            try
            {
                using var process = Process.Start(new ProcessStartInfo(candidate, "--version")
                {
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true,
                });
                if (process is null) continue;
                if (!process.WaitForExit(2500)) { process.Kill(); continue; }
                var version = process.StandardOutput.ReadToEnd().Trim();
                var match = Regex.Match(version, @"^v?(\d+)\.(\d+)\.(\d+)");
                if (match.Success && int.TryParse(match.Groups[1].Value, out var major))
                {
                    var found = new NodeRuntime(candidate, $"v{match.Groups[1].Value}.{match.Groups[2].Value}.{match.Groups[3].Value}", major);
                    if (found.IsSupported) return found;
                    unsupported ??= found;
                }
            }
            catch
            {
                // Try the next Node installation on PATH.
            }
        }
        return unsupported;
    }
}
