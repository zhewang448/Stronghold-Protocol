using System.IO.Compression;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace StrongholdProtocolLauncher.Services;

public sealed record InstallProgress(string Stage, long Received = 0, long Total = 0);

// Fresh installs only. Direct HTTPS origin and release SHA256SUMS are required; no mirrors or checksum fallback.
public sealed class BootstrapInstaller(HttpClient http, string[]? releaseKeys = null)
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
                && (r.GetProperty("assets").EnumerateArray().Any(a => a.GetProperty("name").GetString() == "Stronghold-Protocol-" + r.GetProperty("tag_name").GetString() + "-assets.zip")
                    || (r.GetProperty("assets").EnumerateArray().Any(a => a.GetProperty("name").GetString() == "Stronghold-Protocol-" + r.GetProperty("tag_name").GetString() + "-lite.zip")
                        && r.GetProperty("assets").EnumerateArray().Any(a => a.GetProperty("name").GetString() == "Stronghold-Protocol-" + r.GetProperty("tag_name").GetString() + "-art-index.json")
                        && r.GetProperty("assets").EnumerateArray().Any(a => a.GetProperty("name").GetString() == "SHA256SUMS.txt.sig")))
                && r.GetProperty("assets").EnumerateArray().Any(a => a.GetProperty("name").GetString() == "SHA256SUMS.txt"));
            if (release.ValueKind == JsonValueKind.Undefined) throw new IOException("No compatible full release with checksums is available.");
            var tag = release.GetProperty("tag_name").GetString()!;
            var name = "Stronghold-Protocol-" + tag + "-assets.zip";
            var assets = release.GetProperty("assets").EnumerateArray().ToArray();
            var asset = assets.FirstOrDefault(a => a.GetProperty("name").GetString() == name);
            var sumsAsset = assets.First(a => a.GetProperty("name").GetString() == "SHA256SUMS.txt");
            var sums = await TextAsync(ReleaseUrl(sumsAsset, tag), token);
            var signatureAsset = assets.FirstOrDefault(a => a.GetProperty("name").GetString() == "SHA256SUMS.txt.sig");
            if (signatureAsset.ValueKind != JsonValueKind.Undefined)
            {
                var signature = await TextAsync(ReleaseUrl(signatureAsset, tag), token);
                LauncherSelfUpdate.VerifySums(tag, Encoding.UTF8.GetBytes(sums), Encoding.UTF8.GetBytes(signature), releaseKeys);
            }
            var zip = Path.Combine(work, "game.zip");
            var stage = Path.Combine(work, "stage");
            var root = await TrySplitAsync(assets, tag, sums, signatureAsset.ValueKind != JsonValueKind.Undefined,
                asset, work, stage, progress, token);
            if (root is null)
            {
                if (asset.ValueKind == JsonValueKind.Undefined) throw new IOException("No usable complete or split release is available.");
                if (Directory.Exists(stage)) Directory.Delete(stage, true);
                await DownloadAsync(ReleaseUrl(asset, tag), zip, "download", progress, token);
                progress?.Report(new("verify"));
                await VerifyAsync(zip, Checksum(sums, name), token);
                await Task.Run(() => Extract(zip, stage, token), token);
                root = FindRoot(stage);
            }
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

    private sealed record SplitFile(string Path, string Group, long Size, string Sha256, string? Source);
    private sealed record SplitPlan(string App, Dictionary<string, string> Groups, Dictionary<string, SplitFile> Files);

    private static SplitPlan ParseSplitIndex(string text, string tag)
    {
        using var document = JsonDocument.Parse(text);
        var index = document.RootElement;
        var app = index.GetProperty("app").GetString() ?? "";
        if (index.GetProperty("format").GetInt32() != 1 || index.GetProperty("tag").GetString() != tag
            || !tag.StartsWith("v" + app + "-extended.", StringComparison.Ordinal)) throw new IOException("Invalid asset index identity.");
        var groups = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var property in index.GetProperty("groups").EnumerateObject())
        {
            var name = property.Value.GetString() ?? "";
            if (property.Name is not ("common" or "local" or "fx") || name != $"Stronghold-Protocol-{tag}-{property.Name}-art.zip"
                || !groups.TryAdd(property.Name, name)) throw new IOException("Invalid asset group.");
        }
        var files = new Dictionary<string, SplitFile>(StringComparer.OrdinalIgnoreCase);
        long total = 0;
        foreach (var property in index.GetProperty("files").EnumerateObject())
        {
            var relative = property.Name;
            var group = property.Value.GetProperty("group").GetString() ?? "";
            var size = property.Value.GetProperty("size").GetInt64();
            var hash = property.Value.GetProperty("sha256").GetString() ?? "";
            var source = property.Value.TryGetProperty("source", out var sourceValue) ? sourceValue.GetString() : null;
            if (source is not null && (group != "common" || !Uri.TryCreate(source, UriKind.Absolute, out var uri)
                || uri.Scheme != "https" || uri.Host != "raw.githubusercontent.com" || !uri.IsDefaultPort
                || uri.UserInfo != "" || uri.Query != "" || uri.Fragment != "")) throw new IOException("Invalid asset source.");
            if (!ValidAssetPath(relative) || !groups.ContainsKey(group) || size < 0 || size > MaxExtracted
                || !Regex.IsMatch(hash, "^[a-f0-9]{64}$") || !files.TryAdd(relative, new(relative, group, size, hash, source)))
                throw new IOException("Invalid asset index entry.");
            total = checked(total + size);
            if (total > MaxExtracted || files.Count > 200000) throw new IOException("Asset index exceeds limits.");
        }
        if (!files.ContainsKey("data/assets.json")) throw new IOException("Asset index lacks the asset manifest.");
        return new(app, groups, files);
    }

    private static bool ValidAssetPath(string relative)
    {
        if (relative.Length is 0 or > 1024 || relative.StartsWith('/') || relative.Contains('\\')
            || relative.Any(character => character < 32 || ":*?\"<>|".Contains(character))) return false;
        if (relative.Split('/').Any(part => part.Length == 0 || part is "." or ".." || part == ".env"
            || part.StartsWith(".env.", StringComparison.Ordinal) || part.StartsWith(".venv", StringComparison.Ordinal)
            || part.EndsWith('.') || part.EndsWith(' ')
            || Regex.IsMatch(part, @"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)", RegexOptions.IgnoreCase))) return false;
        return relative.StartsWith("public/assets/", StringComparison.Ordinal) || relative.StartsWith("public/fonts/", StringComparison.Ordinal)
            || relative is "data/assets.json" or "data/local-assets.json" or "data/local-fx.json";
    }

    private static long AssetSize(JsonElement asset)
        => asset.ValueKind != JsonValueKind.Undefined && asset.TryGetProperty("size", out var size) && size.TryGetInt64(out var length)
            && length > 0 && length <= MaxDownload ? length : -1;

    private async Task<string?> TrySplitAsync(JsonElement[] assets, string tag, string sums, bool signed, JsonElement full,
        string work, string stage, IProgress<InstallProgress>? progress, CancellationToken token)
    {
        var liteName = $"Stronghold-Protocol-{tag}-lite.zip";
        var indexName = $"Stronghold-Protocol-{tag}-art-index.json";
        var lite = assets.FirstOrDefault(asset => asset.GetProperty("name").GetString() == liteName);
        var indexAsset = assets.FirstOrDefault(asset => asset.GetProperty("name").GetString() == indexName);
        if (!signed || lite.ValueKind == JsonValueKind.Undefined || indexAsset.ValueKind == JsonValueKind.Undefined) return null;
        try
        {
            var indexText = await TextAsync(ReleaseUrl(indexAsset, tag), token, 32 * 1024 * 1024);
            var actual = LauncherSelfUpdate.Hash(Encoding.UTF8.GetBytes(indexText));
            if (!actual.Equals(Checksum(sums, indexName), StringComparison.OrdinalIgnoreCase)) throw new IOException("Asset index checksum failed.");
            var plan = ParseSplitIndex(indexText, tag);
            var groups = plan.Groups.Where(group => plan.Files.Values.Any(file => file.Group == group.Key))
                .Select(group => (Group: group.Key, Name: group.Value,
                    Asset: assets.FirstOrDefault(asset => asset.GetProperty("name").GetString() == group.Value))).ToArray();
            var splitSize = AssetSize(lite);
            if (splitSize < 0 || groups.Any(group => AssetSize(group.Asset) < 0)) return null;
            foreach (var group in groups)
            {
                var files = plan.Files.Values.Where(file => file.Group == group.Group && file.Path != "data/assets.json").ToArray();
                var sourceSize = files.Aggregate(0L, (sum, file) => checked(sum + file.Size));
                var sources = group.Group == "common" && files.Length <= 64 && sourceSize <= 128 * 1024 * 1024
                    && files.All(file => file.Source is not null && file.Size <= 32 * 1024 * 1024);
                splitSize = checked(splitSize + (sources ? Math.Min(sourceSize, AssetSize(group.Asset)) : AssetSize(group.Asset)));
            }
            var fullSize = AssetSize(full);
            if (fullSize > 0 && splitSize >= fullSize) return null;
            var zip = Path.Combine(work, "split.zip");
            await DownloadAsync(ReleaseUrl(lite, tag), zip, "download", progress, token);
            await VerifyAsync(zip, Checksum(sums, liteName), token);
            await Task.Run(() => Extract(zip, stage, token), token);
            var root = FindRoot(stage);
            await VerifyManifestAsync(root, tag, token);
            using (var package = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(root, "package.json"), token)))
                if (package.RootElement.GetProperty("version").GetString() != plan.App) throw new IOException("Asset index version differs from game.");
            foreach (var group in groups)
            {
                var pending = new List<SplitFile>();
                foreach (var file in plan.Files.Values.Where(file => file.Group == group.Group))
                {
                    var local = Path.Combine(root, file.Path.Replace('/', Path.DirectorySeparatorChar));
                    if (!File.Exists(local) || new FileInfo(local).Length != file.Size) { pending.Add(file); continue; }
                    try { await VerifyAsync(local, file.Sha256, token); }
                    catch (IOException) { pending.Add(file); }
                }
                if (pending.Count == 0) continue;
                var sourceSize = pending.Aggregate(0L, (sum, file) => checked(sum + file.Size));
                if (group.Group == "common" && pending.Count <= 64 && sourceSize < AssetSize(group.Asset)
                    && sourceSize <= 128 * 1024 * 1024 && pending.All(file => file.Source is not null && file.Size <= 32 * 1024 * 1024))
                {
                    try
                    {
                        foreach (var file in pending)
                        {
                            var destination = Path.Combine(root, file.Path.Replace('/', Path.DirectorySeparatorChar));
                            Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
                            await DownloadAsync(file.Source!, destination, "download", progress, token, file.Size);
                            await VerifyAsync(destination, file.Sha256, token);
                        }
                        continue;
                    }
                    catch (Exception error) when (error is IOException or HttpRequestException)
                    {
                        token.ThrowIfCancellationRequested();
                    }
                    catch (OperationCanceledException) when (!token.IsCancellationRequested) { }
                }
                if (fullSize > 0 && AssetSize(group.Asset) >= fullSize) return null;
                await DownloadAsync(ReleaseUrl(group.Asset, tag), zip, "download", progress, token);
                await VerifyAsync(zip, Checksum(sums, group.Name), token);
                var groupStage = Path.Combine(work, "group-" + group.Group);
                await Task.Run(() => Extract(zip, groupStage, token), token);
                await MergeGroupAsync(groupStage, root, plan, group.Group, token);
            }
            await VerifyAssetsAsync(root, plan, token);
            return root;
        }
        catch (Exception error) when (error is IOException or HttpRequestException or JsonException or InvalidOperationException
            or KeyNotFoundException or FormatException or OverflowException)
        {
            token.ThrowIfCancellationRequested();
            if (full.ValueKind == JsonValueKind.Undefined) throw new IOException("Split installation failed and no full package is available.", error);
            return null;
        }
        catch (OperationCanceledException error) when (!token.IsCancellationRequested)
        {
            if (full.ValueKind == JsonValueKind.Undefined) throw new IOException("Split installation timed out and no full package is available.", error);
            return null;
        }
    }

    private static async Task MergeGroupAsync(string groupStage, string root, SplitPlan plan, string group, CancellationToken token)
    {
        var source = Path.Combine(groupStage, "Stronghold-Protocol");
        if (!Directory.Exists(source) || Directory.GetFiles(groupStage).Length != 0
            || Directory.GetDirectories(groupStage).Length != 1) throw new IOException("Invalid asset archive layout.");
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var file in Directory.EnumerateFiles(source, "*", SearchOption.AllDirectories))
        {
            token.ThrowIfCancellationRequested();
            var relative = Path.GetRelativePath(source, file).Replace('\\', '/');
            if (!plan.Files.TryGetValue(relative, out var expected) || expected.Path != relative || expected.Group != group
                || !seen.Add(relative) || new FileInfo(file).Length != expected.Size) throw new IOException("Unexpected asset archive file: " + relative);
            await VerifyAsync(file, expected.Sha256, token);
            var destination = Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar));
            Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
            File.Copy(file, destination, true);
        }
        if (plan.Files.Values.Any(file => file.Group == group && !seen.Contains(file.Path))) throw new IOException("Asset archive is incomplete.");
    }

    private static async Task VerifyAssetsAsync(string root, SplitPlan plan, CancellationToken token)
    {
        foreach (var expected in plan.Files.Values)
        {
            token.ThrowIfCancellationRequested();
            var file = Path.Combine(root, expected.Path.Replace('/', Path.DirectorySeparatorChar));
            if (!File.Exists(file) || new FileInfo(file).Length != expected.Size) throw new IOException("Asset is missing: " + expected.Path);
            await VerifyAsync(file, expected.Sha256, token);
        }
        foreach (var relative in new[] { "data/assets.json", "data/local-assets.json", "data/local-fx.json" })
        {
            if (!plan.Files.ContainsKey(relative)) continue;
            using var document = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar)), token));
            VerifyAssetReferences(document.RootElement, plan.Files);
        }
    }

    private static void VerifyAssetReferences(JsonElement value, Dictionary<string, SplitFile> files)
    {
        if (value.ValueKind == JsonValueKind.Object)
            foreach (var property in value.EnumerateObject()) VerifyAssetReferences(property.Value, files);
        else if (value.ValueKind == JsonValueKind.Array)
            foreach (var item in value.EnumerateArray()) VerifyAssetReferences(item, files);
        else if (value.ValueKind == JsonValueKind.String)
        {
            var reference = value.GetString() ?? "";
            if (!reference.StartsWith("/assets/", StringComparison.Ordinal) && !reference.StartsWith("/fonts/", StringComparison.Ordinal)) return;
            var relative = "public/" + string.Join('/', reference.Split('/').Where(part => part.Length > 0).Select(Uri.UnescapeDataString));
            if (!files.ContainsKey(relative)) throw new IOException("Asset reference is missing: " + relative);
        }
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
    private async Task<string> TextAsync(string url, CancellationToken token, int maximum = 16 * 1024 * 1024)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token);
        deadline.CancelAfter(TimeSpan.FromSeconds(45));
        token = deadline.Token;
        using var response = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, token);
        response.EnsureSuccessStatusCode();
        if (response.Content.Headers.ContentLength > maximum) throw new IOException("Metadata is too large.");
        await using var input = await response.Content.ReadAsStreamAsync(token);
        using var output = new MemoryStream();
        var buffer = new byte[65536];
        int count;
        while ((count = await input.ReadAsync(buffer, token)) > 0)
        {
            if (output.Length + count > maximum) throw new IOException("Metadata is too large.");
            output.Write(buffer, 0, count);
        }
        return Encoding.UTF8.GetString(output.ToArray());
    }
    private async Task DownloadAsync(string url, string destination, string stage, IProgress<InstallProgress>? progress, CancellationToken token, long? expectedSize = null)
    {
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token);
        deadline.CancelAfter(TimeSpan.FromMinutes(2));
        token = deadline.Token;
        using var response = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, token);
        response.EnsureSuccessStatusCode();
        var length = response.Content.Headers.ContentLength ?? 0;
        if (length > MaxDownload || (expectedSize.HasValue && length > expectedSize.Value)) throw new IOException("Download exceeds package limit.");
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
            if (received > MaxDownload || (expectedSize.HasValue && received > expectedSize.Value)) throw new IOException("Download exceeds package limit.");
            await output.WriteAsync(buffer.AsMemory(0, count), token);
            if (Environment.TickCount64 - last > 200) { progress?.Report(new(stage, received, length)); last = Environment.TickCount64; }
        }
        if ((length != 0 && received != length) || (expectedSize.HasValue && received != expectedSize.Value)) throw new IOException("Incomplete download.");
        progress?.Report(new(stage, received, length));
    }
}
