using System.IO.Compression;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using StrongholdProtocolLauncher.Services;

#if BOOTSTRAP
if (args.Length == 1 && args[0] == "--split-install")
{
#if SELF_UPDATE
    await LauncherSplitInstallChecks.Run();
#else
    Console.WriteLine("RESULT split_install=false checks=0");
#endif
    return;
}
if (args.Length == 1 && args[0] == "--self-update")
{
#if SELF_UPDATE
    await LauncherSelfUpdateChecks.Run();
#else
    Console.WriteLine("RESULT self_update=false checks=0");
#endif
    return;
}
if (args.Length == 1 && args[0] == "--launcher-location")
{
#if LAUNCHER_LOCATION
    var locationWork = Path.Combine(Path.GetTempPath(), "sp-location-" + Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(Path.Combine(locationWork, "server")); Directory.CreateDirectory(Path.Combine(locationWork, "scripts"));
    try
    {
        foreach (var file in new[] { "package.json", "server/index.js", "scripts/launch.mjs", "scripts/host-launcher.mjs" }) File.WriteAllText(Path.Combine(locationWork, file), "fixture");
        var exe = Path.Combine(locationWork, "StrongholdProtocolLauncher.exe"); File.WriteAllText(exe, "test executable bytes");
        LauncherLocation.Register(locationWork, exe);
        using var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(locationWork, "logs/launcher-location.json")));
        if (doc.RootElement.GetProperty("path").GetString() != exe || doc.RootElement.GetProperty("sha256").GetString() != Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(exe))).ToLowerInvariant()) throw new Exception("Location/hash mismatch");
        Console.WriteLine("RESULT launcher_location=true exact_path_and_hash=true");
    }
    finally { Directory.Delete(locationWork, true); }
#else
    Console.WriteLine("RESULT launcher_location=false");
