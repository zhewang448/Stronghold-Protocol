using System.Windows;
using StrongholdProtocolLauncher.Services;

namespace StrongholdProtocolLauncher;

public partial class MainWindow
{
    private LauncherRelease? _selfRelease;
    private CancellationTokenSource? _selfUpdateCancellation;
    private bool _checkingSelfUpdate, _selfUpdateRestart;

    private async Task CheckSelfUpdateAsync(bool show)
    {
        if (_checkingSelfUpdate || _selfUpdateCancellation is not null) return;
        _checkingSelfUpdate = true;SelfUpdateButton.IsEnabled = false;
        if(show) {SelfUpdatePanel.Visibility=Visibility.Visible;SelfUpdateStatus.Text=t("正在检查启动器更新…");}
        try
        {
            using var client=LauncherSelfUpdate.CreateClient();using var timeout=new CancellationTokenSource(TimeSpan.FromSeconds(20));
            _selfRelease=await new LauncherSelfUpdate(client).CheckAsync(LauncherSelfUpdate.CurrentVersion,timeout.Token);
            if(_selfRelease is null)
            {
                SelfUpdateStatus.Text=t("启动器已是最新版本。");SelfUpdateInstall.Visibility=Visibility.Collapsed;
            }
            else
            {
                SelfUpdatePanel.Visibility=Visibility.Visible;SelfUpdateInstall.Visibility=Visibility.Visible;
                SelfUpdateStatus.Text=t("发现启动器新版本 {version}。独立更新此 EXE，服务器保持运行。",("version",_selfRelease.Version));
            }
        }
        catch(Exception error)
        {
            if(show)SelfUpdateStatus.Text=t("启动器更新检查失败：{error}",("error",error.Message));
        }
        finally {_checkingSelfUpdate=false;SelfUpdateButton.IsEnabled=true;}
    }
    private async void SelfUpdateButton_Click(object sender,RoutedEventArgs e)=>await CheckSelfUpdateAsync(true);
    private void SelfUpdateCancel_Click(object sender,RoutedEventArgs e)
    {
        if(_selfUpdateCancellation is not null)_selfUpdateCancellation.Cancel();
        else SelfUpdatePanel.Visibility=Visibility.Collapsed;
    }
    private async void SelfUpdateInstall_Click(object sender,RoutedEventArgs e)
    {
        if(_selfRelease is null || _operating || _selfUpdateCancellation is not null)return;
        if(MessageBox.Show(this,t("将下载并验签启动器，关闭当前窗口后自动替换并重新打开。后台服务器不会停止。确定更新？"),t("启动器更新"),MessageBoxButton.YesNo,MessageBoxImage.Question,MessageBoxResult.No)!=MessageBoxResult.Yes)return;
        _operating=true;_selfUpdateCancellation=new CancellationTokenSource();RefreshChecks();SelfUpdateButton.IsEnabled=SelfUpdateInstall.IsEnabled=false;SelfUpdateProgress.Visibility=Visibility.Visible;
        try
        {
            var target=Environment.ProcessPath??throw new System.IO.IOException("Current executable unavailable.");
            var progress=new Progress<InstallProgress>(p=>
            {
                SelfUpdateProgress.IsIndeterminate=p.Total<=0;SelfUpdateProgress.Value=p.Total>0?100.0*p.Received/p.Total:0;
                SelfUpdateStatus.Text=t("正在下载并校验启动器… {received} MB",("received",(p.Received/1048576.0).ToString("F1")));
            });
            using var client=LauncherSelfUpdate.CreateClient();
            var manifest=await new LauncherSelfUpdate(client).PrepareAsync(_selfRelease,target,progress,_selfUpdateCancellation.Token);
            _selfUpdateCancellation.Token.ThrowIfCancellationRequested();
            await LauncherSelfUpdate.LaunchHelperAsync(manifest);
            _selfUpdateRestart=true;SavePreferences();Close();
        }
        catch(OperationCanceledException){SelfUpdateStatus.Text=t("启动器更新已取消，原文件未变。");}
        catch(Exception error){SelfUpdateStatus.Text=t("启动器更新失败：{error}",("error",error.Message));}
        finally
        {
            _selfUpdateCancellation?.Dispose();_selfUpdateCancellation=null;_operating=false;
            SelfUpdateProgress.Visibility=Visibility.Collapsed;SelfUpdateButton.IsEnabled=SelfUpdateInstall.IsEnabled=true;RefreshChecks();
        }
    }
}
