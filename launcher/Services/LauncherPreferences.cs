using System.Text.Json;

namespace StrongholdProtocolLauncher.Services;

public sealed record LauncherPreferences(string? Root, int Port, string Mode)
{
    public static LauncherPreferences Default { get; } = new(null, 3000, "lan");
}

public static class PreferencesStore
{
    private static readonly string FilePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "StrongholdProtocol", "launcher.json");

    public static LauncherPreferences Load()
    {
        try
        {
            var saved = JsonSerializer.Deserialize<LauncherPreferences>(File.ReadAllText(FilePath));
            return saved is { Port: >= 1024 and <= 65435, Mode: "local" or "lan" or "tunnel" }
                ? saved
                : LauncherPreferences.Default;
        }
        catch
        {
            return LauncherPreferences.Default;
        }
    }

    public static void Save(LauncherPreferences preferences)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
            File.WriteAllText(FilePath, JsonSerializer.Serialize(preferences, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch
        {
            // The launcher remains usable when its per-user preferences cannot be saved.
        }
    }
}
