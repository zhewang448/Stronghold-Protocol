using System.Diagnostics;
using System.Net;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace StrongholdProtocolLauncher.Services;

public sealed record ListeningProcess(int ProcessId, int Port, string CommandLine, string Address);
public sealed record LiveInstance(string Root, int Port, int ProcessId, string Version);

public static class LiveInstanceDiscovery
{
    // Query listeners owned by Node; no connection attempts across a port range.
    public static async Task<ListeningProcess[]> InventoryAsync(CancellationToken token = default)
    {
        if (!OperatingSystem.IsWindows()) return [];
        const string script = "$ErrorActionPreference='Stop'; $nodes=@{}; Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ForEach-Object { $nodes[[int]$_.ProcessId]=$_.CommandLine }; $rows=@(Get-NetTCPConnection -State Listen | Where-Object { $nodes.ContainsKey([int]$_.OwningProcess) } | ForEach-Object { [pscustomobject]@{ProcessId=[int]$_.OwningProcess;Port=[int]$_.LocalPort;CommandLine=$nodes[[int]$_.OwningProcess];Address=$_.LocalAddress} }); ConvertTo-Json -InputObject $rows -Compress";
        var start = new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe"))
        { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true, StandardOutputEncoding = Encoding.UTF8 };
        foreach (var arg in new[] { "-NoProfile", "-NonInteractive", "-EncodedCommand", Convert.ToBase64String(Encoding.Unicode.GetBytes("[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; " + script)) }) start.ArgumentList.Add(arg);
        using var process = Process.Start(start) ?? throw new IOException("Could not query local listeners.");
        var output = process.StandardOutput.ReadToEndAsync(token);
        var errors = process.StandardError.ReadToEndAsync(token);
        try { await process.WaitForExitAsync(token); }
        catch (OperationCanceledException) { if (!process.HasExited) process.Kill(); throw; }
        var json = await output;
        if (process.ExitCode != 0) { _ = await errors; throw new IOException("Could not query local listeners."); }
        return JsonSerializer.Deserialize<ListeningProcess[]>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? [];
    }

    public static string? RootFromCommand(string commandLine)
    {
        var argv = CommandLineToArgvW(commandLine, out var count);
        if (argv == IntPtr.Zero) return null;
        try
        {
            // Node flags requiring executable code or a relative working directory cannot identify a root safely.
            for (var i = 1; i < count; i++)
            {
                var arg = Marshal.PtrToStringUni(Marshal.ReadIntPtr(argv, i * IntPtr.Size));
                if (arg is null || arg.StartsWith('-')) continue;
                if (!Path.IsPathFullyQualified(arg)) return null;
                var file = Path.GetFullPath(arg);
                if (!file.EndsWith(Path.DirectorySeparatorChar + "server" + Path.DirectorySeparatorChar + "index.js", StringComparison.OrdinalIgnoreCase)) return null;
                var root = Directory.GetParent(file)?.Parent?.FullName;
                return root is not null && InstanceDiscovery.IsInstallation(root) ? root : null;
            }
            return null;
        }
        catch (Exception e) when (e is ArgumentException or IOException) { return null; }
        finally { _ = LocalFree(argv); }
    }

    public static bool IsGameHealth(string json, out string version)
    {
        version = "";
        try
        {
            using var doc = JsonDocument.Parse(json);
            var health = doc.RootElement;
            if (health.GetProperty("ok").ValueKind != JsonValueKind.True || health.GetProperty("version").GetInt32() != 1) return false;
            var app = health.GetProperty("app").GetString();
            var content = health.GetProperty("content").GetProperty("vanilla").GetString();
            if (!Regex.IsMatch(app ?? "", @"^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$", RegexOptions.CultureInvariant)
                || !Regex.IsMatch(content ?? "", "^[a-f0-9]{64}$", RegexOptions.CultureInvariant)) return false;
            version = app!; return true;
        }
        catch (Exception e) when (e is JsonException or KeyNotFoundException or InvalidOperationException or FormatException or OverflowException) { return false; }
    }

    public static async Task<LiveInstance[]> DiscoverAsync(IEnumerable<ListeningProcess> inventory,
        Func<Uri, CancellationToken, Task<string?>>? probe = null, CancellationToken token = default)
    {
        using var client = new HttpClient(new SocketsHttpHandler { UseProxy = false, AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(2) };
        probe ??= async (uri, ct) =>
        {
            using var response = await client.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, ct);
            if (!response.IsSuccessStatusCode) return null;
            await using var stream = await response.Content.ReadAsStreamAsync(ct);
            var bytes = new byte[65537]; var size = 0;
            while (size < bytes.Length) { var read = await stream.ReadAsync(bytes.AsMemory(size), ct); if (read == 0) break; size += read; }
            return size > 65536 ? null : Encoding.UTF8.GetString(bytes, 0, size);
        };
        var found = new List<LiveInstance>();
        foreach (var item in inventory.DistinctBy(p => (p.ProcessId, p.Port)).Take(256))
        {
            token.ThrowIfCancellationRequested();
            if (item.ProcessId <= 0 || item.Port is < 1024 or > 65435) continue;
            var root = RootFromCommand(item.CommandLine);
            if (root is null) continue;
            try
            {
                // Existing admin-side leases help filter management listeners, but never grant management access.
                var lease = Path.Combine(root, "logs", "server-instance-" + item.Port + ".json");
                if (File.Exists(lease))
                {
                    using var record = JsonDocument.Parse(File.ReadAllText(lease));
                    if (record.RootElement.GetProperty("pid").GetInt32() != item.ProcessId || record.RootElement.GetProperty("port").GetInt32() != item.Port) continue;
                }
                var host = item.Address.Contains(':') ? "[::1]" : "127.0.0.1";
                var json = await probe(new Uri("http://" + host + ":" + item.Port + "/healthz"), token);
                if (json is not null && IsGameHealth(json, out var version)) found.Add(new(root, item.Port, item.ProcessId, version));
            }
            catch (OperationCanceledException) when (!token.IsCancellationRequested) { }
            catch (Exception e) when (e is HttpRequestException or IOException or JsonException or KeyNotFoundException or InvalidOperationException) { }
        }
        return found.OrderBy(x => x.Port).ToArray();
    }

    [DllImport("shell32.dll", SetLastError = true)] private static extern IntPtr CommandLineToArgvW([MarshalAs(UnmanagedType.LPWStr)] string commandLine, out int count);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr value);
}
