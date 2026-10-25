using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Microsoft.Win32;
using StrongholdProtocolLauncher.Services;

namespace StrongholdProtocolLauncher;

public partial class MainWindow : Window
{
    private static readonly Regex Ansi = new("\\x1B\\[[0-?]*[ -/]*[@-~]", RegexOptions.Compiled);
    private readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromMilliseconds(1600) };
    private readonly List<string> _visibleLog = [];
    private DesktopStatus? _service;
    private InstallStatus? _install;
    private bool _operating;
    private bool _failed;
    private TextCatalog _text = new(null);
    private string? _root;
    private NodeRuntime? _node;
    private Process? _wrapper;
    private HostMode _mode = HostMode.Lan;
    private long _logPosition;
    private bool _ready;
    private bool _refreshing;
    private bool _starting;
    private bool _serverOnline;
    private bool _portBusy;
    private bool _adminBusy;
    private bool _portValid;
    private readonly List<InstanceProfile> _profiles = [];
    private string? _selectedId;
    private bool _selecting;
    private CancellationTokenSource? _installCancellation;

    public MainWindow()
    {
        InitializeComponent();
        SourceInitialized += (_, _) => SetDarkTitleBar();
        _timer.Tick += Timer_Tick;
    }

    private string t(string source, params (string Name, string Value)[] values)
        => _text.t($"【启动器】{source}", values);

    private async void Window_Loaded(object sender, RoutedEventArgs e)
    {
        if (App.PreviewDirectory is not null)
        {
            await RenderPreviewAsync(App.PreviewDirectory);
            return;
        }
        var preferences = PreferencesStore.Load();
        _root = InstallationLocator.FindRoot(AppContext.BaseDirectory, preferences.Root, Environment.CurrentDirectory);
        _mode = preferences.Mode switch
        {
            "local" => HostMode.Local,
            "tunnel" => HostMode.Tunnel,
            _ => HostMode.Lan,
        };
        var savedInstances = InstanceProfiles.Load();
        _profiles.AddRange(savedInstances.Instances);
        var selected = _profiles.FirstOrDefault(p => p.Id == savedInstances.SelectedId);
        if (selected is null && _root is not null && !File.Exists(InstanceProfiles.DefaultPath))
        {
            selected = new InstanceProfile(Guid.NewGuid().ToString("N"), InstanceNaming.DefaultName(_root), _root, preferences.Port, preferences.Mode);
            _profiles.Add(selected);
        }
        if (selected is not null)
        {
            _selectedId = selected.Id;
            _root = selected.Root;
            preferences = new LauncherPreferences(_root, selected.Port, selected.Mode);
            _mode = ParseMode(selected.Mode);
        }
        else _root = null;
        _text = new TextCatalog(_root);
        ApplyText();
        PortBox.Text = preferences.Port.ToString(CultureInfo.InvariantCulture);
        LocalMode.IsChecked = _mode == HostMode.Local;
        LanMode.IsChecked = _mode == HostMode.Lan;
        TunnelMode.IsChecked = _mode == HostMode.Tunnel;
        _ready = true;
        RootPathText.Text = _root ?? t("尚未选择服务器目录");
        RootPathText.ToolTip = _root;
        LogPathText.Text = _root is null ? string.Empty : HostLauncher.LogPath(_root, preferences.Port);
        LoadLog();
        await RefreshNodeAsync();
        await RefreshServiceAsync();
        RefreshChecks();
        RefreshInstanceList();
        InstallPanel.Visibility = _profiles.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        InstallPathBox.Text = DefaultInstallPath();
        SavePreferences();
        await RefreshIndexedInstancesAsync(includeLive: true);
        WatchInstanceIndex();
        _timer.Start();
        _ = CheckSelfUpdateAsync(false);
    }

    private void ApplyText()
    {
        Title = $"{t("卫戍协议：盟约")} - {t("服主启动器")}";
        ProductTitle.Text = t("卫戍协议：盟约");
        ProductSubtitle.Text = "TACTICAL CO-OP NODE // HOST CONTROL";
        BuildVersionText.Text = "LAUNCHER v" + (typeof(App).Assembly.GetName().Version?.ToString(3) ?? "1.0.0");
        SelfUpdateButton.Content = t("启动器更新");
        SelfUpdateInstall.Content = t("下载并重启启动器");
        SelfUpdateCancel.Content = t("取消 / 收起");
        BrowseTopButton.Content = t("导入已有实例");
        InstancesLabel.Text = t("服务器实例");
        NewInstanceButton.Content = t("新建实例");
        RemoveInstanceButton.Content = t("移出列表");
        DeleteInstanceButton.Content = t("删除实例");
        DiscoverInstancesButton.Content = t("发现本机实例");
        ImportHintText.Text = t("运行中实例通过本机监听端口识别，停服实例读取索引；无需遍历磁盘。发现后勾选导入。");
        ImportDiscoveredButton.Content = t("导入所选实例");
        CancelDiscoveryButton.Content = t("收起");
        InstallHint.Text = t("选择空目录，自动下载完整游戏包和所需运行环境。已有服务可继续运行。");
        InstallFolderButton.Content = t("选择位置");
        InstallButton.Content = t("下载并安装");
        CancelInstallButton.Content = t("取消安装");
        ModeHeading.Text = t("开服方式");
        LocalModeTitle.Text = t("仅本机");
        LocalModeDetail.Text = t("只允许这台电脑访问");
        LanModeTitle.Text = t("局域网");
        LanModeDetail.Text = t("同一网络的玩家可加入");
        TunnelModeTitle.Text = t("公网隧道");
        TunnelModeDetail.Text = t("临时公网地址 · cloudflared");
        PortLabel.Text = t("服务器端口");
        StartButton.Content = t("启动服务器");
        StopButton.Content = t("停止服务器");
        CopyPrimaryButton.Content = t("复制地址");
        AddressHeading.Text = t("可分享地址");
        OpenGameButton.Content = t("打开游戏");
        OpenConsoleButton.Content = t("管理控制台");
        ChecksHeading.Text = t("启动前检查");
        ProjectCheckLabel.Text = t("项目文件");
        NodeCheckLabel.Text = t("Node.js 运行时");
        PortCheckLabel.Text = t("服务端口");
        AssetsCheckLabel.Text = t("游戏素材");
        TunnelCheckLabel.Text = t("公网隧道");
        InstallTunnelButton.Content = t("安装 cloudflared");
        InstallNodeButton.Content = t("安装 Node.js LTS");
        FirstRunTitle.Text = t("首次启动");
        FirstRunDetail.Text = t("启动时会检查依赖并准备缺少的素材。首次准备需要联网，具体时间取决于网络。停止服务器会断开玩家，启动器关闭后服务仍会继续运行。");
        LogHeading.Text = t("启动日志");
        DepsCheckLabel.Text = t("依赖与前端库");
        RestartButton.Content = t("重启服务");
        RefreshButton.Content = t("重新检查");
        CopyLogButton.Content = t("复制诊断");
        OpenLogButton.Content = t("日志目录");
        UpdateModeHint();
        if (!_serverOnline && !_starting)
        {
            StatusTitle.Text = t("服务器已停止");
            StatusDetail.Text = t("选择开服方式并启动服务器。");
            StatusBadge.Text = "OFFLINE";
        }
    }

    private async Task RefreshNodeAsync()
    {
        NodeCheckValue.Text = t("正在检测");
        InstallNodeButton.Visibility = Visibility.Collapsed;
        var root = _root;
        var selectedId = _selectedId;
        var found = await Task.Run(NodeRuntime.Find);
        if (root != _root || selectedId != _selectedId) return;
        _node = found;
        if (_node is null)
        {
            NodeCheckValue.Text = t("未找到");
            InstallNodeButton.Visibility = Visibility.Visible;
        }
        else if (!_node.IsSupported)
        {
            NodeCheckValue.Text = _node.Version;
            InstallNodeButton.Visibility = Visibility.Visible;
        }
        else
        {
            NodeCheckValue.Text = _node.Version;
        }
        _install = null;
        if (_root is not null && _node?.IsSupported == true)
        {
            try
            {
                var installation = await HostLauncher.InspectAsync(_root, _node);
                if (root != _root || selectedId != _selectedId) return;
                _install = installation;
            }
            catch (Exception error) { AppendVisibleLog(error.Message); }
        }
        RefreshChecks();
    }

    private void RefreshChecks()
    {
        var rootValid = InstallationLocator.IsProjectRoot(_root) && _install?.DataOk != false;
        ProjectCheckValue.Text = rootValid ? t("已找到") : t("未设置");
        ProjectCheckValue.Foreground = rootValid ? Brush("#4ED8AF") : Brush("#F6A329");
        NodeCheckValue.Foreground = _node?.IsSupported == true ? Brush("#4ED8AF") : Brush("#F6A329");

        var port = CurrentPort();
        _portValid = port.HasValue;
        if (port is null)
        {
            PortCheckValue.Text = t("端口无效");
            PortCheckValue.Foreground = Brush("#FF5454");
        }
        else
        {
            _portBusy = HostLauncher.PortHasListener(port.Value);
            _adminBusy = !_serverOnline && !_starting && HostLauncher.PortHasListener(port.Value + 100);
            PortCheckValue.Text = _serverOnline ? t("服务已运行") : _portBusy ? t("端口已被占用") : t("可用");
            if (_adminBusy && !_portBusy) PortCheckValue.Text = t("管理端口 {port} 已被占用", ("port", (port.Value + 100).ToString()));
            PortCheckValue.Foreground = _serverOnline ? Brush("#4ED8AF") : _portBusy ? Brush("#F6A329") : Brush("#4ED8AF");
            if (_adminBusy) PortCheckValue.Foreground = Brush("#F6A329");
        }

        var assetsReady = _install?.AssetsOk == true;
        AssetsCheckValue.Text = assetsReady ? t("已找到") : t("启动时自动准备");
        AssetsCheckValue.Foreground = assetsReady ? Brush("#4ED8AF") : Brush("#9FD4FF");
        DepsCheckValue.Text = _install?.DepsOk == true ? t("已就绪") : t("启动时自动准备");
        DepsCheckValue.Foreground = Brush(_install?.DepsOk == true ? "#4ED8AF" : "#9FD4FF");
        var tunnelReady = HostLauncher.HasCloudflared();
        TunnelCheckValue.Text = tunnelReady ? t("已找到") : t("按需安装");
        TunnelCheckValue.Foreground = tunnelReady ? Brush("#4ED8AF") : Brush(_mode == HostMode.Tunnel ? "#F6A329" : "#8A948F");
        InstallTunnelButton.Visibility = _mode == HostMode.Tunnel && !tunnelReady ? Visibility.Visible : Visibility.Collapsed;
        InstallNodeButton.Visibility = _node?.IsSupported == true ? Visibility.Collapsed : Visibility.Visible;

        var canStart = rootValid && _node?.IsSupported == true && _portValid && !_portBusy && !_adminBusy && !_serverOnline && !_starting && !_operating
            && (_mode != HostMode.Tunnel || tunnelReady);
        StartButton.IsEnabled = (canStart || _serverOnline) && !_operating;
        StartButton.Content = _serverOnline ? t("打开游戏") : t("启动服务器");
        OpenGameButton.Visibility = Visibility.Collapsed;
        PortBox.IsEnabled = !_serverOnline && !_starting && !_operating;
        LocalMode.IsEnabled = !_serverOnline && !_starting && !_operating;
        LanMode.IsEnabled = !_serverOnline && !_starting && !_operating;
        TunnelMode.IsEnabled = !_serverOnline && !_starting && !_operating;
        BrowseTopButton.IsEnabled = !_operating;
        InstanceBox.IsEnabled = !_operating;
        NewInstanceButton.IsEnabled = !_operating;
        RemoveInstanceButton.IsEnabled = !_operating && _selectedId is not null;
        DeleteInstanceButton.IsEnabled = !_operating && !_serverOnline && !_starting && _selectedId is not null;
        DiscoverInstancesButton.IsEnabled = !_operating;
        InstallButton.IsEnabled = !_operating;
        InstallPathBox.IsEnabled = !_operating;
        InstallFolderButton.IsEnabled = !_operating;
        StopButton.IsEnabled = !_operating && _service?.CanShutdown == true;
        RestartButton.IsEnabled = !_operating && _service?.CanRestart == true;
        OpenConsoleButton.IsEnabled = _service?.AdminUrl is not null;
        StopButton.Visibility = _serverOnline ? Visibility.Visible : Visibility.Collapsed;
        CopyPrimaryButton.Visibility = _serverOnline ? Visibility.Visible : Visibility.Collapsed;
        AddressSection.Visibility = _serverOnline ? Visibility.Visible : Visibility.Collapsed;
        UpdateModeHint();
    }

    private async Task RefreshServiceAsync()
    {
        if (_refreshing) return;
        _refreshing = true;
        var requestedRoot = _root;
        var requestedPort = CurrentPort();
        try
        {
            var port = CurrentPort();
            if (port is null || !InstallationLocator.IsProjectRoot(_root) || _node?.IsSupported != true)
            {
                _serverOnline = false;
                _portBusy = false;
                UpdateStatus();
                return;
            }

            var root = _root!;
            var status = await HostLauncher.StatusAsync(root, _node, port.Value);
            if (root != _root || port != CurrentPort()) return;
            _service = status;
            _serverOnline = status.State == "online";
            _portBusy = status.State == "busy";
            _starting = status.State == "starting" || status.Managed && !_serverOnline;
            if (_wrapper is not null)
            {
                try
                {
                    if (_wrapper.HasExited && !_serverOnline)
                    {
                        _failed = _wrapper.ExitCode != 0;
                        _starting = status.Managed;
                        _wrapper.Dispose();
                        _wrapper = null;
                    }
                }
                catch { _wrapper = null; }
            }
            UpdateStatus();
        }
        catch (Exception error)
        {
            if (requestedRoot != _root || requestedPort != CurrentPort()) return;
            _service = null;
            _serverOnline = false;
            _portBusy = CurrentPort() is int port && HostLauncher.PortHasListener(port);
            StatusTitle.Text = t("无法确认服务状态");
            StatusDetail.Text = t("请查看日志，或点击重新检查。");
            StatusBadge.Text = "UNKNOWN";
            StatusDot.Fill = Brush("#F6A329");
            if (!_visibleLog.Contains(error.Message)) AppendVisibleLog(error.Message);
        }
        finally
        {
            _refreshing = false;
            RefreshChecks();
            UpdateAddresses();
        }
    }

    private void UpdateStatus()
    {
        if (_operating) return;
        if (_serverOnline)
        {
            StatusTitle.Text = t("服务器运行中");
            StatusDetail.Text = _mode == HostMode.Tunnel && _service?.Addresses.All(address => !address.Url.Contains(".trycloudflare.com", StringComparison.Ordinal)) == true
                ? t("本机服务已就绪，公网隧道尚未就绪，请查看日志。")
                : t("服务可访问，可将地址发给玩家。");
            StatusBadge.Text = "ONLINE";
            StatusDot.Fill = Brush("#4ED8AF");
            StatusBadge.Foreground = Brush("#4ED8AF");
        }
        else if (_starting)
        {
            StatusTitle.Text = t("正在启动服务器");
            StatusDetail.Text = t("首次启动会准备依赖和素材，请稍候。");
            StatusBadge.Text = "STARTING";
            StatusDot.Fill = Brush("#F6A329");
            StatusBadge.Foreground = Brush("#F6A329");
        }
        else if (_portBusy)
        {
            StatusTitle.Text = t("端口已被占用");
            StatusDetail.Text = t("端口 {port} 已被其他程序占用；没有结束任何进程。", ("port", PortBox.Text));
            StatusBadge.Text = "PORT BUSY";
            StatusDot.Fill = Brush("#F6A329");
            StatusBadge.Foreground = Brush("#F6A329");
        }
        else if (_adminBusy)
        {
            StatusTitle.Text = t("管理端口 {port} 已被占用", ("port", ((CurrentPort() ?? 3000) + 100).ToString()));
            StatusDetail.Text = t("请更换游戏端口，管理端口使用游戏端口加 100。");
            StatusBadge.Text = "ADMIN PORT BUSY";
            StatusDot.Fill = Brush("#F6A329");
            StatusBadge.Foreground = Brush("#F6A329");
        }
        else if (_failed)
        {
            StatusTitle.Text = t("启动失败");
            StatusDetail.Text = t("请查看下方日志，修复后可重新启动。");
            StatusBadge.Text = "FAILED";
            StatusDot.Fill = Brush("#FF5454");
        }
        else
        {
            StatusTitle.Text = t("服务器已停止");
            StatusDetail.Text = t("选择开服方式并启动服务器。");
            StatusBadge.Text = "OFFLINE";
            StatusDot.Fill = Brush("#7C8982");
            StatusBadge.Foreground = Brush("#8A948F");
        }
    }

    private void UpdateAddresses()
    {
        var port = CurrentPort();
        if (port is null || _root is null)
        {
            AddressList.ItemsSource = null;
            return;
        }
        AddressList.ItemsSource = _service?.Addresses ?? [];
    }

    private void UpdateModeHint()
    {
        ModeHint.Text = _mode switch
        {
            HostMode.Local => t("本机模式只监听本机地址，适合测试。"),
            HostMode.Lan => t("局域网模式会显示同一网络可访问的地址。"),
            HostMode.Tunnel => t("公网隧道需要安装 cloudflared，并生成临时公网地址。"),
            _ => string.Empty,
        };
    }

    private async void Timer_Tick(object? sender, EventArgs e)
    {
        RefreshLogTail();
        await RefreshServiceAsync();
    }

    private void LoadLog()
    {
        _visibleLog.Clear();
        _logPosition = 0;
        if (_root is null) return;
        var path = HostLauncher.LogPath(_root, CurrentPort() ?? 3000);
        LogPathText.Text = path;
        try
        {
            if (!File.Exists(path)) { RenderLog(); return; }
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            using var reader = new StreamReader(stream, Encoding.UTF8);
            var text = reader.ReadToEnd();
            _logPosition = new FileInfo(path).Length;
            var lines = text.Split(["\r\n", "\n"], StringSplitOptions.RemoveEmptyEntries);
            var marker = Array.FindLastIndex(lines, line => line.StartsWith("[launcher] ", StringComparison.Ordinal) && line.Contains(" starting on port ", StringComparison.Ordinal));
            foreach (var line in lines.Skip(Math.Max(0, marker))) AddLogLine(line);
            RenderLog();
        }
        catch (IOException) { }
    }

    private void RefreshLogTail()
    {
        if (_root is null) return;
        var path = HostLauncher.LogPath(_root, CurrentPort() ?? 3000);
        LogPathText.Text = path;
        try
        {
            if (!File.Exists(path)) return;
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            if (stream.Length < _logPosition) _logPosition = 0;
            stream.Position = _logPosition;
            using var reader = new StreamReader(stream, Encoding.UTF8, true, 1024, leaveOpen: true);
            var added = reader.ReadToEnd();
            _logPosition = stream.Length;
            if (added.Length == 0) return;
            foreach (var line in added.Split(["\r\n", "\n"], StringSplitOptions.RemoveEmptyEntries)) AddLogLine(line);
            RenderLog();
        }
        catch (IOException) { }
    }

    private void AddLogLine(string raw)
    {
        var line = Ansi.Replace(raw, string.Empty);
        _visibleLog.Add(line);
        if (_visibleLog.Count > 240) _visibleLog.RemoveRange(0, _visibleLog.Count - 200);
    }

    private void RenderLog()
    {
        LogBox.Text = string.Join(Environment.NewLine, _visibleLog);
        LogBox.ScrollToEnd();
        UpdateAddresses();
    }

    private async void StartButton_Click(object sender, RoutedEventArgs e)
    {
        if (_serverOnline) { OpenGameButton_Click(sender, e); return; }
        if (!InstallationLocator.IsProjectRoot(_root))
        {
            ShowMessage(t("项目目录无效，请选择包含 server/index.js 的项目根目录。"));
            return;
        }
        if (_node?.IsSupported != true)
        {
            ShowMessage(t("需要 Node.js 22 或更高版本"));
            return;
        }
        var port = CurrentPort();
        if (port is null)
        {
            ShowMessage(t("端口必须是 1024–65435 之间的整数。"));
            return;
        }
        if (HostLauncher.PortHasListener(port.Value))
        {
            _portBusy = true;
            await RefreshServiceAsync();
            if (!_serverOnline) ShowMessage(t("端口 {port} 已被其他程序占用；没有结束任何进程。", ("port", port.Value.ToString())));
            return;
        }
        if (HostLauncher.PortHasListener(port.Value + 100))
        {
            RefreshChecks(); UpdateStatus();
            return;
        }

        var candidate = _profiles.FirstOrDefault(p => p.Id == _selectedId);
        if (candidate is not null && InstanceProfiles.Conflicts(candidate with { Port = port.Value }, _profiles))
        {
            ShowMessage(t("游戏端口或管理端口与其他实例配置冲突，请更换端口。"));
            return;
        }
        SavePreferences();
        _failed = false;
        _starting = true;
        UpdateStatus();
        RefreshChecks();
        try
        {
            _logPosition = File.Exists(HostLauncher.LogPath(_root!, port.Value)) ? new FileInfo(HostLauncher.LogPath(_root!, port.Value)).Length : 0;
            _wrapper?.Dispose();
            _wrapper = HostLauncher.Start(_root!, _node, port.Value, _mode);
            if (_wrapper is null) throw new InvalidOperationException("Could not start the launcher process.");
            AppendVisibleLog($"[{DateTime.Now:HH:mm:ss}] {t("正在启动服务器")}");
            _timer.Start();
        }
        catch (Exception ex)
        {
            _starting = false;
            _failed = true;
            UpdateStatus();
            AppendVisibleLog($"[{DateTime.Now:HH:mm:ss}] {ex.Message}");
            ShowMessage(t("启动失败，请检查 Node.js 和项目文件。"));
            RefreshChecks();
        }
        await Task.Delay(150);
        RefreshLogTail();
    }

    private async void StopButton_Click(object sender, RoutedEventArgs e)
    {
        if (_node?.IsSupported != true || _root is null || CurrentPort() is not int port) return;
        var answer = MessageBox.Show(this,
            t("确定停止服务器？当前玩家会断开，本局可能结束。"),
            t("停止服务器"), MessageBoxButton.YesNo, MessageBoxImage.Warning, MessageBoxResult.No);
        if (answer != MessageBoxResult.Yes) return;

        _operating = true;
        RefreshChecks();
        StatusTitle.Text = t("正在停止服务器");
        StatusBadge.Text = "STOPPING";
        StatusDot.Fill = Brush("#F6A329");
        AppendVisibleLog($"[{DateTime.Now:HH:mm:ss}] {t("正在停止服务器")}");
        try
        {
            var result = await HostLauncher.StopAsync(_root, _node, port);
            foreach (var line in result.Output.Split(["\r\n", "\n"], StringSplitOptions.RemoveEmptyEntries)) AppendVisibleLog(line);
            if (result.ExitCode != 0)
                ShowMessage(t("停止失败。没有强制结束未知进程，请查看日志和管理控制台。"));
        }
        catch (Exception ex)
        {
            AppendVisibleLog(ex.Message);
            ShowMessage(t("停止失败。没有强制结束未知进程，请查看日志和管理控制台。"));
        }
        finally
        {
            _operating = false;
            await RefreshServiceAsync();
        }
    }

    private async void BrowseButton_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new OpenFolderDialog { Title = t("选择实例根目录（包含 package.json、server、scripts）"), InitialDirectory = _root ?? Environment.GetFolderPath(Environment.SpecialFolder.Desktop) };
        if (dialog.ShowDialog(this) != true) return;
        if (!InstanceDiscovery.IsInstallation(dialog.FolderName))
        {
            ShowMessage(t("项目目录无效，请选择包含 server/index.js 的项目根目录。"));
            return;
        }
        var importedRoot = Path.GetFullPath(dialog.FolderName);
        var existing = _profiles.FirstOrDefault(p => p.Root.Equals(importedRoot, StringComparison.OrdinalIgnoreCase));
        if (existing is null)
        {
            existing = new InstanceProfile(Guid.NewGuid().ToString("N"), InstanceNaming.DefaultName(importedRoot), importedRoot,
                await ImportedPortAsync(importedRoot), "local");
            _profiles.Add(existing);
        }
        try { await SelectInstanceAsync(existing); }
        catch (Exception error) { ShowMessage(error.Message); }

    }

    private async void InstallNodeButton_Click(object sender, RoutedEventArgs e)
    {
        if (!CommandExists("winget.exe"))
        {
            try { HostLauncher.Open("https://nodejs.org/zh-cn/download"); }
            catch { ShowMessage(t("未找到 winget，请从官网安装 Node.js 22 或更高版本。")); }
            return;
        }
        var answer = MessageBox.Show(this, t("将通过 winget 安装 Node.js LTS。安装程序可能显示系统权限提示。"),
            t("安装 Node.js LTS"), MessageBoxButton.YesNo, MessageBoxImage.Information, MessageBoxResult.No);
        if (answer != MessageBoxResult.Yes) return;

        InstallNodeButton.IsEnabled = false;
        AppendVisibleLog($"[{DateTime.Now:HH:mm:ss}] winget install OpenJS.NodeJS.LTS");
        try
        {
            var start = new ProcessStartInfo("winget.exe")
            {
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            foreach (var arg in new[] { "install", "--id", "OpenJS.NodeJS.LTS", "-e", "--accept-source-agreements", "--accept-package-agreements" }) start.ArgumentList.Add(arg);
            using var process = Process.Start(start) ?? throw new InvalidOperationException("Could not start winget.");
            process.OutputDataReceived += (_, args) => { if (args.Data is not null) Dispatcher.BeginInvoke(() => AppendVisibleLog(args.Data)); };
            process.ErrorDataReceived += (_, args) => { if (args.Data is not null) Dispatcher.BeginInvoke(() => AppendVisibleLog(args.Data)); };
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            await process.WaitForExitAsync();
            if (process.ExitCode != 0) AppendVisibleLog(t("Node.js 安装未完成，退出代码 {code}。", ("code", process.ExitCode.ToString())));
        }
        catch (Exception ex)
        {
            AppendVisibleLog(ex.Message);
        }
        finally
        {
            await RefreshNodeAsync();
            await RefreshServiceAsync();
            InstallNodeButton.IsEnabled = true;
        }
    }

    private void Mode_Checked(object sender, RoutedEventArgs e)
    {
        if (!_ready || sender is not RadioButton radio) return;
        _mode = radio.Tag?.ToString() switch
        {
            "local" => HostMode.Local,
            "tunnel" => HostMode.Tunnel,
            _ => HostMode.Lan,
        };
        UpdateModeHint();
        RefreshChecks();
        SavePreferences();
    }

    private void InstallTunnelButton_Click(object sender, RoutedEventArgs e)
    {
        OpenUrl("https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/");
    }

    private void PortBox_PreviewTextInput(object sender, TextCompositionEventArgs e) => e.Handled = e.Text.Any(character => !char.IsDigit(character));

    private void PortBox_TextChanged(object sender, TextChangedEventArgs e)
    {
        if (!_ready) return;
        _service = null;
        _serverOnline = false;
        _failed = false;
        LoadLog();
        RefreshChecks();
        var port = CurrentPort() ?? 3000;
        LogPathText.Text = _root is null ? string.Empty : HostLauncher.LogPath(_root, port);
        SavePreferences();
    }

    private void OpenGameButton_Click(object sender, RoutedEventArgs e)
    {
        if (CurrentPort() is int port) OpenUrl($"http://localhost:{port}");
    }

    private void OpenConsoleButton_Click(object sender, RoutedEventArgs e)
    {
        if (_service?.AdminUrl is string url) OpenUrl(url);
    }

    private void OpenAddress_Click(object sender, RoutedEventArgs e)
    {
        if ((sender as Button)?.Tag is string url) OpenUrl(url);
    }

    private void CopyPrimaryButton_Click(object sender, RoutedEventArgs e)
    {
        if (AddressList.ItemsSource is not IEnumerable<HostAddress> addresses) return;
        var address = addresses.FirstOrDefault(item => !item.Url.Contains("localhost", StringComparison.OrdinalIgnoreCase))?.Url
            ?? addresses.FirstOrDefault()?.Url;
        if (address is null) return;
        try { Clipboard.SetText(address); StatusDetail.Text = t("地址已复制到剪贴板。"); }
        catch { ShowMessage(t("无法访问剪贴板。")); }
    }

    private void PortBox_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter && StartButton.IsEnabled) StartButton_Click(StartButton, new RoutedEventArgs());
    }

    private void Window_Closing(object? sender, System.ComponentModel.CancelEventArgs e)
    {
        if (App.PreviewDirectory is not null) return;
        if (_selfUpdateRestart) return;
        _selfUpdateCancellation?.Cancel();
        if (_installCancellation is not null)
        {
            _installCancellation.Cancel();
            e.Cancel = true;
            return;
        }
        if (_profiles.Count == 0 && !_serverOnline && !_starting) return;
        var answer = MessageBox.Show(this, t("关闭启动器后，服务器会继续在后台运行。"),
            t("退出启动器"), MessageBoxButton.YesNo, MessageBoxImage.Information, MessageBoxResult.No);
        if (answer != MessageBoxResult.Yes) e.Cancel = true;
    }

    private async void RefreshButton_Click(object sender, RoutedEventArgs e)
    {
        RefreshButton.IsEnabled = false;
        try { await RefreshNodeAsync(); await RefreshServiceAsync(); }
        finally { RefreshButton.IsEnabled = true; }
    }

    private async void RestartButton_Click(object sender, RoutedEventArgs e)
    {
        if (_root is null || _node is null || CurrentPort() is not int port) return;
        if (MessageBox.Show(this, t("确定重启服务？玩家会暂时断开，按现有恢复设置处理对局。"),
            t("重启服务"), MessageBoxButton.YesNo, MessageBoxImage.Warning, MessageBoxResult.No) != MessageBoxResult.Yes) return;
        _operating = true;
        RefreshChecks();
        StatusTitle.Text = t("正在重启服务");
        StatusBadge.Text = "RESTARTING";
        try
        {
            await HostLauncher.RestartAsync(_root, _node, port);
            AppendVisibleLog(t("重启请求已发送，正在等待服务恢复。"));
            await Task.Delay(1800);
        }
        catch (Exception error) { AppendVisibleLog(error.Message); ShowMessage(error.Message); }
        finally { _operating = false; await RefreshServiceAsync(); }
    }

    private void CopyLogButton_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            Clipboard.SetText($"Node: {_node?.Version ?? "missing"}; port: {CurrentPort()}; mode: {_mode}; state: {_service?.State}\n" + LogBox.Text);
            StatusDetail.Text = t("诊断信息已复制。分享前请确认未包含个人信息。");
        }
        catch { ShowMessage(t("无法访问剪贴板。")); }
    }

    private void OpenLogButton_Click(object sender, RoutedEventArgs e)
    {
        if (_root is null) return;
        try { var directory = Path.Combine(_root, "logs"); Directory.CreateDirectory(directory); HostLauncher.Open(directory); }
        catch (Exception error) { ShowMessage(error.Message); }
    }

    private int? CurrentPort()
        => int.TryParse(PortBox.Text, NumberStyles.None, CultureInfo.InvariantCulture, out var port) && port is >= 1024 and <= 65435 ? port : null;

    private void SavePreferences()
    {
        if (!_ready || App.PreviewDirectory is not null) return;
        if (_selectedId is not null)
        {
            var index = _profiles.FindIndex(p => p.Id == _selectedId);
            if (index >= 0 && _root is not null && CurrentPort() is int port)
            {
                var updated = _profiles[index] with { Root = _root, Port = port, Mode = ModeName(_mode) };
                if (updated != _profiles[index]) { _profiles[index] = updated; RefreshInstanceList(); }
            }
        }
        try { InstanceProfiles.Save(new InstanceSettings(_selectedId, _profiles)); }
        catch (Exception error) { AppendVisibleLog(t("保存实例列表失败：{error}", ("error", error.Message))); }
        if (_root is not null)
            try { LauncherLocation.Register(_root); }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException) { /* Console still updates the root-directory EXE. */ }
        PreferencesStore.Save(new LauncherPreferences(_root, CurrentPort() ?? 3000, _mode switch
        {
            HostMode.Local => "local",
            HostMode.Tunnel => "tunnel",
            _ => "lan",
        }));
    }

    private void AppendVisibleLog(string line)
    {
        AddLogLine(line);
        RenderLog();
    }

    private void ShowMessage(string message) => MessageBox.Show(this, message, t("服主启动器"), MessageBoxButton.OK, MessageBoxImage.Information);

    private void OpenUrl(string url)
    {
        try { HostLauncher.Open(url); }
        catch { ShowMessage(t("无法打开默认浏览器。")); }
    }

    private static bool CommandExists(string command)
    {
        try
        {
            var path = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
            return path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries)
                .Select(directory => Path.Combine(directory.Trim('"'), command)).Any(File.Exists);
        }
        catch { return false; }
    }

    private static Brush Brush(string color) => new SolidColorBrush((Color)ColorConverter.ConvertFromString(color));

    // Review-only rendering: no processes are launched and no server/user preferences are changed.
    private async Task RenderPreviewAsync(string directory)
    {
        try
        {
            Directory.CreateDirectory(directory);
            _root = InstallationLocator.FindRoot(Environment.CurrentDirectory, AppContext.BaseDirectory);
            _text = new TextCatalog(_root);
            ApplyText();
            _node = await Task.Run(NodeRuntime.Find);
            _install = new InstallStatus(true, true, true, 0);
            NodeCheckValue.Text = _node?.Version ?? t("未找到");
            RootPathText.Text = _root;
            LogPathText.Text = "logs/host-launcher-19388.log";
            PortBox.Text = "19388";
            RefreshChecks();
            UpdateStatus();
            await CapturePreviewAsync(directory, "offline");
            _service = new DesktopStatus("online", true, "http://127.0.0.1:19488", true, true, true, 0,
                [new("局域网（演示）", "http://192.0.2.1:19388"), new("本机", "http://localhost:19388")]);
            _serverOnline = true;
            _visibleLog.Add("[preview] 界面预览，以下运行状态与地址仅为演示，未启动服务器。");
            _visibleLog.Add("[launcher] 环境检查完成：依赖、数据、素材已就绪。");
            RenderLog();
            UpdateStatus();
            RefreshChecks();
            UpdateAddresses();
            await CapturePreviewAsync(directory, "online-demo");
            Width = 900; Height = 700;
            await CapturePreviewAsync(directory, "compact-demo");
            _serverOnline = false; _service = null; _portBusy = true;
            RefreshChecks(); _portBusy = true; UpdateStatus();
            PortCheckValue.Text = t("端口已被占用"); PortCheckValue.Foreground = Brush("#F6A329"); StartButton.IsEnabled = false;
            await CapturePreviewAsync(directory, "port-busy-demo");
            _profiles.Add(new("preview-one", "本机测试（演示）", _root!, 19388, "local"));
            _profiles.Add(new("preview-two", "朋友联机（演示）", _root!, 19389, "lan"));
            _selectedId = "preview-one";
            RefreshInstanceList();
            Width = 1080; Height = 820;
            RefreshChecks();
            await CapturePreviewAsync(directory, "multi-instance-demo");
            DiscoveryPanel.Visibility = Visibility.Visible;
            DiscoveryStatusText.Text = t("通过监听端口与本机索引发现 {count} 个未导入目录。在线实例：{ports}。已停止且未登记的旧目录请手动导入。", ("count", "2"), ("ports", "3000 (v0.3.1)、3001 (v0.3.3)"));
            DiscoveryList.ItemsSource = new[] { @"E:\Stronghold-Protocol", @"E:\Stronghold-Protocol-v0.3.3" };
            await CapturePreviewAsync(directory, "discovery-demo");
            DiscoveryPanel.Visibility = Visibility.Collapsed;
            InstallPanel.Visibility = Visibility.Visible;
            InstallPathBox.Text = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "StrongholdProtocol", "servers", InstanceNaming.DirectoryName(3));
            InstallStatusText.Text = t("正在获取游戏版本");
            await CapturePreviewAsync(directory, "first-install-demo");
            Width = 900; Height = 700;
            await CapturePreviewAsync(directory, "first-install-compact-demo");
            InstallPanel.Visibility=Visibility.Collapsed;SelfUpdatePanel.Visibility=Visibility.Visible;
            SelfUpdateStatus.Text=t("发现启动器新版本 {version}。独立更新此 EXE，服务器保持运行。",("version","9.9.9"));
            SelfUpdateInstall.Visibility=Visibility.Visible;
            await CapturePreviewAsync(directory,"self-update-compact-demo");
            Width=1080;Height=820;await CapturePreviewAsync(directory,"self-update-demo");
            File.WriteAllText(Path.Combine(directory, "preview-result.txt"), "Rendered ten WPF layouts. Update/online/address/error/instance states are synthetic; no download or server was started.");
        }
        catch (Exception error)
        {
            File.WriteAllText(Path.Combine(directory, "preview-error.txt"), error.ToString());
            Environment.ExitCode = 1;
        }
        finally { _serverOnline = false; _starting = false; Close(); }
    }

    private async Task CapturePreviewAsync(string directory, string name)
    {
        UpdateLayout();
        await Dispatcher.InvokeAsync(() => { }, DispatcherPriority.Render);
        await Task.Delay(150);
        UpdateLayout();
        var surface = (FrameworkElement)Content;
        var dpi = VisualTreeHelper.GetDpi(this);
        var drawing = new DrawingVisual();
        using (var context = drawing.RenderOpen())
        {
            context.DrawRectangle((Brush)FindResource("Bg0"), null, new Rect(0, 0, ActualWidth, ActualHeight));
            context.DrawRectangle(new VisualBrush(surface), null, new Rect(26, 20, surface.ActualWidth, surface.ActualHeight));
        }
        var bitmap = new RenderTargetBitmap((int)Math.Ceiling(ActualWidth * dpi.DpiScaleX), (int)Math.Ceiling(ActualHeight * dpi.DpiScaleY), dpi.PixelsPerInchX, dpi.PixelsPerInchY, PixelFormats.Pbgra32);
        bitmap.Render(drawing);
        var encoder = new PngBitmapEncoder();
        encoder.Frames.Add(BitmapFrame.Create(bitmap));
        using var file = File.Create(Path.Combine(directory, name + ".png"));
        encoder.Save(file);
    }

    private static void SetDarkTitleBar()
    {
        try
        {
            var handle = new System.Windows.Interop.WindowInteropHelper(Application.Current.MainWindow).Handle;
            var value = 1;
            _ = DwmSetWindowAttribute(handle, 20, ref value, sizeof(int));
        }
        catch { }
    }

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int valueSize);
}
