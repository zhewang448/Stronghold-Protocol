namespace StrongholdProtocolLauncher.Services;

public static class InstallationLocator
{
    public static bool IsProjectRoot(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return false;
        try
        {
            return File.Exists(Path.Combine(path, "package.json"))
                && File.Exists(Path.Combine(path, "server", "index.js"))
                && File.Exists(Path.Combine(path, "scripts", "launch.mjs"))
                && File.Exists(Path.Combine(path, "scripts", "host-launcher.mjs"));
        }
        catch
        {
            return false;
        }
    }

    public static string? FindRoot(params string?[] candidates)
    {
        foreach (var candidate in candidates)
        {
            if (string.IsNullOrWhiteSpace(candidate)) continue;
            string? current;
            try { current = Path.GetFullPath(candidate); }
            catch { continue; }
            for (var depth = 0; depth < 7 && current is not null; depth++)
            {
                if (IsProjectRoot(current)) return current;
                current = Directory.GetParent(current)?.FullName;
            }
        }
        return null;
    }
}
