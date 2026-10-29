using System.IO;
using System.Windows;
using System.Windows.Controls;
using Microsoft.Win32;
using StrongholdProtocolLauncher.Services;

namespace StrongholdProtocolLauncher;

public partial class MainWindow
{
    private FileSystemWatcher? _instanceIndexWatcher;
    private bool _discoveringLive;
    private LiveInstance[] _liveInstances = [];
    private async Task RefreshIndexedInstancesAsync(bool showEmpty = false, bool includeLive = false)
    {
        if (_operating || _discoveringLive) return;
        var knownRoots = _profiles.Select(p => p.Root).Append(AppContext.BaseDirectory).ToArray();
        var roots = await Task.Run(() => InstanceIndex.Discover(knownRoots));
        var liveUnavailable = false;
        if (includeLive)
        {
            _discoveringLive = true; DiscoverInstancesButton.IsEnabled = false;
            try
            {
                using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(12));
                var inventory = await LiveInstanceDiscovery.InventoryAsync(timeout.Token);
                _liveInstances = await LiveInstanceDiscovery.DiscoverAsync(inventory, token: timeout.Token);
            }
            catch (Exception error) when (error is IOException or OperationCanceledException or System.ComponentModel.Win32Exception or System.Text.Json.JsonException)
            { liveUnavailable = true; }
            finally { _discoveringLive = false; DiscoverInstancesButton.IsEnabled = !_operating; }
        }
        roots = roots.Concat(_liveInstances.Select(p => p.Root)).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        var unregistered = roots.Where(root => !_profiles.Any(p => Path.TrimEndingDirectorySeparator(p.Root).Equals(root, StringComparison.OrdinalIgnoreCase))).ToArray();
        DiscoveryList.ItemsSource = unregistered;
        ImportDiscoveredButton.IsEnabled = unregistered.Length > 0;
        DiscoveryStatusText.Text = t("通过监听端口与本机索引发现 {count} 个未导入目录。在线实例：{ports}。已停止且未登记的旧目录请手动导入。",
            ("count", unregistered.Length.ToString()), ("ports", _liveInstances.Length == 0 ? t("暂无") : string.Join("、", _liveInstances.Select(p => p.Port + " (v" + p.Version + ")"))));
        if (liveUnavailable) DiscoveryStatusText.Text += " " + t("端口识别暂不可用，仍可读取实例索引或手动导入。");
        if (showEmpty || unregistered.Length > 0) DiscoveryPanel.Visibility = Visibility.Visible;
    }

    private void WatchInstanceIndex()
    {
        try
        {
            Directory.CreateDirectory(InstanceIndex.DefaultDirectory);
            _instanceIndexWatcher = new FileSystemWatcher(InstanceIndex.DefaultDirectory, "*.json")
            { NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite, EnableRaisingEvents = true };
            void Refresh(object sender, FileSystemEventArgs args) => Dispatcher.BeginInvoke(async () =>
            {
                try { if (!_operating && IsLoaded) await RefreshIndexedInstancesAsync(); }
                catch (Exception error) when (error is IOException or UnauthorizedAccessException) { /* Refresh button and manual import remain available. */ }
            });
            _instanceIndexWatcher.Created += Refresh;
            _instanceIndexWatcher.Changed += Refresh;
            _instanceIndexWatcher.Renamed += (sender, args) => Refresh(sender, args);
            Closed += (_, _) => _instanceIndexWatcher.Dispose();
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { /* Manual import remains available. */ }
    }
    private async void DeleteInstanceButton_Click(object sender, RoutedEventArgs e)
    {
        var profile = _profiles.FirstOrDefault(p => p.Id == _selectedId);
        if (profile is null || _operating) return;
        try
        {
            var root = InstanceDiscovery.ValidateDeletion(profile, _profiles, AppContext.BaseDirectory);
            if (MessageBox.Show(this, t("将把实例目录及其中的存档、配置、日志和素材移到回收站：{path}。请先备份需要的数据。确定删除？", ("path", root)),
                t("删除实例"), MessageBoxButton.YesNo, MessageBoxImage.Warning, MessageBoxResult.No) != MessageBoxResult.Yes) return;
            _operating = true; RefreshChecks();
            await Task.Run(() =>
            {
                // Recheck immediately before the filesystem operation, including every recorded port/lease.
                var checkedRoot = InstanceDiscovery.ValidateDeletion(profile, _profiles, AppContext.BaseDirectory);
                Microsoft.VisualBasic.FileIO.FileSystem.DeleteDirectory(checkedRoot, Microsoft.VisualBasic.FileIO.UIOption.OnlyErrorDialogs,
                    Microsoft.VisualBasic.FileIO.RecycleOption.SendToRecycleBin, Microsoft.VisualBasic.FileIO.UICancelOption.ThrowException);
            });
            try { InstanceIndex.Forget(profile.Root); } catch (IOException) { } catch (UnauthorizedAccessException) { }
            _operating = false;
            await ForgetInstanceAsync(profile);
            AppendVisibleLog(t("实例已移到回收站；可从 Windows 回收站恢复后重新导入。"));
        }
        catch (Exception error) { ShowMessage(t(error.Message)); }
        finally { _operating = false; RefreshChecks(); }
    }

    private async void DiscoverInstancesButton_Click(object sender, RoutedEventArgs e)
    {
        try { await RefreshIndexedInstancesAsync(showEmpty: true, includeLive: true); }
        catch (Exception error) { ShowMessage(error.Message); }
    }

    private void CancelDiscoveryButton_Click(object sender, RoutedEventArgs e)
        => DiscoveryPanel.Visibility = Visibility.Collapsed;

    private async void ImportDiscoveredButton_Click(object sender, RoutedEventArgs e)
    {
        if (_operating) return;
        _operating = true; RefreshChecks();
        try
        {
            InstanceProfile? last = null;
            foreach (var root in DiscoveryList.SelectedItems.Cast<string>().ToArray())
            {
                if (!InstanceDiscovery.IsInstallation(root) || _profiles.Any(p => p.Root.Equals(root, StringComparison.OrdinalIgnoreCase))) continue;
                last = new InstanceProfile(Guid.NewGuid().ToString("N"), InstanceNaming.DefaultName(root), root, await ImportedPortAsync(root), "local");
                _profiles.Add(last);
            }
            if (last is not null) { await SelectInstanceAsync(last); SavePreferences(); }
            DiscoveryPanel.Visibility = Visibility.Collapsed;
        }
        catch (Exception error) { ShowMessage(error.Message); }
        finally { _operating = false; RefreshChecks(); }
    }
    private static HostMode ParseMode(string value) => value switch { "local" => HostMode.Local, "tunnel" => HostMode.Tunnel, _ => HostMode.Lan };
    private static string ModeName(HostMode value) => value switch { HostMode.Local => "local", HostMode.Tunnel => "tunnel", _ => "lan" };
    private string DefaultInstallPath()
    {
        var home = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "StrongholdProtocol", "servers");
        for (var number = 1; ; number++)
        {
            var candidate = Path.Combine(home, InstanceNaming.DirectoryName(number));
            if (!Directory.Exists(candidate) && !File.Exists(candidate) && !_profiles.Any(p => p.Root.Equals(candidate, StringComparison.OrdinalIgnoreCase))) return candidate;
        }
    }

    private async Task<int> ImportedPortAsync(string root)
    {
        var live = _liveInstances.FirstOrDefault(item => item.Root.Equals(root, StringComparison.OrdinalIgnoreCase));
        if (live is not null) return live.Port;
        var node = await Task.Run(NodeRuntime.Find);
        var logs = Path.Combine(root, "logs");
        if (node?.IsSupported == true && Directory.Exists(logs))
            foreach (var file in Directory.EnumerateFiles(logs, "server-instance-*.json"))
            {
                var value = Path.GetFileNameWithoutExtension(file)["server-instance-".Length..];
                if (!int.TryParse(value, out var port) || port is < 1024 or > 65435) continue;
                try
                {
                    var status = await HostLauncher.StatusAsync(root, node, port);
                    if (status.State == "online") return port;
                }
                catch { /* Invalid or stale records cannot claim a live server. */ }
            }
        return InstanceProfiles.AvailablePort(_profiles, HostLauncher.PortHasListener);
    }

    private void RefreshInstanceList()
    {
        _selecting = true;
        try
        {
            InstanceBox.ItemsSource = null;
            InstanceBox.ItemsSource = _profiles.ToArray();
            InstanceBox.SelectedItem = _profiles.FirstOrDefault(p => p.Id == _selectedId);
        }
        finally { _selecting = false; }
    }

    private async void InstanceBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_selecting || !_ready || _operating || InstanceBox.SelectedItem is not InstanceProfile profile) return;
        try { await SelectInstanceAsync(profile); }
        catch (Exception error) { ShowMessage(error.Message); }
    }

    private async Task SelectInstanceAsync(InstanceProfile profile)
    {
        SavePreferences();
        profile = _profiles.FirstOrDefault(p => p.Id == profile.Id) ?? profile;
        _ready = false;
        _selectedId = profile.Id;
        _root = profile.Root;
        _mode = ParseMode(profile.Mode);
        _service = null;
        _install = null;
        _node = null;
        _serverOnline = _starting = _failed = _portBusy = _adminBusy = false;
        // Disposing a Process handle leaves that instance's background service running.
        _wrapper?.Dispose();
        _wrapper = null;
        _visibleLog.Clear();
        _logPosition = 0;
        _text = new TextCatalog(_root);
        PortBox.Text = profile.Port.ToString(System.Globalization.CultureInfo.InvariantCulture);
        LocalMode.IsChecked = _mode == HostMode.Local;
        LanMode.IsChecked = _mode == HostMode.Lan;
        TunnelMode.IsChecked = _mode == HostMode.Tunnel;
        RootPathText.Text = _root;
        RootPathText.ToolTip = _root;
        LogPathText.Text = HostLauncher.LogPath(_root, profile.Port);
        ApplyText();
        _ready = true;
        InstallPanel.Visibility = Visibility.Collapsed;
        RefreshInstanceList();
        SavePreferences();
        LoadLog();
        RefreshChecks();
        await RefreshNodeAsync();
        await RefreshServiceAsync();
    }

    private void NewInstanceButton_Click(object sender, RoutedEventArgs e)
    {
        InstallPanel.Visibility = InstallPanel.Visibility == Visibility.Visible && _profiles.Count > 0 ? Visibility.Collapsed : Visibility.Visible;
        InstallPathBox.Text = DefaultInstallPath();
        InstallStatusText.Text = "";
        InstallPathBox.Focus();
    }

    private void InstallFolderButton_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFolderDialog { Title = t("选择安装目录（必须为空）"), Multiselect = false };
        if (dialog.ShowDialog(this) == true) InstallPathBox.Text = dialog.FolderName;
    }

    private void CancelInstallButton_Click(object sender, RoutedEventArgs e) => _installCancellation?.Cancel();

    private async void InstallButton_Click(object sender, RoutedEventArgs e)
    {
        if (_operating) return;
        var target = InstallPathBox.Text.Trim();
        try
        {
            if (!Path.IsPathFullyQualified(target) || File.Exists(target) || Directory.Exists(target) && Directory.EnumerateFileSystemEntries(target).Any())
            {
                ShowMessage(t("请选择空的绝对路径，已有安装请使用导入已有实例。"));
                return;
            }
        }
        catch (Exception error) { ShowMessage(t("安装失败：{error}", ("error", error.Message))); return; }
        _operating = true;
        _installCancellation = new CancellationTokenSource();
        CancelInstallButton.Visibility = InstallProgressBar.Visibility = Visibility.Visible;
        RefreshChecks();
        var progress = new Progress<InstallProgress>(p =>
        {
            var label = p.Stage switch
            {
                "release" => t("正在获取游戏版本"),
                "download" => t("正在下载游戏安装包"),
                "verify" => t("正在校验并解压游戏包"),
                "runtime" => t("正在准备便携 Node.js"),
                _ => t("游戏安装完成"),
            };
            InstallStatusText.Text = p.Total > 0 ? $"{label} · {p.Received / 1048576.0:F1} / {p.Total / 1048576.0:F1} MB" : label;
            InstallProgressBar.IsIndeterminate = p.Total == 0;
            InstallProgressBar.Value = p.Total > 0 ? 100.0 * p.Received / p.Total : 0;
        });
        try
        {
            using var client = BootstrapInstaller.CreateClient();
            var installer = new BootstrapInstaller(client);
            // Prepare the runtime first. A failed game download leaves no half-created instance.
            var node = await Task.Run(NodeRuntime.Find);
            if (node?.IsSupported != true) await installer.EnsureRuntimeAsync(progress, _installCancellation.Token);
            var root = await installer.InstallAsync(target, progress, _installCancellation.Token);
            var profile = new InstanceProfile(Guid.NewGuid().ToString("N"), InstanceNaming.DefaultName(root), root,
                InstanceProfiles.AvailablePort(_profiles, HostLauncher.PortHasListener), "local");
            _profiles.Add(profile);
            await SelectInstanceAsync(profile);
            AppendVisibleLog(t("实例安装完成，可点击启动服务器。"));
        }
        catch (OperationCanceledException)
        {
            InstallStatusText.Text = _installCancellation.IsCancellationRequested ? t("安装已取消，可以重新尝试。")
                : t("下载超时，请检查网络后重试。");
        }
        catch (Exception error)
        {
            InstallStatusText.Text = t("安装失败：{error}", ("error", error.Message));
            AppendVisibleLog(InstallStatusText.Text);
        }
        finally
        {
            _installCancellation.Dispose();
            _installCancellation = null;
            _operating = false;
            CancelInstallButton.Visibility = InstallProgressBar.Visibility = Visibility.Collapsed;
            RefreshChecks();
        }
    }

    private async void RemoveInstanceButton_Click(object sender, RoutedEventArgs e)
    {
        var profile = _profiles.FirstOrDefault(p => p.Id == _selectedId);
        if (profile is null || _operating) return;
        if (MessageBox.Show(this, t("仅从列表移除此实例，文件和后台服务会保留。确定继续？"),
            t("移出列表"), MessageBoxButton.YesNo, MessageBoxImage.Question, MessageBoxResult.No) != MessageBoxResult.Yes) return;
        try
        {
            await ForgetInstanceAsync(profile);
        }
        catch (Exception error) { ShowMessage(error.Message); }
    }

    private async Task ForgetInstanceAsync(InstanceProfile profile)
    {
            _profiles.Remove(profile);
            _selectedId = null;
            if (_profiles.FirstOrDefault() is { } next) await SelectInstanceAsync(next);
            else
            {
                _root = null;
                _service = null;
                _node = null;
                _install = null;
                _serverOnline = _starting = false;
                _wrapper?.Dispose();
                _wrapper = null;
                _visibleLog.Clear();
                LogBox.Text = "";
                RootPathText.Text = t("尚未选择服务器目录");
                RootPathText.ToolTip = null;
                LogPathText.Text = "";
                RefreshInstanceList();
                SavePreferences();
                RefreshChecks();
                UpdateStatus();
                UpdateAddresses();
                InstallPanel.Visibility = Visibility.Visible;
            }
    }
}
