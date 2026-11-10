using System.Windows;
using System.Windows.Controls;
using StrongholdProtocolLauncher.Services;

namespace StrongholdProtocolLauncher;

public partial class MainWindow
{
    private bool _proxyValid = true;

    private DownloadProxySettings CurrentDownloadProxy() => new(
        ProxyDirect.IsChecked == true ? "direct" : ProxyManual.IsChecked == true ? "manual" : "system",
        ProxyAddressBox.Text.Trim());

    private void LoadDownloadProxy(LauncherPreferences preferences)
    {
        ProxyAddressBox.Text = preferences.DownloadProxyAddress ?? "";
        ProxySystem.IsChecked = preferences.DownloadProxyMode == "system";
        ProxyDirect.IsChecked = preferences.DownloadProxyMode == "direct";
        ProxyManual.IsChecked = preferences.DownloadProxyMode == "manual";
    }

    private void ApplyDownloadProxyText()
    {
        DownloadProxyHeading.Text = t("下载代理");
        ProxySystem.Content = t("系统代理");
        ProxyDirect.Content = t("直连");
        ProxyManual.Content = t("手动代理");
        ProxyAddressLabel.Text = t("代理地址");
        ProxyAddressBox.ToolTip = t("例如 http://127.0.0.1:7890");
        ProxyApplyHint.Text = t("用于安装、更新和补全素材。启动时补素材在下次启动时应用。");
        RefreshDownloadProxy();
    }

    private void RefreshDownloadProxy()
    {
        var settings = CurrentDownloadProxy();
        ProxyAddressPanel.Visibility = settings.Mode == "manual" ? Visibility.Visible : Visibility.Collapsed;
        _proxyValid = true;
        try { DownloadProxy.Validate(settings); }
        catch (ArgumentException) { _proxyValid = false; }
        ProxyValidationText.Text = _proxyValid ? "" : t("请输入有效的 HTTP / HTTPS 代理地址，不含用户名和密码。");
        ProxyValidationText.Visibility = _proxyValid ? Visibility.Collapsed : Visibility.Visible;
        ProxyModeHint.Text = settings.Mode switch
        {
            "direct" => t("直接连接下载源，忽略系统与环境变量代理。"),
            "manual" => t("通过指定代理下载；本机服务连接保持直连。"),
            _ => t("使用 Windows 系统代理；未设置代理时直连。"),
        };
    }

    private void DownloadProxy_Changed(object sender, RoutedEventArgs e)
    {
        if (!_ready) return;
        RefreshDownloadProxy();
        SavePreferences();
        RefreshChecks();
    }

    private void ProxyAddress_Changed(object sender, TextChangedEventArgs e)
        => DownloadProxy_Changed(sender, e);
}
