#if SELF_UPDATE
using System.IO.Compression;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using NSec.Cryptography;
using StrongholdProtocolLauncher.Services;

static class LauncherSplitInstallChecks
{
    public static async Task Run()
    {
        var directory = Path.Combine(Path.GetTempPath(), "sp-split-native-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var checks = 0;
        void Check(bool condition, string message)
        {
            if (!condition) throw new Exception(message);
            Console.WriteLine("PASS " + message);
            checks++;
        }
        byte[] Zip(Dictionary<string, byte[]> files)
        {
            using var bytes = new MemoryStream();
            using (var archive = new ZipArchive(bytes, ZipArchiveMode.Create, true))
                foreach (var file in files)
                {
                    using var entry = archive.CreateEntry("Stronghold-Protocol/" + file.Key).Open();
                    entry.Write(file.Value);
                }
            return bytes.ToArray();
        }
        static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        try
        {
            var tag = "v0.3.3-extended.999";
            var prefix = "https://github.com/" + BootstrapInstaller.Repository + "/releases/download/" + tag + "/";
            var code = new Dictionary<string, byte[]>
            {
                ["package.json"] = Encoding.UTF8.GetBytes("{\"version\":\"0.3.3\"}"),
                ["server/index.js"] = Encoding.UTF8.GetBytes("server"),
                ["scripts/launch.mjs"] = Encoding.UTF8.GetBytes("launch"),
                ["scripts/host-launcher.mjs"] = Encoding.UTF8.GetBytes("host")
            };
            var programManifest = JsonSerializer.SerializeToUtf8Bytes(new { format = 1, app = "0.3.3",
                files = code.ToDictionary(file => file.Key, file => new { size = file.Value.Length, sha256 = Hash(file.Value) }) });
            var art = new Dictionary<string, (string Group, byte[] Bytes)>
            {
                ["data/assets.json"] = ("common", Encoding.UTF8.GetBytes("{\"image\":\"/assets/common.png\"}")),
                ["public/assets/common.png"] = ("common", Encoding.UTF8.GetBytes("common")),
                ["data/local-assets.json"] = ("local", Encoding.UTF8.GetBytes("{\"scene\":\"/assets/local/scene.png\"}")),
                ["public/assets/local/scene.png"] = ("local", Encoding.UTF8.GetBytes("scene")),
                ["data/local-fx.json"] = ("fx", Encoding.UTF8.GetBytes("{\"effect\":\"/assets/local/fx/effect.png\"}")),
                ["public/assets/local/fx/effect.png"] = ("fx", Encoding.UTF8.GetBytes("effect"))
            };
            var names = new[] { "common", "local", "fx" }.ToDictionary(group => group,
                group => $"Stronghold-Protocol-{tag}-{group}-art.zip");
            var liteName = $"Stronghold-Protocol-{tag}-lite.zip";
            var fullName = $"Stronghold-Protocol-{tag}-assets.zip";
            var indexName = $"Stronghold-Protocol-{tag}-art-index.json";
            var source = "https://raw.githubusercontent.com/example/assets/main/common.png";
            var liteFiles = new Dictionary<string, byte[]>(code) { ["MANIFEST.json"] = programManifest, ["data/assets.json"] = art["data/assets.json"].Bytes };
            var fullFiles = new Dictionary<string, byte[]>(liteFiles);
            foreach (var file in art) fullFiles[file.Key] = file.Value.Bytes;
            var packages = new Dictionary<string, byte[]>
            {
                [liteName] = Zip(liteFiles),
                [fullName] = Zip(fullFiles),
                [indexName] = JsonSerializer.SerializeToUtf8Bytes(new { format = 1, tag, app = "0.3.3", groups = names,
                    files = art.ToDictionary(file => file.Key, file => new { group = file.Value.Group, size = file.Value.Bytes.Length,
                        sha256 = Hash(file.Value.Bytes), source = file.Key == "public/assets/common.png" ? source : null }) })
            };
            foreach (var group in names)
                packages[group.Value] = Zip(art.Where(file => file.Value.Group == group.Key).ToDictionary(file => file.Key, file => file.Value.Bytes));
            using var key = Key.Create(SignatureAlgorithm.Ed25519);
            var publicKey = Convert.ToBase64String(Convert.FromHexString("302A300506032B6570032100").Concat(key.PublicKey.Export(KeyBlobFormat.RawPublicKey)).ToArray());
            var sums = Encoding.UTF8.GetBytes(string.Join("\n", packages.Select(package => Hash(package.Value) + "  " + package.Key)) + "\n");
            var signature = Encoding.UTF8.GetBytes(Convert.ToBase64String(SignatureAlgorithm.Ed25519.Sign(key,
                Encoding.UTF8.GetBytes("stronghold-protocol-release\n" + tag + "\n").Concat(sums).ToArray())));
            var routes = packages.ToDictionary(package => prefix + package.Key, package => package.Value);
            routes[source] = art["public/assets/common.png"].Bytes;
            routes[prefix + "SHA256SUMS.txt"] = sums;
            routes[prefix + "SHA256SUMS.txt.sig"] = signature;
            var api = $"https://api.github.com/repos/{BootstrapInstaller.Repository}/releases?per_page=30";
            void SetListing(long fullSize, bool includeFull = true)
            {
                var entries = packages.Where(package => includeFull || package.Key != fullName)
                    .Select(package => new { name = package.Key, size = package.Key == fullName ? fullSize : package.Value.Length,
                        browser_download_url = prefix + package.Key }).ToList();
                entries.Add(new { name = "SHA256SUMS.txt", size = (long)sums.Length, browser_download_url = prefix + "SHA256SUMS.txt" });
                entries.Add(new { name = "SHA256SUMS.txt.sig", size = (long)signature.Length, browser_download_url = prefix + "SHA256SUMS.txt.sig" });
                routes[api] = JsonSerializer.SerializeToUtf8Bytes(new[] { new { tag_name = tag, draft = false, prerelease = false, assets = entries } });
            }
            SetListing(1000000);
            using var handler = new Handler(routes);
            using var client = new HttpClient(handler);
            var installer = new BootstrapInstaller(client, [publicKey]);
            var target = Path.Combine(directory, "split");
            await installer.InstallAsync(target);
            Check(InstallationLocator.IsProjectRoot(target) && art.All(file => File.ReadAllBytes(Path.Combine(target, file.Key)).SequenceEqual(file.Value.Bytes)),
                "signed lite and asset groups produce a complete new installation");
            Check(handler.Requests.Contains(prefix + liteName) && handler.Requests.Contains(source)
                && handler.Requests.Contains(prefix + names["local"]) && handler.Requests.Contains(prefix + names["fx"])
                && !handler.Requests.Contains(prefix + names["common"]) && !handler.Requests.Contains(prefix + fullName),
                "smaller split path downloads verified public assets and avoids the full archive");

            handler.Requests.Clear();
            routes[source] = Encoding.UTF8.GetBytes("broken");
            var sourceFallback = Path.Combine(directory, "source-fallback");
            await installer.InstallAsync(sourceFallback);
            Check(handler.Requests.Contains(prefix + names["common"]) && !handler.Requests.Contains(prefix + fullName)
                && File.ReadAllText(Path.Combine(sourceFallback, "public/assets/common.png")) == "common",
                "mismatched public asset falls back to the signed asset group");
            routes[source] = art["public/assets/common.png"].Bytes;

            handler.Requests.Clear();
            SetListing(1);
            await installer.InstallAsync(Path.Combine(directory, "full"));
            Check(handler.Requests.Contains(prefix + fullName) && !handler.Requests.Contains(prefix + liteName),
                "smaller full archive is selected without downloading split packages");

            handler.Requests.Clear();
            SetListing(1000000);
            routes[prefix + names["fx"]] = [1, 2, 3];
            var fallback = Path.Combine(directory, "fallback");
            await installer.InstallAsync(fallback);
            Check(handler.Requests.Contains(prefix + fullName) && File.ReadAllText(Path.Combine(fallback, "public/assets/local/fx/effect.png")) == "effect",
                "corrupt split archive falls back to the verified full archive");
            routes[prefix + names["fx"]] = packages[names["fx"]];

            handler.Requests.Clear();
            routes[prefix + indexName] = Encoding.UTF8.GetBytes("{}");
            await installer.InstallAsync(Path.Combine(directory, "index-fallback"));
            Check(handler.Requests.Contains(prefix + fullName) && !handler.Requests.Contains(prefix + liteName),
                "tampered asset index falls back before downloading lite");
            routes[prefix + indexName] = packages[indexName];

            handler.Requests.Clear();
            routes[prefix + "SHA256SUMS.txt.sig"] = Encoding.UTF8.GetBytes(new string('A', 86) + "==");
            var rejected = Path.Combine(directory, "bad-signature");
            try { await installer.InstallAsync(rejected); throw new Exception("Expected signature failure"); }
            catch (IOException) { }
            Check(!Directory.Exists(rejected) && !handler.Requests.Contains(prefix + fullName), "invalid release signature installs nothing");
            routes[prefix + "SHA256SUMS.txt.sig"] = signature;

            handler.Requests.Clear();
            SetListing(0, false);
            var splitOnly = Path.Combine(directory, "split-only");
            await installer.InstallAsync(splitOnly);
            Check(InstallationLocator.IsProjectRoot(splitOnly), "signed split-only releases can install without a full archive");
            Console.WriteLine($"RESULT split_install=true checks={checks}");
        }
        finally { Directory.Delete(directory, true); }
    }

    private sealed class Handler(Dictionary<string, byte[]> routes) : HttpMessageHandler
    {
        public List<string> Requests { get; } = [];
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token)
        {
            token.ThrowIfCancellationRequested();
            var url = request.RequestUri!.AbsoluteUri;
            Requests.Add(url);
            return Task.FromResult(routes.TryGetValue(url, out var bytes)
                ? new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(bytes) }
                : new HttpResponseMessage(HttpStatusCode.NotFound));
        }
    }
}
#endif
