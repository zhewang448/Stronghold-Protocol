using System.IO.Compression;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace StrongholdProtocolLauncher.Services;

public sealed record InstallProgress(string Stage, long Received = 0, long Total = 0);

// Fresh installs only. Direct HTTPS origin and release SHA256SUMS are required; no mirrors or checksum fallback.
public sealed class BootstrapInstaller(HttpClient http)
{
    public const string Repository = "zhewang448/Stronghold-Protocol";
    private const long MaxDownload = 4L * 1024 * 1024 * 1024;
    private const long MaxExtracted = 12L * 1024 * 1024 * 1024;
    public static string RuntimeDirectory => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "StrongholdProtocol", "runtime");
    public static HttpClient CreateClient()
    {
        var client = new HttpClient { Timeout = TimeSpan.FromMinutes(45) };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("StrongholdProtocolLauncher/2.0");
        return client;
    }
    public async Task<string> InstallAsync(string target, IProgress<InstallProgress>? progress = null, CancellationToken token = default)
    {
        target = Path.GetFullPath(target);
        if (File.Exists(target) || Directory.Exists(target) && Directory.EnumerateFileSystemEntries(target).Any()) throw new IOException("Choose an empty installation directory.");
        var parent = Path.GetDirectoryName(target) ?? throw new IOException("Invalid installation directory.");
        Directory.CreateDirectory(parent);
        RejectLinks(parent);
        if (Directory.Exists(target)) RejectLinks(target);
        var work = Path.Combine(parent, ".sp-install-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(work);
        try
        {
            progress?.Report(new("release"));
            using var releases = await JsonAsync($"https://api.github.com/repos/{Repository}/releases?per_page=30", token);
            var release = releases.RootElement.EnumerateArray().FirstOrDefault(r =>
                !r.GetProperty("draft").GetBoolean() && !r.GetProperty("prerelease").GetBoolean()
                && Regex.IsMatch(r.GetProperty("tag_name").GetString() ?? "", @"^v\d+\.\d+\.\d+-extended\.\d+$")
                && r.GetProperty("assets").EnumerateArray().Any(a => a.GetProperty("name").GetString() == "Stronghold-Protocol-" + r.GetProperty("tag_name").GetString() + "-assets.zip")
                && r.GetProperty("assets").EnumerateArray().Any(a => a.GetProperty("name").GetString() == "SHA256SUMS.txt"));
            if (release.ValueKind == JsonValueKind.Undefined) throw new IOException("No compatible full release with checksums is available.");
            var tag = release.GetProperty("tag_name").GetString()!;
            var name = "Stronghold-Protocol-" + tag + "-assets.zip";
            var assets = release.GetProperty("assets").EnumerateArray().ToArray();
            var asset = assets.First(a => a.GetProperty("name").GetString() == name);
            var sumsAsset = assets.First(a => a.GetProperty("name").GetString() == "SHA256SUMS.txt");
            var sums = await TextAsync(ReleaseUrl(sumsAsset, tag), token);
            var zip = Path.Combine(work, "game.zip");
            await DownloadAsync(ReleaseUrl(asset, tag), zip, "download", progress, token);
            progress?.Report(new("verify"));
            await VerifyAsync(zip, Checksum(sums, name), token);
            var stage = Path.Combine(work, "stage");
            await Task.Run(() => Extract(zip, stage, token), token);
            var root = FindRoot(stage);
            if (!InstallationLocator.IsProjectRoot(root)) throw new IOException("The release does not support this launcher.");
            await VerifyManifestAsync(root, tag, token);
            token.ThrowIfCancellationRequested();
            if (Directory.Exists(target))
            {
                if (Directory.EnumerateFileSystemEntries(target).Any()) throw new IOException("Installation directory is no longer empty.");
                Directory.Delete(target);
            }
            Directory.Move(root, target);
            progress?.Report(new("complete"));
            return target;
        }
        finally { if (Directory.Exists(work)) Directory.Delete(work, true); }
    }
    public async Task<string> EnsureRuntimeAsync(IProgress<InstallProgress>? progress = null, CancellationToken token = default, string? destination = null)
    {
        destination ??= RuntimeDirectory;
        var executable = Path.Combine(destination, "node.exe");
        if (File.Exists(executable)) return executable;
        var parent = Path.GetDirectoryName(destination)!;
        Directory.CreateDirectory(parent);
        RejectLinks(parent);
        var work = Path.Combine(parent, ".node-install-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(work);
        try
        {
            progress?.Report(new("runtime"));
            using var versions = await JsonAsync("https://nodejs.org/dist/index.json", token);
            // The newest patched Node 22 LTS matches the project's tested runtime major.
            var version = versions.RootElement.EnumerateArray().First(v => Regex.IsMatch(v.GetProperty("version").GetString() ?? "", @"^v22\.\d+\.\d+$")
                && v.GetProperty("lts").ValueKind == JsonValueKind.String).GetProperty("version").GetString()!;
            var name = $"node-{version}-win-x64.zip";
            var prefix = $"https://nodejs.org/dist/{version}/";
            var sums = await TextAsync(prefix + "SHASUMS256.txt", token);
            var zip = Path.Combine(work, "node.zip");
            await DownloadAsync(prefix + name, zip, "runtime", progress, token);
            await VerifyAsync(zip, Checksum(sums, name), token);
            var stage = Path.Combine(work, "stage");
            await Task.Run(() => Extract(zip, stage, token), token);
            var root = Path.Combine(stage, $"node-{version}-win-x64");
            if (!File.Exists(Path.Combine(root, "node.exe")) || !File.Exists(Path.Combine(root, "npm.cmd"))) throw new IOException("Invalid portable Node.js package.");
            token.ThrowIfCancellationRequested();
            if (Directory.Exists(destination))
            {
                if (File.Exists(executable)) return executable;
                throw new IOException("Portable runtime directory already exists; move it aside and retry.");
            }
            Directory.Move(root, destination);
            return executable;
        }
        finally { if (Directory.Exists(work)) Directory.Delete(work, true); }
    }
    public static string ReleaseUrl(JsonElement asset, string tag)
    {
        var raw = asset.GetProperty("browser_download_url").GetString()!;
        var uri = new Uri(raw);
        var expected = $"/{Repository}/releases/download/{tag}/{asset.GetProperty("name").GetString()}";
        if (uri.Scheme != "https" || uri.Host != "github.com" || !uri.IsDefaultPort || uri.UserInfo != "" || Uri.UnescapeDataString(uri.AbsolutePath) != expected || uri.Query != "" || uri.Fragment != "")
            throw new IOException("Release asset URL is outside the configured repository.");
        return raw;
    }
    public static string Checksum(string text, string name)
    {
        var matches = text.Split('\n').Select(line => Regex.Match(line.Trim(), @"^([a-fA-F0-9]{64})\s+\*?(.+)$"))
            .Where(m => m.Success && m.Groups[2].Value == name).ToArray();
        if (matches.Length != 1) throw new IOException("Missing or ambiguous SHA256 checksum: " + name);
        return matches[0].Groups[1].Value;
    }
    public static async Task VerifyAsync(string file, string expected, CancellationToken token = default)
    {
        await using var stream = File.OpenRead(file);
        var actual = Convert.ToHexString(await SHA256.HashDataAsync(stream, token));
        if (!actual.Equals(expected, StringComparison.OrdinalIgnoreCase)) throw new IOException("SHA256 verification failed: " + Path.GetFileName(file));
    }
    public static void Extract(string zip, string destination, CancellationToken token = default)
    {
        Directory.CreateDirectory(destination);
        var prefix = Path.GetFullPath(destination) + Path.DirectorySeparatorChar;
        using var archive = ZipFile.OpenRead(zip);
        if (archive.Entries.Count > 200000) throw new IOException("Too many archive entries.");
        long total = 0;
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var entry in archive.Entries)
        {
            token.ThrowIfCancellationRequested();
            total = checked(total + entry.Length);
            if (total > MaxExtracted || ((entry.ExternalAttributes >> 16) & 0xF000) == 0xA000 || (entry.ExternalAttributes & (int)FileAttributes.ReparsePoint) != 0) throw new IOException("Unsafe archive entry.");
            var name = entry.FullName.Replace('\\', '/');
            if (name.StartsWith('/') || name.Contains(':') || name.Split('/').Any(p => p is ".." or "." || p.EndsWith('.') || p.EndsWith(' ') || Regex.IsMatch(p, @"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)", RegexOptions.IgnoreCase))) throw new IOException("Unsafe archive path.");
            var target = Path.GetFullPath(Path.Combine(destination, name));
            if (!target.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) || !names.Add(target.TrimEnd(Path.DirectorySeparatorChar))) throw new IOException("Duplicate or escaping archive path.");
            if (name.EndsWith('/')) { Directory.CreateDirectory(target); continue; }
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            entry.ExtractToFile(target, false);
        }
    }
    private static void RejectLinks(string directory)
    {
        for (var current = new DirectoryInfo(directory); current is not null; current = current.Parent)
            if ((current.Attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("Installation path contains a link.");
    }
    private static string FindRoot(string stage)
    {
        for (var depth = 0; depth < 5; depth++)
        {
            if (File.Exists(Path.Combine(stage, "package.json"))) return stage;
            var children = Directory.GetDirectories(stage);
            if (children.Length != 1 || Directory.EnumerateFiles(stage).Any()) break;
            stage = children[0];
        }
        throw new IOException("Invalid release archive layout.");
    }
    private static async Task VerifyManifestAsync(string root, string tag, CancellationToken token)
    {
        using var manifest = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(root, "MANIFEST.json"), token));
        using var package = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(root, "package.json"), token));
        var app = manifest.RootElement.GetProperty("app").GetString();
        if (app != package.RootElement.GetProperty("version").GetString() || !tag.StartsWith("v" + app + "-extended.", StringComparison.Ordinal)) throw new IOException("Release version does not match its manifest.");
        var prefix = Path.GetFullPath(root) + Path.DirectorySeparatorChar;
        var listed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var property in manifest.RootElement.GetProperty("files").EnumerateObject())
        {
            var name = property.Name.Replace('\\', '/');
            var file = Path.GetFullPath(Path.Combine(root, name));
            if (Path.IsPathRooted(name) || name.Contains(':') || name.Split('/').Any(p => p is ".." or ".") || !file.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) || !listed.Add(name)) throw new IOException("Unsafe manifest path.");
            if (!File.Exists(file) || new FileInfo(file).Length != property.Value.GetProperty("size").GetInt64()) throw new IOException("Incomplete installation: " + name);
            await VerifyAsync(file, property.Value.GetProperty("sha256").GetString()!, token);
        }
        foreach (var required in new[] { "package.json", "server/index.js", "scripts/launch.mjs", "scripts/host-launcher.mjs" })
            if (!listed.Contains(required)) throw new IOException("Manifest omits required launcher file: " + required);
    }
    private async Task<JsonDocument> JsonAsync(string url, CancellationToken token) => JsonDocument.Parse(await TextAsync(url, token));
    private async Task<string> TextAsync(string url, CancellationToken token)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token);
        deadline.CancelAfter(TimeSpan.FromSeconds(45));
        token = deadline.Token;
        using var response = await http.GetAsync(url, token);
        response.EnsureSuccessStatusCode();
        if (response.Content.Headers.ContentLength > 16 * 1024 * 1024) throw new IOException("Metadata is too large.");
        return await response.Content.ReadAsStringAsync(token);
    }
    private async Task DownloadAsync(string url, string destination, string stage, IProgress<InstallProgress>? progress, CancellationToken token)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token);
        deadline.CancelAfter(TimeSpan.FromMinutes(2));
        token = deadline.Token;
        using var response = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, token);
        response.EnsureSuccessStatusCode();
        var length = response.Content.Headers.ContentLength ?? 0;
        if (length > MaxDownload) throw new IOException("Download exceeds package limit.");
        await using var input = await response.Content.ReadAsStreamAsync(token);
        await using var output = File.Create(destination);
        var buffer = new byte[128 * 1024];
        long received = 0;
        var last = Environment.TickCount64;
        int count;
        while ((count = await input.ReadAsync(buffer, token)) > 0)
        {
            deadline.CancelAfter(TimeSpan.FromMinutes(2));
            received += count;
            if (received > MaxDownload) throw new IOException("Download exceeds package limit.");
            await output.WriteAsync(buffer.AsMemory(0, count), token);
            if (Environment.TickCount64 - last > 200) { progress?.Report(new(stage, received, length)); last = Environment.TickCount64; }
        }
        if (length != 0 && received != length) throw new IOException("Incomplete download.");
        progress?.Report(new(stage, received, length));
    }
}
