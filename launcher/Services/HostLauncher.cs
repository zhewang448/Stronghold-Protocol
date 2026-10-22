using System.Diagnostics;
using System.Net.NetworkInformation;
using System.Text;
using System.Text.Json;

namespace StrongholdProtocolLauncher.Services;

public enum HostMode { Local, Lan, Tunnel }
public sealed record HostAddress(string Label, string Url);
public sealed record DesktopStatus(string State, bool Managed, string? AdminUrl, bool CanRestart, bool CanShutdown,
    bool RecoveryEnabled, int ActiveMatches, HostAddress[] Addresses);
public sealed record InstallStatus(bool DataOk, bool DepsOk, bool AssetsOk, int MissingAssets);

public static class HostLauncher
{
    public static string LogPath(string root, int port) => Path.Combine(root, "logs", $"host-launcher-{port}.log");
    private static ProcessStartInfo Command(string root, NodeRuntime node, params string[] args)
    {
        var start = new ProcessStartInfo(node.Executable) { WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true };
        start.ArgumentList.Add(Path.Combine(root, "scripts", "host-launcher.mjs"));
        foreach (var arg in args) start.ArgumentList.Add(arg);
        // Server controls must be available and bound only to loopback. Use the documented default admin port.
        start.Environment.Remove("SP_ADMIN");
        start.Environment.Remove("SP_ADMIN_PORT");
        start.Environment["PATH"] = Path.GetDirectoryName(node.Executable) + Path.PathSeparator + Environment.GetEnvironmentVariable("PATH");
        return start;
    }
    public static Process? Start(string root, NodeRuntime node, int port, HostMode mode)
    {
        var start = Command(root, node, "--port", port.ToString(), "--host", mode == HostMode.Local ? "127.0.0.1" : "::", "--no-open");
        if (mode == HostMode.Tunnel) start.ArgumentList.Add("--tunnel");
        return Process.Start(start);
    }
    private static async Task<string> RunAsync(ProcessStartInfo start, int timeoutSeconds = 15)
    {
        start.RedirectStandardOutput = true;
        start.RedirectStandardError = true;
        start.StandardOutputEncoding = Encoding.UTF8;
        start.StandardErrorEncoding = Encoding.UTF8;
        using var process = Process.Start(start) ?? throw new IOException("Could not start Node.js.");
        var output = process.StandardOutput.ReadToEndAsync();
        var error = process.StandardError.ReadToEndAsync();
        using var cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(timeoutSeconds));
        try { await process.WaitForExitAsync(cancellation.Token); }
        catch (OperationCanceledException) { if (!process.HasExited) process.Kill(); throw new IOException("Service query timed out."); }
        var text = await output;
        if (process.ExitCode != 0) throw new IOException(await error);
        return text.Trim();
    }
    public static async Task<DesktopStatus> StatusAsync(string root, NodeRuntime node, int port)
    {
        var json = await RunAsync(Command(root, node, "--status", "--port", port.ToString()));
        return JsonSerializer.Deserialize<DesktopStatus>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
            ?? throw new IOException("Invalid service status.");
    }
    public static async Task<InstallStatus> InspectAsync(string root, NodeRuntime node)
    {
        var json = await RunAsync(Command(root, node, "--inspect"), 60);
        using var result = JsonDocument.Parse(json);
        var data = result.RootElement;
        return new InstallStatus(data.GetProperty("data").GetProperty("ok").GetBoolean(),
            data.GetProperty("deps").GetProperty("ok").GetBoolean() && data.GetProperty("vendor").GetProperty("ok").GetBoolean(),
            data.GetProperty("assets").GetProperty("ok").GetBoolean(), data.GetProperty("assets").GetProperty("missing").GetInt32());
    }
    public static async Task<(int ExitCode, string Output)> StopAsync(string root, NodeRuntime node, int port)
    {
        var start = new ProcessStartInfo(node.Executable) { WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true };
        foreach (var arg in new[] { Path.Combine(root, "scripts", "free-port.mjs"), "--port", port.ToString(), "--confirm-active" }) start.ArgumentList.Add(arg);
        try { return (0, await RunAsync(start, 20)); }
        catch (IOException error) { return (1, error.Message); }
    }
    public static async Task RestartAsync(string root, NodeRuntime node, int port)
    {
        using var json = JsonDocument.Parse(await RunAsync(Command(root, node, "--restart", "--port", port.ToString())));
        if (!json.RootElement.GetProperty("ok").GetBoolean()) throw new IOException(json.RootElement.GetProperty("error").GetString());
    }
    public static bool PortHasListener(int port)
    {
        try { return IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners().Any(endpoint => endpoint.Port == port); }
        catch { return true; }
    }
    public static bool HasCloudflared()
    {
        var candidates = new List<string>
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "cloudflared", "cloudflared.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "cloudflared", "cloudflared.exe"),
        };
        foreach (var directory in (Environment.GetEnvironmentVariable("PATH") ?? string.Empty).Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
            try { candidates.Add(Path.Combine(directory.Trim('"'), "cloudflared.exe")); } catch (ArgumentException) { }
        return candidates.Any(File.Exists);
    }
    public static void Open(string url) => Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
}
