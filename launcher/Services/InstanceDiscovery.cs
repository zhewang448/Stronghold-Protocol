using System.Diagnostics;
using System.Text.Json;

namespace StrongholdProtocolLauncher.Services;

public static class InstanceDiscovery
{
    public static bool IsInstallation(string root)
    {
        if (!InstallationLocator.IsProjectRoot(root)) return false;
        try
        {
            using var json = JsonDocument.Parse(File.ReadAllText(Path.Combine(root, "package.json")));
            return json.RootElement.TryGetProperty("name", out var name) && name.GetString() == "stronghold-protocol-alliance";
        }
        catch { return false; }
    }

    public static string ValidateDeletion(InstanceProfile profile, IEnumerable<InstanceProfile> profiles,
        string executableDirectory, Func<int, bool>? isAlive = null)
    {
        if (!IsInstallation(profile.Root)) throw new IOException("请选择有效的本库实例目录。");
        var root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(profile.Root));
        bool Contains(string path) => Path.GetFullPath(path).Equals(root, StringComparison.OrdinalIgnoreCase)
            || Path.GetFullPath(path).StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
        if (Contains(executableDirectory) || root == Path.GetPathRoot(root)) throw new IOException("启动器位于此目录中，请将启动器移到实例目录外后再删除。");
        if (profiles.Any(p => p.Id != profile.Id && Contains(p.Root))) throw new IOException("此目录包含其他实例，请先处理子实例。");
        for (var current = new DirectoryInfo(root); current is not null; current = current.Parent)
            if ((current.Attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("实例路径包含链接，无法删除。请在文件管理器中确认实际目录。");
        isAlive ??= pid => { try { using var process = Process.GetProcessById(pid); return !process.HasExited; } catch (ArgumentException) { return false; } catch { return true; } };
        var logs = Path.Combine(root, "logs");
        if (Directory.Exists(logs) && (File.GetAttributes(logs) & FileAttributes.ReparsePoint) != 0)
            throw new IOException("实例路径包含链接，无法删除。请在文件管理器中确认实际目录。");
        if (Directory.Exists(logs))
            foreach (var file in Directory.EnumerateFiles(logs, "*.json").Where(f =>
                Path.GetFileName(f).StartsWith("server-instance-", StringComparison.Ordinal)
                || Path.GetFileName(f).StartsWith("host-launcher-state-", StringComparison.Ordinal)
                || Path.GetFileName(f).StartsWith("tunnel-", StringComparison.Ordinal)))
            {
                using var record = JsonDocument.Parse(File.ReadAllText(file));
                if (!record.RootElement.TryGetProperty("pid", out var value) || !value.TryGetInt32(out var pid) || pid <= 0)
                    throw new IOException("实例运行记录无法核验，请先停止服务并检查日志目录。");
                if (isAlive(pid)) throw new IOException("实例仍在运行，请先停止服务器和隧道再删除。");
            }
        return root;
    }
}
