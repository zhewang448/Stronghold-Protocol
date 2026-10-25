using System.Globalization;
using System.Text.Json;

namespace StrongholdProtocolLauncher.Services;

public sealed class TextCatalog
{
    private const string Prefix = "【启动器】";
    private readonly Dictionary<string, string> _values = new(StringComparer.Ordinal);

    public TextCatalog(string? projectRoot)
    {
        var locale = LocaleCode(Environment.GetEnvironmentVariable("SP_LAUNCHER_LANG") ?? "zh-CN");
        if (locale == "zh-CN") return;
        var path = projectRoot is null ? null : Path.Combine(projectRoot, "public", "i18n", $"{locale}.json");
        try
        {
            using var stream = path is not null && File.Exists(path) ? File.OpenRead(path)
                : typeof(TextCatalog).Assembly.GetManifestResourceStream($"i18n.{locale}.json");
            if (stream is null) return;
            using var json = JsonDocument.Parse(stream);
            foreach (var entry in json.RootElement.EnumerateObject())
                if (entry.Value.ValueKind == JsonValueKind.String)
                    _values[entry.Name] = entry.Value.GetString()!;
        }
        catch
        {
            // Chinese source labels remain available when a language pack is absent.
        }
    }

    public string t(string source, params (string Name, string Value)[] values)
    {
        var text = _values.TryGetValue(source, out var translated) ? translated
            : source.StartsWith(Prefix, StringComparison.Ordinal) ? source[Prefix.Length..]
            : source;
        foreach (var (name, value) in values)
            text = text.Replace($"{{{name}}}", value, StringComparison.Ordinal);
        return text;
    }

    private static string LocaleCode(string locale)
    {
        if (locale.StartsWith("zh-TW", StringComparison.OrdinalIgnoreCase)
            || locale.StartsWith("zh-HK", StringComparison.OrdinalIgnoreCase)) return "zh-TW";
        if (locale.StartsWith("ja", StringComparison.OrdinalIgnoreCase)) return "ja";
        if (locale.StartsWith("ko", StringComparison.OrdinalIgnoreCase)) return "ko";
        if (locale.StartsWith("en", StringComparison.OrdinalIgnoreCase)) return "en";
        return "zh-CN";
    }
}
