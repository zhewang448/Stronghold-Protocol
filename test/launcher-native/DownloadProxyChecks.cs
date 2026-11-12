#if DOWNLOAD_PROXY
using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using StrongholdProtocolLauncher.Services;

static class DownloadProxyChecks
{
    public static async Task Run()
    {
        var checks = 0;
        void Check(bool value, string name) { if (!value) throw new Exception(name); checks++; Console.WriteLine("PASS " + name); }
        var legacy = JsonSerializer.Deserialize<LauncherPreferences>("{\"Root\":null,\"Port\":3000,\"Mode\":\"lan\"}")!;
        Check(legacy.DownloadProxyMode == "system", "legacy preferences default to system proxy");
        var saved = legacy with { DownloadProxyMode = "manual", DownloadProxyAddress = "http://127.0.0.1:7890" };
        Check(JsonSerializer.Deserialize<LauncherPreferences>(JsonSerializer.Serialize(saved)) == saved, "proxy preference round trip");
        foreach (var invalid in new[] { "socks5://localhost:1080", "http://user:pass@localhost:8080", "http://localhost:8080/path", "http://localhost:8080/?token=x", "not a proxy" })
        {
            var rejected = false;
            try { DownloadProxy.Validate(new("manual", invalid)); } catch (ArgumentException) { rejected = true; }
            Check(rejected, "reject invalid manual address");
        }
        using (var direct = DownloadProxy.CreateHandler(new("direct"))) Check(!direct.UseProxy, "direct ignores inherited and system proxy");
        using var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var address = "http://127.0.0.1:" + ((IPEndPoint)listener.LocalEndpoint).Port;
        var server = Task.Run(async () =>
        {
            for (var i = 0; i < 2; i++)
            {
                using var socket = await listener.AcceptTcpClientAsync();
                using var stream = socket.GetStream();
                using var reader = new StreamReader(stream, leaveOpen: true);
                var first = await reader.ReadLineAsync();
                if (first != "GET http://download.test/asset HTTP/1.1") throw new Exception("Proxy did not receive the target URL");
                while (!string.IsNullOrEmpty(await reader.ReadLineAsync())) { }
                await stream.WriteAsync(Encoding.ASCII.GetBytes("HTTP/1.1 200 OK\r\nContent-Length: 7\r\nConnection: close\r\n\r\nproxied"));
            }
        });
        foreach (var mode in new[] { "system", "manual" })
        {
            var settings = new DownloadProxySettings(mode, address);
            using var http = new HttpClient(DownloadProxy.CreateHandler(settings, new WebProxy(address))) { Timeout = TimeSpan.FromSeconds(5) };
            Check(await http.GetStringAsync("http://download.test/asset") == "proxied", mode + " native download reaches proxy");
            var start = new ProcessStartInfo("node") { WorkingDirectory = Directory.GetCurrentDirectory() };
            start.Environment["HTTPS_PROXY"] = "http://wrong.invalid:1";
            DownloadProxy.Apply(start, Directory.GetCurrentDirectory(), settings, new WebProxy(address));
            Check(start.Environment["HTTPS_PROXY"] == address + "/", mode + " propagates resolved proxy to Node");
            Check(start.Environment["NODE_OPTIONS"]!.Contains("--require"), mode + " preloads old-Node support");
            Check(start.Environment["NO_PROXY"]!.Contains("127.0.0.1"), mode + " bypasses local service controls");
        }
        await server.WaitAsync(TimeSpan.FromSeconds(6));
        var noProxy = new ProcessStartInfo("node");
        noProxy.Environment["https_proxy"] = "http://wrong.invalid:1";
        DownloadProxy.Apply(noProxy, Directory.GetCurrentDirectory(), new("direct"));
        Check(!noProxy.Environment.ContainsKey("https_proxy"), "direct clears inherited proxy for child process");
        Console.WriteLine("RESULT download_proxy=true checks=" + checks);
    }
}
#endif
