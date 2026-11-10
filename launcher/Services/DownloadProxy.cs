using System.Diagnostics;
using System.Net;
using System.Net.Http;

namespace StrongholdProtocolLauncher.Services;

public sealed record DownloadProxySettings(string Mode = "system", string Address = "");

/// <summary>One download preference shared by native downloads and launched setup processes.</summary>
public static class DownloadProxy
{
    public static DownloadProxySettings Validate(DownloadProxySettings settings)
    {
        if (settings.Mode is not ("system" or "direct" or "manual")) throw new ArgumentException("Unknown download proxy mode.");
        if (settings.Mode == "manual") Address(settings.Address);
        return settings;
    }

    public static Uri Address(string value)
    {
        if (!Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https")
            || uri.Host.Length == 0 || uri.UserInfo.Length != 0 || uri.Query.Length != 0 || uri.Fragment.Length != 0
            || uri.AbsolutePath != "/") throw new ArgumentException("Enter an HTTP or HTTPS proxy address, for example http://127.0.0.1:7890.");
        return uri;
    }

    private static IWebProxy Proxy(DownloadProxySettings settings, IWebProxy? systemProxy)
        => settings.Mode == "manual" ? new WebProxy(Address(settings.Address)) : systemProxy ?? WebRequest.GetSystemWebProxy();

    public static HttpClientHandler CreateHandler(DownloadProxySettings settings, IWebProxy? systemProxy = null)
    {
        Validate(settings);
        return new HttpClientHandler { UseProxy = settings.Mode != "direct", Proxy = settings.Mode == "direct" ? null : Proxy(settings, systemProxy) };
    }

    private static string Resolve(IWebProxy proxy, string destination)
    {
        var uri = new Uri(destination);
        if (proxy.IsBypassed(uri)) return "";
        var resolved = proxy.GetProxy(uri);
        return resolved is null || resolved == uri ? "" : Address(resolved.AbsoluteUri).AbsoluteUri;
    }

    public static void Apply(ProcessStartInfo start, string root, DownloadProxySettings settings, IWebProxy? systemProxy = null)
    {
        Validate(settings);
        foreach (var key in new[] { "HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy", "NODE_USE_ENV_PROXY", "SP_ASSETS_ENV_PROXY_REEXEC" })
            start.Environment.Remove(key);
        start.Environment["SP_DOWNLOAD_PROXY_MODE"] = settings.Mode;
        start.Environment["NO_PROXY"] = start.Environment["no_proxy"] = "localhost,127.0.0.1,::1,[::1]";
        if (settings.Mode != "direct")
        {
            var proxy = Proxy(settings, systemProxy);
            start.Environment["HTTP_PROXY"] = start.Environment["http_proxy"] = Resolve(proxy, "http://github.com");
            start.Environment["HTTPS_PROXY"] = start.Environment["https_proxy"] = Resolve(proxy, "https://github.com");
        }
        // Explicit Undici fetch also supports Node 22.0–22.20; NODE_USE_ENV_PROXY alone does not.
        var preload = Path.Combine(root, "tools", "assets", "launcher-proxy.cjs");
        if (!File.Exists(preload))
        {
            var directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "StrongholdProtocol", "runtime");
            Directory.CreateDirectory(directory);
            preload = Path.Combine(directory, "launcher-proxy-" + typeof(DownloadProxy).Assembly.GetName().Version + ".cjs");
            using var source = typeof(DownloadProxy).Assembly.GetManifestResourceStream("launcher-proxy.cjs")
                ?? throw new IOException("Download proxy support is missing. Reinstall the launcher.");
            using var file = File.Create(preload);
            source.CopyTo(file);
        }
        var options = start.Environment.TryGetValue("NODE_OPTIONS", out var inherited) ? inherited : "";
        start.Environment["NODE_OPTIONS"] = (options + " --require \"" + preload.Replace('\\', '/') + "\"").Trim();
    }
}
