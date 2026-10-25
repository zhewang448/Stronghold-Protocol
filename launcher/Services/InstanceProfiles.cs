using System.Text.Json;

namespace StrongholdProtocolLauncher.Services;

public sealed record InstanceProfile(string Id, string Name, string Root, int Port, string Mode)
{
    public override string ToString() => $"{Name} · {Port}";
}
public sealed record InstanceSettings(string? SelectedId, List<InstanceProfile> Instances);

public static class InstanceProfiles
{
    public static string DefaultPath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "StrongholdProtocol", "instances.json");
    public static bool IsValid(InstanceProfile? p) => p is not null && !string.IsNullOrWhiteSpace(p.Id)
        && !string.IsNullOrWhiteSpace(p.Name) && Path.IsPathFullyQualified(p.Root ?? "")
        && p.Port is >= 1024 and <= 65435 && p.Mode is "local" or "lan" or "tunnel";
    public static InstanceSettings Load(string? file = null)
    {
        try
        {
            var value = JsonSerializer.Deserialize<InstanceSettings>(File.ReadAllText(file ?? DefaultPath));
            var profiles = (value?.Instances ?? []).Where(IsValid).DistinctBy(p => p.Id)
                .Select(p => p with { Name = InstanceNaming.NormalizeLegacyName(p.Name, p.Root) }).ToList();
            return new(profiles.Any(p => p.Id == value?.SelectedId) ? value!.SelectedId : profiles.FirstOrDefault()?.Id, profiles);
        }
        catch { return new(null, []); }
    }
    public static void Save(InstanceSettings settings, string? file = null)
    {
        if (settings.Instances.Any(p => !IsValid(p))) throw new IOException("Invalid instance profile.");
        file ??= DefaultPath;
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(file))!);
        var temporary = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
        try
        {
            File.WriteAllText(temporary, JsonSerializer.Serialize(settings, new JsonSerializerOptions { WriteIndented = true }));
            File.Move(temporary, file, true);
            // A profile save is authoritative only for this launcher. Keep discovery best-effort and independent.
            if (file == DefaultPath)
                foreach (var profile in settings.Instances)
                    try { InstanceIndex.Register(profile.Root, profile.Port); } catch (IOException) { } catch (UnauthorizedAccessException) { }
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
    public static int AvailablePort(IEnumerable<InstanceProfile> profiles, Func<int, bool> isBusy)
    {
        var occupied = profiles.SelectMany(p => new[] { p.Port, p.Port + 100 }).ToHashSet();
        for (var port = 3000; port <= 65435; port++)
            if (!occupied.Contains(port) && !occupied.Contains(port + 100) && !isBusy(port) && !isBusy(port + 100)) return port;
        throw new IOException("No available game/admin port pair.");
    }
    public static bool Conflicts(InstanceProfile candidate, IEnumerable<InstanceProfile> profiles)
        => profiles.Any(p => p.Id != candidate.Id && (p.Port == candidate.Port || p.Port + 100 == candidate.Port || p.Port == candidate.Port + 100));
}
