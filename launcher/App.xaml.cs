using System.Windows;
using StrongholdProtocolLauncher.Services;

namespace StrongholdProtocolLauncher;

public partial class App : Application
{
    internal static string? PreviewDirectory { get; private set; }
    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        if (e.Args.Length == 2 && e.Args[0] == "--apply-self-update")
        {
            ShutdownMode = ShutdownMode.OnExplicitShutdown;
            try { Shutdown(await LauncherSelfUpdate.ApplyAsync(e.Args[1])); }
            catch { Shutdown(1); }
            return;
        }
        if (e.Args.Length == 2 && e.Args[0] == "--render-preview") PreviewDirectory = Path.GetFullPath(e.Args[1]);
        MainWindow = new MainWindow();
        MainWindow.Show();
    }
}
