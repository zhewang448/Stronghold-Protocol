using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace StrongholdProtocolLauncher.Services;

public static class InstanceIndex
{
    public static string DefaultDirectory => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "StrongholdProtocol", "discovered-instances");
    private static string Normalize(string root) => Path.TrimEndingDirectorySeparator(Path.GetFullPath(root));
    public static string RecordPath(string root, string? directory = null)
    {
        var key = Normalize(root);
        if (OperatingSystem.IsWindows()) key = key.ToUpperInvariant();
        return Path.Combine(directory ?? DefaultDirectory, Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key))).ToLowerInvariant() + ".json");
    }
    public static void Register(string root, int port, string? directory = null)
    {
        if (!InstanceDiscovery.IsInstallation(root) || port is < 1024 or > 65435) return;
        var file = RecordPath(root, directory);
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        var temporary = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            File.WriteAllText(temporary, JsonSerializer.Serialize(new { format = 1, root = Normalize(root), port, updatedAt = DateTimeOffset.UtcNow.ToString("O") }));
            File.Move(temporary, file, true);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
    public static void Forget(string root, string? directory = null)
    {
        var file = RecordPath(root, directory);
        if (File.Exists(file)) File.Delete(file);
    }
    public static string[] Read(string? directory = null)
    {
        var roots = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        try
        {
            directory ??= DefaultDirectory;
            if (!Directory.Exists(directory)) return [];
            foreach (var file in Directory.EnumerateFiles(directory, "*.json").Take(4096))
                try
                {
                    var info = new FileInfo(file);
                    if (info.Length > 8192 || (info.Attributes & FileAttributes.ReparsePoint) != 0) continue;
                    using var record = JsonDocument.Parse(File.ReadAllText(file));
                    var doc = record.RootElement;
                    if (doc.GetProperty("format").GetInt32() != 1) continue;
                    var root = doc.GetProperty("root").GetString();
                    if (root is not null && Path.IsPathFullyQualified(root) && InstanceDiscovery.IsInstallation(root)) roots.Add(Normalize(root));
                }
                catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException or KeyNotFoundException or InvalidOperationException or FormatException or ArgumentException) { }
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
        return roots.Order(StringComparer.OrdinalIgnoreCase).ToArray();
    }
    public static string[] Discover(IEnumerable<string> knownRoots, string? directory = null)
    {
        var candidates = new HashSet<string>(Read(directory), StringComparer.OrdinalIgnoreCase);
        foreach (var root in knownRoots)
            try { if (Path.IsPathFullyQualified(root)) candidates.Add(Normalize(root)); } catch { }
        return candidates.Where(InstanceDiscovery.IsInstallation).Order(StringComparer.OrdinalIgnoreCase).ToArray();
    }
}