#endif
    return;
}
if (args.Length == 1 && args[0] == "--naming")
{
#if INSTANCE_NAMING
    InstanceNamingChecks.Run();
#else
    Console.WriteLine("RESULT standardized_names=false checks=0");
#endif
    return;
}
if (args.Length == 1 && args[0] == "--file-discovery")
{
#if DISCOVERY
    Console.WriteLine("RESULT file_scan=" + (typeof(InstanceDiscovery).GetMethod("Scan") is not null).ToString().ToLowerInvariant());
#else
    Console.WriteLine("RESULT file_scan=false");
#endif
    return;
}
if (args.Length == 1 && args[0] == "--live-discovery")
{
#if LIVE_DISCOVERY
    await LiveInstanceChecks.Run();
#else
    Console.WriteLine("RESULT live_ports=false checks=0");
#endif
    return;
}
#if LIVE_DISCOVERY
if (args.Length == 1 && args[0] == "--discover-live-device")
{
    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
    var inventory = await LiveInstanceDiscovery.InventoryAsync(timeout.Token);
    Console.WriteLine(JsonSerializer.Serialize(await LiveInstanceDiscovery.DiscoverAsync(inventory, token:timeout.Token)));
    return;
}
#endif
if (args.Length == 1 && args[0] == "--instance-index")
{
#if INSTANCE_INDEX
    await InstanceIndexChecks.Run();
#else
    Console.WriteLine("RESULT indexed=false automatic_registration=false checks=0");
#endif
    return;
}
#if INSTANCE_INDEX
if (args.Length == 2 && args[0] == "--read-instance-index")
{
    Console.WriteLine(JsonSerializer.Serialize(InstanceIndex.Read(args[1])));
    return;
}
#endif
if (args.Length == 1 && args[0] == "--instance-management")
{
#if DISCOVERY
    await InstanceManagementChecks.Run();
#else
    Console.WriteLine("RESULT discover=false delete=false checks=0");
#endif
    return;
}
if (args.Length == 3 && args[0] == "--real-archive")
{
    using var handler = new ArchiveHandler(args[1]);
    using var client = new HttpClient(handler) { Timeout = TimeSpan.FromMinutes(15) };
    client.DefaultRequestHeaders.UserAgent.ParseAdd("StrongholdProtocolLauncher/2.0");
    var installed = await new BootstrapInstaller(client).InstallAsync(args[2]);
    Console.WriteLine("REAL_ARCHIVE installed=" + installed + " valid=" + InstallationLocator.IsProjectRoot(installed));
    return;
}
if (args.Length == 2 && args[0] == "--real-runtime")
{
    using var client = BootstrapInstaller.CreateClient();
    var installed = await new BootstrapInstaller(client).EnsureRuntimeAsync(destination:args[1]);
    Console.WriteLine("REAL_RUNTIME executable=" + installed);
    return;
}
var work = Path.Combine(Path.GetTempPath(), "sp-launcher-native-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(work);
var passed = 0;
void Check(bool condition, string name) { if (!condition) throw new Exception(name); Console.WriteLine("PASS " + name); passed++; }
async Task Reject(Func<Task> action, string name)
{
    try { await action(); } catch (Exception e) when (e is IOException or OperationCanceledException) { Check(true, name); return; }
    throw new Exception("Expected rejection: " + name);
}
byte[] Zip(Dictionary<string, byte[]> files)
{
    using var bytes = new MemoryStream();
    using (var archive = new ZipArchive(bytes, ZipArchiveMode.Create, true))
        foreach (var pair in files) { using var output = archive.CreateEntry(pair.Key).Open(); output.Write(pair.Value); }
    return bytes.ToArray();
}
string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
try
{
    var one = new InstanceProfile("one", "First", Path.Combine(work, "one"), 3000, "local");
    var two = new InstanceProfile("two", "Second", Path.Combine(work, "two"), 3001, "lan");
    var config = Path.Combine(work, "instances.json");
    InstanceProfiles.Save(new("two", [one, two]), config);
    var loaded = InstanceProfiles.Load(config);
    Check(loaded.SelectedId == "two" && loaded.Instances.SequenceEqual(new[] { one, two }), "two instances retain independent roots, ports, modes and selected ID");
    Check(InstanceProfiles.AvailablePort([one], p => p == 3001 || p == 3102) == 3003, "allocation checks both game/admin listeners and reserved pairs");
    Check(InstanceProfiles.Conflicts(two with { Port = 3100 }, [one, two]) && !InstanceProfiles.Conflicts(two, [one, two]), "crossed game/admin port conflict is rejected");
    File.WriteAllText(config, "broken");
    Check(InstanceProfiles.Load(config).Instances.Count == 0, "corrupt profile settings recover without touching servers");
    var tag = "v0.3.1-extended.999";
    var name = "Stronghold-Protocol-" + tag + "-assets.zip";
    var files = new Dictionary<string, byte[]> {
        ["package.json"] = Encoding.UTF8.GetBytes("{\"version\":\"0.3.1\"}"),
        ["server/index.js"] = Encoding.UTF8.GetBytes("export const server = true;"),
        ["scripts/launch.mjs"] = Encoding.UTF8.GetBytes("export const launch = true;"),
        ["scripts/host-launcher.mjs"] = Encoding.UTF8.GetBytes("export const desktop = true;") };
    var manifest = JsonSerializer.SerializeToUtf8Bytes(new { format = 1, app = "0.3.1", files = files.ToDictionary(x => x.Key, x => new { size = x.Value.Length, sha256 = Hash(x.Value) }) });
    files["MANIFEST.json"] = manifest;
    var zip = Zip(files.ToDictionary(x => "release/package/" + x.Key, x => x.Value));
    string Url(string asset) => $"https://github.com/{BootstrapInstaller.Repository}/releases/download/{tag}/{asset}";
    var listing = JsonSerializer.SerializeToUtf8Bytes(new[] { new { tag_name = tag, draft = false, prerelease = false, assets = new[] {
        new { name, browser_download_url = Url(name) }, new { name = "SHA256SUMS.txt", browser_download_url = Url("SHA256SUMS.txt") } } } });
    var routes = new Dictionary<string, byte[]> {
        [$"https://api.github.com/repos/{BootstrapInstaller.Repository}/releases?per_page=30"] = listing,
        [Url(name)] = zip, [Url("SHA256SUMS.txt")] = Encoding.UTF8.GetBytes(Hash(zip) + "  " + name + "\n") };
    using var handler = new FixtureHandler(routes);
    using var http = new HttpClient(handler);
    var installer = new BootstrapInstaller(http);
    var target = Path.Combine(work, "fresh-server");
    Check(await installer.InstallAsync(target) == target && InstallationLocator.IsProjectRoot(target), "standalone fresh install downloads, verifies and atomically commits full package");
    var before = File.ReadAllBytes(Path.Combine(target, "server/index.js"));
    await Reject(() => installer.InstallAsync(target), "existing installation cannot be overwritten");
    Check(before.SequenceEqual(File.ReadAllBytes(Path.Combine(target, "server/index.js"))), "existing installation bytes remain pristine");
    routes[Url("SHA256SUMS.txt")] = Encoding.UTF8.GetBytes(new string('0',64) + "  " + name);
    var bad = Path.Combine(work,"bad-hash");
    await Reject(() => installer.InstallAsync(bad), "corrupt download fails SHA256 before commit");
    Check(!Directory.Exists(bad) && !Directory.GetDirectories(work, ".sp-install-*").Any(), "failed download cleans staging and leaves target absent");
    routes[Url("SHA256SUMS.txt")] = Encoding.UTF8.GetBytes(Hash(zip) + "  " + name);
    files["server/index.js"] = Encoding.UTF8.GetBytes("TAMPERED");
    var damaged = Zip(files);
    routes[Url(name)] = damaged;
    routes[Url("SHA256SUMS.txt")] = Encoding.UTF8.GetBytes(Hash(damaged) + "  " + name);
    await Reject(() => installer.InstallAsync(Path.Combine(work,"bad-manifest")), "manifest catches file tampering even with a matching archive hash");
    routes[Url(name)] = zip;
    routes[Url("SHA256SUMS.txt")] = Encoding.UTF8.GetBytes(Hash(zip) + "  " + name);
    using var canceled = new CancellationTokenSource(); canceled.Cancel();
    await Reject(() => installer.InstallAsync(Path.Combine(work,"cancelled"), token:canceled.Token), "cancelled install cannot commit a partial instance");
    routes[Url(name)] = [];
    handler.Fail = true;
    try { await installer.InstallAsync(Path.Combine(work,"offline")); throw new Exception("Expected network failure"); } catch (HttpRequestException) { Check(true, "network failures propagate without creating an instance"); }
    handler.Fail = false;
    foreach (var unsafeName in new[] { "../escape.txt", "C:/escape.txt", "pkg/NUL.txt", "pkg/a:stream", "pkg/../escape.txt" })
    {
        var unsafeZip = Path.Combine(work,"unsafe.zip");
        File.WriteAllBytes(unsafeZip,Zip(new() { [unsafeName] = [1] }));
        await Reject(() => Task.Run(() => BootstrapInstaller.Extract(unsafeZip,Path.Combine(work,Guid.NewGuid().ToString("N")))), "archive rejects " + unsafeName);
    }
    Check(!File.Exists(Path.Combine(work,"escape.txt")), "archive traversal never writes outside extraction root");
    var duplicateZip = Path.Combine(work,"duplicate.zip");
    File.WriteAllBytes(duplicateZip,Zip(new() { ["pkg/A.txt"]=[1], ["pkg/a.txt"]=[2] }));
    await Reject(() => Task.Run(() => BootstrapInstaller.Extract(duplicateZip,Path.Combine(work,"duplicate"))), "case-insensitive duplicate paths are rejected");
    using var foreign = JsonDocument.Parse("{\"name\":\"x.zip\",\"browser_download_url\":\"https://example.com/x.zip\"}");
    await Reject(() => Task.Run(() => BootstrapInstaller.ReleaseUrl(foreign.RootElement,tag)), "foreign release URL is rejected");
    var version = "v22.99.1";
    var runtimeZip = Zip(new() { [$"node-{version}-win-x64/node.exe"]=[1,2], [$"node-{version}-win-x64/npm.cmd"]=[3] });
    var runtimeName = $"node-{version}-win-x64.zip";
    routes["https://nodejs.org/dist/index.json"] = Encoding.UTF8.GetBytes($"[{{\"version\":\"{version}\",\"lts\":\"Jod\"}}]");
    routes[$"https://nodejs.org/dist/{version}/SHASUMS256.txt"] = Encoding.UTF8.GetBytes(Hash(runtimeZip) + "  " + runtimeName);
    routes[$"https://nodejs.org/dist/{version}/{runtimeName}"] = runtimeZip;
    var runtime = Path.Combine(work,"runtime");
    var executable = await installer.EnsureRuntimeAsync(destination:runtime);
    Check(File.Exists(executable) && File.Exists(Path.Combine(runtime,"npm.cmd")), "portable Node/npm install requires no system installer or preexisting Node");
    Check(!Directory.GetDirectories(work,".node-install-*").Any(), "portable runtime staging is cleaned");
    Console.WriteLine($"RESULT standalone_install=true multi_instance=true checks={passed}");
}
finally { Directory.Delete(work,true); }

sealed class FixtureHandler(Dictionary<string, byte[]> routes) : HttpMessageHandler
{
    public bool Fail { get; set; }
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (Fail) throw new HttpRequestException("Fixture: offline");
        return Task.FromResult(routes.TryGetValue(request.RequestUri!.AbsoluteUri, out var bytes)
            ? new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(bytes) }
            : new HttpResponseMessage(HttpStatusCode.NotFound));
    }
}
sealed class ArchiveHandler(string archive) : HttpMessageHandler
{
    private readonly HttpClient network = BootstrapInstaller.CreateClient();
    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
        => request.RequestUri!.AbsolutePath.EndsWith("-assets.zip",StringComparison.Ordinal)
            ? Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StreamContent(File.OpenRead(archive)) })
            : network.GetAsync(request.RequestUri, token);
    protected override void Dispose(bool disposing) { if (disposing) network.Dispose(); base.Dispose(disposing); }
}
#else
Console.WriteLine("RESULT standalone_install=false multi_instance=false checks=0");
#endif
