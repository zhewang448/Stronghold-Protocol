using System.Text.Json;
using System.Text.RegularExpressions;

namespace StrongholdProtocolLauncher.Services;

public static class InstanceNaming
{
    public static string DirectoryName(int number)
    {
        if (number < 1) throw new ArgumentOutOfRangeException(nameof(number));
        return "server-" + number.ToString("D2", System.Globalization.CultureInfo.InvariantCulture);
    }

    public static string DefaultName(string root)
    {
        string? version = null;
        // Read release metadata as text; importing a directory never executes its JavaScript.
        try
        {
            var file = Path.Combine(root, "server", "release-version.js");
            if (File.Exists(file) && new FileInfo(file).Length <= 8192)
                version = Regex.Match(File.ReadAllText(file), @"(?m)^export\s+const\s+RELEASE_TAG\s*=\s*['""](v\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)['""]\s*;?\s*$").Groups[1].Value;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { }
        if (string.IsNullOrEmpty(version))
            try
            {
                var file = Path.Combine(root, "package.json");
                if (new FileInfo(file).Length <= 65536)
                {
                    using var json = JsonDocument.Parse(File.ReadAllText(file));
                    var app = json.RootElement.GetProperty("version").GetString();
                    if (Regex.IsMatch(app ?? "", @"^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$")) version = "v" + app;
                }
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException or KeyNotFoundException or InvalidOperationException) { }
        return "Stronghold Protocol" + (string.IsNullOrEmpty(version) ? "" : " · " + version);
    }

    public static string NormalizeLegacyName(string name, string root)
    {
        var leaf = Path.GetFileName(Path.TrimEndingDirectorySeparator(root));
        // Only migrate names created from generic build/transaction directory names. Keep user aliases verbatim.
        var automatic = name.Equals(leaf, StringComparison.OrdinalIgnoreCase)
            && (Regex.IsMatch(name, @"^server-\d+$", RegexOptions.IgnoreCase)
                || new[] { "MODIFIED_FILE", "BASELINE", "ROLLBACK_COPY", "PATCH_REPOSITORY", "PATCH_REBUILT", "real-installed" }.Contains(name, StringComparer.OrdinalIgnoreCase));
        return automatic ? DefaultName(root) : name;
    }
}
