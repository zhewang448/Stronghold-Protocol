using System.Security.Cryptography;
using System.Text.Json;

namespace StrongholdProtocolLauncher.Services;

public static class LauncherLocation
{
    private static string? _cachedPath, _cachedHash;
    private static DateTime _cachedWrite;
    private static long _cachedSize;
    public static void Register(string root, string? executable = null)
    {
        executable ??= Environment.ProcessPath;
        if (executable is null || !Path.IsPathFullyQualified(executable)
            || !Path.GetFileName(executable).Equals("StrongholdProtocolLauncher.exe", StringComparison.OrdinalIgnoreCase)
            || !File.Exists(executable) || !InstallationLocator.IsProjectRoot(root)) return;
        var file = Path.Combine(root, "logs", "launcher-location.json");
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        var info = new FileInfo(executable);
        if (_cachedPath != executable || _cachedHash is null || _cachedWrite != info.LastWriteTimeUtc || _cachedSize != info.Length)
        {
            using var input = File.OpenRead(executable);
            _cachedHash = Convert.ToHexString(SHA256.HashData(input)).ToLowerInvariant();
            _cachedPath = executable; _cachedWrite = info.LastWriteTimeUtc; _cachedSize = info.Length;
        }
        var sha256 = _cachedHash;
        var temporary = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            File.WriteAllText(temporary, JsonSerializer.Serialize(new { format = 1, path = Path.GetFullPath(executable), sha256 }));
            File.Move(temporary, file, true);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
}
