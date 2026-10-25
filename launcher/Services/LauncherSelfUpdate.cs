using System.Diagnostics;
using System.IO.Compression;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using NSec.Cryptography;

namespace StrongholdProtocolLauncher.Services;

public sealed record LauncherRelease(string Tag, string Version, string Asset, string Url, string SumsUrl, string SignatureUrl);
public sealed record SelfUpdatePlan(int Format, string Target, string OriginalHash, int ParentPid, long ParentStart,
    string Tag, string Asset, string Version, string PayloadHash);

/// <summary>Standalone updater. Release signatures use the same tag-bound Ed25519 protocol as the console.</summary>
public sealed class LauncherSelfUpdate(HttpClient http)
{
    public const string Repository = "zhewang448/Stronghold-Protocol";
    public const string ExecutableName = "StrongholdProtocolLauncher.exe";
    public static readonly string[] PublicKeys = ["MCowBQYDK2VwAyEA46g58eTNlxwo1xbSghcO8reDiVV+EHUWfZ+6eN+jvjk="];
    public static string WorkDirectory => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "StrongholdProtocol", "launcher-updates");
    private const int MaxZip = 160 * 1024 * 1024;
    public static Version CurrentVersion => typeof(LauncherSelfUpdate).Assembly.GetName().Version ?? new Version(1, 0, 0);
    public static HttpClient CreateClient()
    {
        var client = new HttpClient { Timeout = TimeSpan.FromMinutes(15) };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("StrongholdProtocolLauncher/" + CurrentVersion.ToString(3));
        return client;
    }
    private static bool ValidTag(string tag) => Regex.IsMatch(tag, @"^v\d+\.\d+\.\d+(?:-extended\.\d+)?$");
    public static string AssetUrl(string tag, string name, string url)
    {
        if (!ValidTag(tag) || name.Contains('/') || name.Contains('\\')) throw new IOException("Invalid release identity.");
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme != "https" || uri.Host != "github.com"
            || uri.UserInfo != "" || uri.Query != "" || uri.Fragment != ""
            || uri.AbsolutePath != "/" + Repository + "/releases/download/" + tag + "/" + name) throw new IOException("Invalid release download URL.");
        return uri.AbsoluteUri;
    }
    private async Task<byte[]> GetAsync(string url, int maximum, CancellationToken token, IProgress<InstallProgress>? progress = null)
    {
        using var response = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, token);
        response.EnsureSuccessStatusCode();
        if (response.Content.Headers.ContentLength > maximum) throw new IOException("Download exceeds size limit.");
        var final = response.RequestMessage?.RequestUri;
        if (final is not null && (final.Scheme != "https" || !(final.Host is "github.com" or "api.github.com" or "release-assets.githubusercontent.com" or "objects.githubusercontent.com"))) throw new IOException("Unexpected download origin.");
        await using var input = await response.Content.ReadAsStreamAsync(token);
        using var output = new MemoryStream(); var buffer = new byte[65536]; int read;
        while ((read = await input.ReadAsync(buffer, token)) > 0)
        {
            if (output.Length + read > maximum) throw new IOException("Download exceeds size limit.");
            output.Write(buffer, 0, read); progress?.Report(new("download", output.Length, response.Content.Headers.ContentLength ?? 0));
        }
        return output.ToArray();
    }
    public async Task<LauncherRelease?> CheckAsync(Version installed, CancellationToken token = default)
    {
        var bytes = await GetAsync("https://api.github.com/repos/" + Repository + "/releases?per_page=30", 4 * 1024 * 1024, token);
        using var doc = JsonDocument.Parse(bytes); var releases = new List<LauncherRelease>();
        foreach (var release in doc.RootElement.EnumerateArray())
        {
            if (release.GetProperty("draft").GetBoolean() || release.GetProperty("prerelease").GetBoolean()) continue;
            var tag = release.GetProperty("tag_name").GetString() ?? ""; if (!ValidTag(tag)) continue;
            var assets = release.GetProperty("assets").EnumerateArray().ToArray();
            var sums = assets.FirstOrDefault(a => a.GetProperty("name").GetString() == "SHA256SUMS.txt");
            var sig = assets.FirstOrDefault(a => a.GetProperty("name").GetString() == "SHA256SUMS.txt.sig");
            if (sums.ValueKind == JsonValueKind.Undefined || sig.ValueKind == JsonValueKind.Undefined) continue;
            foreach (var asset in assets)
            {
                var name = asset.GetProperty("name").GetString() ?? "";
                var match = Regex.Match(name, @"^StrongholdProtocolLauncher-v(\d+\.\d+\.\d+)-win-x64\.zip$");
                if (!match.Success || !Version.TryParse(match.Groups[1].Value, out var version) || version <= installed) continue;
                releases.Add(new(tag, version.ToString(3), name, AssetUrl(tag, name, asset.GetProperty("browser_download_url").GetString()!),
                    AssetUrl(tag, "SHA256SUMS.txt", sums.GetProperty("browser_download_url").GetString()!), AssetUrl(tag, "SHA256SUMS.txt.sig", sig.GetProperty("browser_download_url").GetString()!)));
            }
        }
        return releases.OrderByDescending(r => Version.Parse(r.Version)).FirstOrDefault();
    }
    public static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    public static void VerifyRelease(string tag, string asset, byte[] sums, byte[] signature, byte[] zip, string[]? keys = null)
    {
        if (!ValidTag(tag) || sums.Length > 1024 * 1024 || signature.Length > 1024 || zip.Length > MaxZip) throw new IOException("Invalid update metadata.");
        byte[] sig;
        try { sig = Convert.FromBase64String(Encoding.UTF8.GetString(signature).Trim()); } catch (FormatException e) { throw new IOException("Invalid release signature.", e); }
        if (sig.Length != 64) throw new IOException("Invalid release signature.");
        var message = Encoding.UTF8.GetBytes("stronghold-protocol-release\n" + tag + "\n").Concat(sums).ToArray();
        var valid = false;
        foreach (var key in keys ?? PublicKeys)
            try
            {
                var der = Convert.FromBase64String(key);
                if (der.Length != 44 || !der.AsSpan(0,12).SequenceEqual(Convert.FromHexString("302A300506032B6570032100"))) continue;
                var publicKey = PublicKey.Import(SignatureAlgorithm.Ed25519, der.AsSpan(12), KeyBlobFormat.RawPublicKey);
                if (SignatureAlgorithm.Ed25519.Verify(publicKey, message, sig)) { valid = true; break; }
            }
            catch (Exception e) when (e is FormatException or ArgumentException) { }
        if (!valid) throw new IOException("Release signature verification failed.");
        var matches = Encoding.UTF8.GetString(sums).Split('\n').Select(line => Regex.Match(line.TrimEnd('\r'), @"^([a-fA-F0-9]{64})  (.+)$"))
            .Where(m => m.Success && m.Groups[2].Value == asset).ToArray();
        if (matches.Length != 1 || !Hash(zip).Equals(matches[0].Groups[1].Value, StringComparison.OrdinalIgnoreCase)) throw new IOException("Launcher archive SHA256 verification failed.");
    }
    public static byte[] ExtractExecutable(byte[] archive)
    {
        using var input = new MemoryStream(archive); using var zip = new ZipArchive(input, ZipArchiveMode.Read);
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase); byte[]? exe = null; long expanded = 0;
        foreach (var entry in zip.Entries)
        {
            var parts = entry.FullName.Split('/');
            if (parts.Length > 2 || parts.Any(p => p is "" or "." or ".." || p.Contains('\\') || p.Contains(':')) || !names.Add(parts[^1])) throw new IOException("Invalid launcher archive path.");
            if (((entry.ExternalAttributes >> 16) & 0xF000) == 0xA000 || (expanded += entry.Length) > 170L * 1024 * 1024) throw new IOException("Invalid launcher archive entry.");
            if (parts[^1] == ExecutableName)
            {
                if (entry.Length < 64 || entry.Length > MaxZip) throw new IOException("Invalid launcher executable size.");
                using var stream = entry.Open(); using var bytes = new MemoryStream(); stream.CopyTo(bytes); exe = bytes.ToArray();
            }
            else if (!Regex.IsMatch(parts[^1], @"^(?:README\.(md|txt)|THIRD-PARTY-NOTICES\.md)$", RegexOptions.IgnoreCase)) throw new IOException("Unexpected launcher archive entry.");
        }
        if (exe is null || exe[0] != 'M' || exe[1] != 'Z') throw new IOException("Launcher executable missing or invalid.");
        var offset = BitConverter.ToInt32(exe,60);
        if (offset < 0 || offset > exe.Length - 4 || !exe.AsSpan(offset,4).SequenceEqual(new byte[]{80,69,0,0})) throw new IOException("Invalid Windows executable.");
        return exe;
    }
    public async Task<string> PrepareAsync(LauncherRelease release, string target, IProgress<InstallProgress>? progress = null,
        CancellationToken token = default, string? parentDirectory = null, string[]? keys = null)
    {
        ValidateTarget(target);
        AssetUrl(release.Tag,release.Asset,release.Url);AssetUrl(release.Tag,"SHA256SUMS.txt",release.SumsUrl);AssetUrl(release.Tag,"SHA256SUMS.txt.sig",release.SignatureUrl);
        var sums = await GetAsync(release.SumsUrl, 1024 * 1024, token);
        var signature = await GetAsync(release.SignatureUrl, 1024, token);
        var zip = await GetAsync(release.Url, MaxZip, token, progress);
        VerifyRelease(release.Tag, release.Asset, sums, signature, zip, keys);
        var exe = ExtractExecutable(zip); token.ThrowIfCancellationRequested();
        var parent = parentDirectory ?? WorkDirectory; Directory.CreateDirectory(parent);
        var work = Path.Combine(parent,"update-"+Guid.NewGuid().ToString("N")); Directory.CreateDirectory(work);
        try
        {
            File.WriteAllBytes(Path.Combine(work,"release.zip"),zip); File.WriteAllBytes(Path.Combine(work,"SHA256SUMS.txt"),sums); File.WriteAllBytes(Path.Combine(work,"SHA256SUMS.txt.sig"),signature);
            File.WriteAllBytes(Path.Combine(work,ExecutableName),exe);
            using var current = Process.GetCurrentProcess();
            var plan = new SelfUpdatePlan(1,Path.GetFullPath(target),Hash(File.ReadAllBytes(target)),Environment.ProcessId,current.StartTime.ToUniversalTime().Ticks,release.Tag,release.Asset,release.Version,Hash(exe));
            var manifest = Path.Combine(work,"update.json");File.WriteAllText(manifest,JsonSerializer.Serialize(plan));return manifest;
        }
        catch { Directory.Delete(work,true);throw; }
    }
    public static void ValidateTarget(string target)
    {
        if (!Path.IsPathFullyQualified(target) || Path.GetFileName(target) != ExecutableName || !File.Exists(target)) throw new IOException("Invalid current launcher path.");
        for (var info = new FileInfo(target) as FileSystemInfo; info is not null; info = info is FileInfo f ? f.Directory : ((DirectoryInfo)info).Parent)
            if ((info.Attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("Linked launcher path is not supported.");
    }
    public static async Task LaunchHelperAsync(string manifest)
    {
        var executable = Environment.ProcessPath ?? throw new IOException("Current executable path unavailable.");
        var helper = Path.Combine(Path.GetDirectoryName(manifest)!,"update-helper.exe");File.Copy(executable,helper,true);
        var info = new ProcessStartInfo(helper){UseShellExecute=false,CreateNoWindow=true};info.ArgumentList.Add("--apply-self-update");info.ArgumentList.Add(manifest);
        using var process = Process.Start(info) ?? throw new IOException("Could not start update helper.");
        var ready=Path.Combine(Path.GetDirectoryName(manifest)!,"ready");
        for(var i=0;i<100;i++)
        {
            if(File.Exists(ready))return;
            if(process.HasExited)throw new IOException("Update helper could not verify its prepared update.");
            await Task.Delay(100);
        }
        if(!process.HasExited)process.Kill();
        throw new IOException("Update helper did not become ready; original launcher stays open.");
    }
    public static async Task<int> ApplyAsync(string manifest, string[]? keys = null, bool waitForParent = true, Func<string,bool>? restart = null)
    {
        var work=Path.GetDirectoryName(Path.GetFullPath(manifest))!;
        SelfUpdatePlan? plan=null; var replaced=false; FileStream? lease=null;
        var backup=Path.Combine(work,"previous.exe");
        try
        {
            if(new FileInfo(manifest).Length>8192 || (File.GetAttributes(manifest)&FileAttributes.ReparsePoint)!=0)throw new IOException("Invalid update plan.");
            plan=JsonSerializer.Deserialize<SelfUpdatePlan>(File.ReadAllText(manifest))??throw new IOException("Invalid update plan.");
            if(plan.Format!=1 || !Regex.IsMatch(plan.OriginalHash,"^[a-f0-9]{64}$") || !Regex.IsMatch(plan.PayloadHash,"^[a-f0-9]{64}$")
                || !Regex.IsMatch(plan.Asset,@"^StrongholdProtocolLauncher-v\d+\.\d+\.\d+-win-x64\.zip$"))throw new IOException("Invalid update identity.");
            ValidateTarget(plan.Target);
            if(Path.GetFullPath(plan.Target).StartsWith(work+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))throw new IOException("Update target overlaps staging directory.");
            foreach(var name in new[]{"release.zip","SHA256SUMS.txt","SHA256SUMS.txt.sig"})
            {var file=Path.Combine(work,name);if((File.GetAttributes(file)&FileAttributes.ReparsePoint)!=0 || new FileInfo(file).Length>MaxZip)throw new IOException("Invalid prepared update file.");}
            var zip=File.ReadAllBytes(Path.Combine(work,"release.zip"));
            VerifyRelease(plan.Tag,plan.Asset,File.ReadAllBytes(Path.Combine(work,"SHA256SUMS.txt")),File.ReadAllBytes(Path.Combine(work,"SHA256SUMS.txt.sig")),zip,keys);
            var payload=ExtractExecutable(zip);if(Hash(payload)!=plan.PayloadHash)throw new IOException("Prepared launcher bytes changed.");
            File.WriteAllText(Path.Combine(work,"ready"),"verified");
            if(waitForParent)
                try
                {
                    using var parent=Process.GetProcessById(plan.ParentPid);
                    if(parent.StartTime.ToUniversalTime().Ticks!=plan.ParentStart)throw new IOException("Parent process identity changed.");
                    using var timeout=new CancellationTokenSource(TimeSpan.FromMinutes(2));await parent.WaitForExitAsync(timeout.Token);
                }
                catch(ArgumentException){ }
            lease=new FileStream(plan.Target+".update.lock",FileMode.CreateNew,FileAccess.ReadWrite,FileShare.None);
            lease.Write(Encoding.ASCII.GetBytes(Environment.ProcessId.ToString()));lease.Flush();
            if(Hash(File.ReadAllBytes(plan.Target))!=plan.OriginalHash)throw new IOException("Current launcher changed; refusing overwrite.");
            File.Copy(plan.Target,backup,true);
            var temporary=plan.Target+".self-update.tmp";
            try { File.WriteAllBytes(temporary,payload);File.Move(temporary,plan.Target,true);replaced=true; }
            finally { if(File.Exists(temporary))File.Delete(temporary); }
            if(Hash(File.ReadAllBytes(plan.Target))!=plan.PayloadHash)throw new IOException("Installed launcher verification failed.");
            if(restart is null)
            {
                using var launched=Process.Start(new ProcessStartInfo(plan.Target){UseShellExecute=false,WorkingDirectory=Path.GetDirectoryName(plan.Target)!})??throw new IOException("Could not reopen launcher.");
                await Task.Delay(1500);if(launched.HasExited)throw new IOException("Updated launcher exited during startup.");
            }
            else if(!restart(plan.Target))throw new IOException("Updated launcher failed to restart.");
            File.WriteAllText(Path.Combine(work,"result.json"),JsonSerializer.Serialize(new{state="installed",plan.Version,plan.Target}));return 0;
        }
        catch(Exception error)
        {
            if(replaced && plan is not null)
                try { File.Copy(backup,plan.Target,true); }
                catch(Exception restore) { File.WriteAllText(Path.Combine(work,"result.json"),JsonSerializer.Serialize(new{state="recovery-required",error=error.Message,restore=restore.Message,backup}));return 2; }
            File.WriteAllText(Path.Combine(work,"result.json"),JsonSerializer.Serialize(new{state="failed",error=error.Message,restored=replaced}));return 1;
        }
        finally { if(lease is not null){lease.Dispose();if(plan is not null)File.Delete(plan.Target+".update.lock");} }
    }
}
